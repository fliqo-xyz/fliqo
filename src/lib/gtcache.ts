import { createHash } from "node:crypto";
import type { Store } from "@/lib/server/store";

/*
 * Two-level cache and outbound budget for GeckoTerminal reads (used by src/lib/server/gecko.ts).
 *
 *   L1  this server instance's memory: answers by URL, single flight per URL, a per-instance call budget.
 *   L2  the shared store (Redis through the kv-gateway, keys "fliqo:gt:*"), when it is configured: answers every
 *       instance can read, one short fetch lock per URL so instances do not stampede the upstream, a site-wide call
 *       budget per minute and a site-wide pause after the upstream answers 429.
 *
 * Only plain commands are used (GET, MGET, SET … EX, SET … NX EX, INCR + EXPIRE NX, DEL): the gateway forbids
 * scripting. Every store call has a short timeout; a store that fails is left alone for 30 s and the cache works
 * from memory only, exactly as it does when no store is configured. An answer that expired keeps being served
 * (marked stale) for a while when the upstream cannot be asked. Nothing here ever makes up a value.
 */

export type CacheKV = Pick<Store, "get" | "setEx" | "setNx" | "del" | "incrEx" | "mget">;
export type Fetched<T> = { value: T; at: number; stale: boolean };

/** Thrown by the fetcher when the upstream answered 429. */
export class UpstreamLimited extends Error {
  constructor() {
    super("rate limited upstream");
  }
}

export const BUSY = "Market data is busy. Try again in a minute.";

export type GeckoCacheOptions = {
  kv: () => CacheKV | null;
  fetch: (key: string) => Promise<unknown>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Calls per rolling minute for this instance: priority reads, and the share open to other reads. */
  perInstance?: { priority: number; detail: number };
  /** Calls per clock minute for the whole site (all instances), when the store is configured. */
  shared?: { priority: number; detail: number };
  maxStaleMs?: number;
  maxEntries?: number;
  kvTimeoutMs?: number;
  /** How long one instance holds the fetch lock of a URL. */
  lockSec?: number;
  /** How long an instance that lost the lock waits for the winner's answer before asking itself. */
  waitMs?: number;
  /** Pause after a 429, for this instance and (through the store) for every instance. */
  blockMs?: number;
  /** Larger answers stay in memory only. */
  maxSharedBytes?: number;
};

type Entry = { at: number; ttl: number; value: unknown };

export const sharedKey = (key: string) => `gt:v1:${createHash("sha1").update(key).digest("hex")}`;
export const lockKey = (key: string) => `gt:lock:${createHash("sha1").update(key).digest("hex")}`;
export const BLOCK_KEY = "gt:blocked";
export const budgetKey = (minute: number) => `gt:out:${minute}`;

function parseEntry(raw: string | null | undefined): Entry | null {
  if (!raw) return null;
  try {
    const e = JSON.parse(raw) as Entry;
    return typeof e?.at === "number" && typeof e.ttl === "number" && "value" in e ? e : null;
  } catch {
    return null;
  }
}

