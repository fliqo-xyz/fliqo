import "server-only";
import { createClient } from "redis";

/*
 * Storage for rate limits (the RPC relay budget) and the shared GeckoTerminal cache, budget and fetch locks
 * (src/lib/gtcache.ts, keys fliqo:gt:*), plus cached chain answers (sell checks, token locks).
 *
 * Production uses Redis, configured with one of
 *   KV_REDIS_URL or REDIS_URL           a redis:// or rediss:// connection URL
 *                                       (Vercel's Redis integration), or
 *   UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN, or
 *   KV_REST_API_URL + KV_REST_API_TOKEN (Upstash over its REST API).
 * Every key is prefixed with "fliqo:" (or STORE_KEY_PREFIX when set), so several
 * projects can share one Redis and a per-project Redis user (ACL ~fliqo:*) can be
 * limited to its own keys.
 *
 * Without those there is no store: the rate limiter keeps per-instance counters in memory
 * (see src/lib/ratelimit.ts) and every cache lives in the instance's memory, which is enough for a local run and a
 * single region.
 */

export type Store = {
  get(key: string): Promise<string | null>;
  /** Sets with an expiry in seconds. */
  setEx(key: string, value: string, ttl: number): Promise<void>;
  /** Sets only if the key is free; true when it was set. */
  setNx(key: string, value: string, ttl: number): Promise<boolean>;
  del(key: string): Promise<void>;
  /** Reads and deletes in one atomic step (GETDEL). Only one caller can ever get the value. */
  take(key: string): Promise<string | null>;
  /** Deletes the key only while it still holds `value` (lock release by its owner). */
  delIf(key: string, value: string): Promise<boolean>;
  incr(key: string): Promise<number>;
  /** Increments a counter that expires `ttl` seconds after it was created. */
  incrEx(key: string, ttl: number): Promise<number>;
  /** Adds `by` to a counter that expires `ttl` seconds after it was created. */
  incrByEx(key: string, by: number, ttl: number): Promise<number>;
  /** Adds an integer and returns the new total. */
  incrBy(key: string, by: number): Promise<number>;
  /** Several plain values at once, null where missing. */
  mget(keys: string[]): Promise<(string | null)[]>;
  /** Sets without expiry. */
  set(key: string, value: string): Promise<void>;
  /** Pushes to the head of a list and keeps the newest `keep` items. */
  pushCapped(key: string, value: string, keep: number): Promise<void>;
  /** Newest first. */
  range(key: string, count: number): Promise<string[]>;
};

/** Compare-and-delete, so a lock is only ever released by the request that holds it. */
const DEL_IF = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";

function restConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

function redisStore(config: { url: string; token: string }): Store {
  let noScripts = false;
  const run = async <T>(...commands: (string | number)[][]): Promise<T[]> => {
    const res = await fetch(`${config.url}/pipeline`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
      body: JSON.stringify(commands.map((c) => c.map(String))),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Redis ${res.status}`);
    const body = (await res.json()) as { result?: T; error?: string }[];
    return body.map((entry) => {
      if (entry.error) throw new Error(entry.error);
      return entry.result as T;
    });
  };
  return {
    get: async (key) => (await run<string | null>(["GET", key]))[0],
    setEx: async (key, value, ttl) => void (await run(["SET", key, value, "EX", ttl])),
    setNx: async (key, value, ttl) => (await run<string | null>(["SET", key, value, "NX", "EX", ttl]))[0] === "OK",
    del: async (key) => void (await run(["DEL", key])),
    take: async (key) => (await run<string | null>(["GETDEL", key]))[0],
    delIf: async (key, value) => {
      if (!noScripts) {
        try {
          return Number((await run<number>(["EVAL", DEL_IF, 1, key, value]))[0]) === 1;
        } catch (e) {
          // A shared Redis gateway may deny scripting to project users (Redis ACL -@scripting).
          if (!/NOPERM|scripting|not allowed|unknown command/i.test(String(e))) throw e;
          noScripts = true;
        }
      }
      // Without scripts: delete only if the value still matches. The gap between the GET and the
      // DEL is one round trip; it only matters if the lock expires and is retaken in that instant.
      if ((await run<string | null>(["GET", key]))[0] !== value) return false;
      await run(["DEL", key]);
      return true;
    },
    incr: async (key) => Number((await run<number>(["INCR", key]))[0]),
    incrBy: async (key, by) => Number((await run<number>(["INCRBY", key, Math.trunc(by)]))[0]),
    incrEx: async (key, ttl) => Number((await run<number>(["INCR", key], ["EXPIRE", key, ttl, "NX"]))[0]),
    incrByEx: async (key, by, ttl) => Number((await run<number>(["INCRBY", key, Math.trunc(by)], ["EXPIRE", key, ttl, "NX"]))[0]),
    mget: async (keys) => (keys.length ? ((await run<(string | null)[]>(["MGET", ...keys]))[0] ?? []) : []),
    set: async (key, value) => void (await run(["SET", key, value])),
    pushCapped: async (key, value, keep) => void (await run(["LPUSH", key, value], ["LTRIM", key, 0, keep - 1])),
    range: async (key, count) => (await run<string[]>(["LRANGE", key, 0, count - 1]))[0] ?? [],
  };
}

type RedisClient = ReturnType<typeof createClient>;
// One connection per server instance, reused across requests.
let connecting: Promise<RedisClient> | null = null;

function tcpStore(url: string): Store {
  const client = () => {
    connecting ??= createClient({ url, socket: { connectTimeout: 5000 } })
      .on("error", () => {
        // Reported per command; a broken socket reconnects on the next call.
      })
      .connect() as Promise<RedisClient>;
    connecting.catch(() => {
      connecting = null;
    });
    return connecting;
  };
  return {
    get: async (key) => (await client()).get(key),
    setEx: async (key, value, ttl) => void (await (await client()).set(key, value, { EX: ttl })),
    setNx: async (key, value, ttl) => (await (await client()).set(key, value, { NX: true, EX: ttl })) === "OK",
    del: async (key) => void (await (await client()).del(key)),
    take: async (key) => (await client()).getDel(key),
    delIf: async (key, value) => Number(await (await client()).eval(DEL_IF, { keys: [key], arguments: [value] })) === 1,
    incr: async (key) => (await client()).incr(key),
    incrBy: async (key, by) => (await client()).incrBy(key, Math.trunc(by)),
    incrEx: async (key, ttl) => {
      const [n] = (await (await client()).multi().incr(key).expire(key, ttl, "NX").exec()) as unknown as [number];
      return Number(n);
    },
    incrByEx: async (key, by, ttl) => {
      const [n] = (await (await client()).multi().incrBy(key, Math.trunc(by)).expire(key, ttl, "NX").exec()) as unknown as [number];
      return Number(n);
    },
    mget: async (keys) => (keys.length ? (await client()).mGet(keys) : []),
    set: async (key, value) => void (await (await client()).set(key, value)),
    pushCapped: async (key, value, keep) => {
      await (await client()).multi().lPush(key, value).lTrim(key, 0, keep - 1).exec();
    },
    range: async (key, count) => (await client()).lRange(key, 0, count - 1),
  };
}

export const KEY_PREFIX = process.env.STORE_KEY_PREFIX || "fliqo:";

/** Puts the project prefix in front of every key the site touches. */
export function prefixed(store: Store, prefix: string): Store {
  const k = (key: string) => `${prefix}${key}`;
  return {
    get: (key) => store.get(k(key)),
    setEx: (key, value, ttl) => store.setEx(k(key), value, ttl),
    setNx: (key, value, ttl) => store.setNx(k(key), value, ttl),
    del: (key) => store.del(k(key)),
    take: (key) => store.take(k(key)),
    delIf: (key, value) => store.delIf(k(key), value),
    incr: (key) => store.incr(k(key)),
    incrBy: (key, by) => store.incrBy(k(key), by),
    incrEx: (key, ttl) => store.incrEx(k(key), ttl),
    incrByEx: (key, by, ttl) => store.incrByEx(k(key), by, ttl),
    mget: (keys) => store.mget(keys.map(k)),
    set: (key, value) => store.set(k(key), value),
    pushCapped: (key, value, keep) => store.pushCapped(k(key), value, keep),
    range: (key, count) => store.range(k(key), count),
  };
}

let cached: Store | null | undefined;

/** The configured store, or null when no Redis is configured. */
export function getStore(): Store | null {
  if (cached !== undefined) return cached;
  const tcp = process.env.KV_REDIS_URL || process.env.REDIS_URL;
  const rest = restConfig();
  if (tcp) cached = prefixed(tcpStore(tcp), KEY_PREFIX);
  else if (rest) cached = prefixed(redisStore(rest), KEY_PREFIX);
  else cached = null;
  return cached;
}