export function createGeckoCache(o: GeckoCacheOptions) {
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const per = o.perInstance ?? { priority: 24, detail: 14 };
  const shared = o.shared ?? { priority: 28, detail: 18 };
  const maxStale = o.maxStaleMs ?? 30 * 60_000;
  const maxEntries = o.maxEntries ?? 400;
  const kvTimeout = o.kvTimeoutMs ?? 1500;
  const lockSec = o.lockSec ?? 10;
  const waitMs = o.waitMs ?? 2400;
  const blockMs = o.blockMs ?? 20_000;
  const maxShared = o.maxSharedBytes ?? 900_000;

  const cache = new Map<string, Entry>();
  const inflight = new Map<string, Promise<Fetched<unknown>>>();
  const sent: number[] = [];
  let blockedUntil = 0;
  let kvDownUntil = 0;
  const stats = { upstream: 0, l1: 0, l2: 0, stale: 0, refused: 0, kvErrors: 0 };

  function remember(key: string, e: Entry) {
    cache.delete(key);
    cache.set(key, e);
    while (cache.size > maxEntries) {
      const first = cache.keys().next().value;
      if (first === undefined) break;
      cache.delete(first);
    }
  }

  function takeLocal(t: number, priority: boolean) {
    while (sent.length && t - sent[0] > 60_000) sent.shift();
    if (t < blockedUntil || sent.length >= (priority ? per.priority : per.detail)) return false;
    sent.push(t);
    return true;
  }

  function store(): CacheKV | null {
    if (now() < kvDownUntil) return null;
    try {
      return o.kv();
    } catch {
      return null;
    }
  }

  /** One store call with a timeout; any failure marks the store down for 30 s and answers `fallback`. */
  async function kvTry<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        fn(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("store timeout")), kvTimeout);
        }),
      ]);
    } catch {
      stats.kvErrors += 1;
      kvDownUntil = now() + 30_000;
      return fallback;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  const usable = (e: Entry | null | undefined, t: number): e is Entry => Boolean(e && t - e.at < e.ttl + maxStale);
  const newer = (a: Entry | null | undefined, b: Entry | null | undefined) => (a && b ? (a.at >= b.at ? a : b) : (a ?? b ?? null));

  async function resolve(key: string, ttl: number, priority: boolean): Promise<Fetched<unknown>> {
    const t = now();
    const local = cache.get(key) ?? null;
    let kv = store();
    let remote: Entry | null = null;
    let sharedBlock = false;
    if (kv) {
      const k = kv;
      const got = await kvTry(() => k.mget([sharedKey(key), BLOCK_KEY]), null);
      if (got === null) kv = null;
      else {
        remote = parseEntry(got[0]);
        sharedBlock = Boolean(got[1]);
      }
    }
    if (remote && t - remote.at < remote.ttl) {
      stats.l2 += 1;
      if (!local || remote.at > local.at) remember(key, remote);
      return { value: remote.value, at: remote.at, stale: false };
    }
    const fallback = newer(local, remote);
    const serveStale = (why: unknown): Fetched<unknown> => {
      if (usable(fallback, now())) {
        stats.stale += 1;
        return { value: fallback.value, at: fallback.at, stale: true };
      }
      throw why instanceof Error && !(why instanceof UpstreamLimited) ? why : new Error(BUSY);
    };
    if (t < blockedUntil || sharedBlock) {
      stats.refused += 1;
      return serveStale(new Error(BUSY));
    }
    if (kv) {
      const k = kv;
      const mine = await kvTry(() => k.setNx(lockKey(key), String(t), lockSec), true);
      if (!mine) {
        // Another instance is asking the upstream for this URL right now: use what we have, or wait for its answer.
        if (usable(fallback, t)) return serveStale(null);
        for (let waited = 0; waited < waitMs; waited += 400) {
          await sleep(400);
          const e = parseEntry(await kvTry(() => k.get(sharedKey(key)), null));
          if (e && now() - e.at < e.ttl) {
            stats.l2 += 1;
            remember(key, e);
            return { value: e.value, at: e.at, stale: false };
          }
        }
      }
    }
    if (!takeLocal(now(), priority)) {
      stats.refused += 1;
      if (kv) {
        const k = kv;
        await kvTry(() => k.del(lockKey(key)), undefined);
      }
      return serveStale(new Error(BUSY));
    }
    if (kv) {
      const k = kv;
      const n = await kvTry(() => k.incrEx(budgetKey(Math.floor(now() / 60_000)), 90), 0);
      if (n > (priority ? shared.priority : shared.detail)) {
        stats.refused += 1;
        await kvTry(() => k.del(lockKey(key)), undefined);
        return serveStale(new Error(BUSY));
      }
    }
    try {
      stats.upstream += 1;
      const value = await o.fetch(key);
      const e: Entry = { at: now(), ttl, value };
      remember(key, e);
      if (kv) {
        const k = kv;
        const text = JSON.stringify(e);
        if (text.length <= maxShared) await kvTry(() => k.setEx(sharedKey(key), text, Math.ceil((ttl + maxStale) / 1000)), undefined);
        await kvTry(() => k.del(lockKey(key)), undefined);
      }
      return { value: e.value, at: e.at, stale: false };
    } catch (err) {
      if (err instanceof UpstreamLimited) {
        blockedUntil = now() + blockMs;
        if (kv) {
          const k = kv;
          await kvTry(() => k.setEx(BLOCK_KEY, "1", Math.ceil(blockMs / 1000)), undefined);
        }
      }
      if (kv) {
        const k = kv;
        await kvTry(() => k.del(lockKey(key)), undefined);
      }
      return serveStale(err);
    }
  }

  return {
    /** Cached read of `key` (a full upstream path); `ttl` in ms; `priority` marks the shared list reads. */
    async get<T>(key: string, ttl: number, priority = false): Promise<Fetched<T>> {
      const hit = cache.get(key);
      if (hit && now() - hit.at < hit.ttl) {
        stats.l1 += 1;
        return { value: hit.value as T, at: hit.at, stale: false };
      }
      let job = inflight.get(key);
      if (!job) {
        job = resolve(key, ttl, priority).finally(() => inflight.delete(key));
        inflight.set(key, job);
      }
      return (await job) as Fetched<T>;
    },
    stats: () => ({ ...stats, entries: cache.size, kvDown: now() < kvDownUntil }),
    reset() {
      cache.clear();
      inflight.clear();
      sent.length = 0;
      blockedUntil = 0;
      kvDownUntil = 0;
      for (const k of Object.keys(stats) as (keyof typeof stats)[]) stats[k] = 0;
    },
  };
}
