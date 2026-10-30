import { test } from "node:test";
import assert from "node:assert/strict";
import { BLOCK_KEY, BUSY, createGeckoCache, sharedKey, UpstreamLimited, type CacheKV } from "./gtcache";

/** In-memory stand-in for the shared store (plain commands only, with expiries on a fake clock). */
function fakeKV(clock: { t: number }) {
  const data = new Map<string, { v: string; exp: number }>();
  const live = (k: string) => {
    const e = data.get(k);
    if (e && e.exp <= clock.t) data.delete(k);
    return data.get(k);
  };
  const calls: string[] = [];
  const kv: CacheKV = {
    get: async (k) => (calls.push(`GET ${k}`), live(k)?.v ?? null),
    mget: async (keys) => (calls.push(`MGET ${keys.join(",")}`), keys.map((k) => live(k)?.v ?? null)),
    setEx: async (k, v, ttl) => void (calls.push(`SETEX ${k}`), data.set(k, { v, exp: clock.t + ttl * 1000 })),
    setNx: async (k, v, ttl) => {
      calls.push(`SETNX ${k}`);
      if (live(k)) return false;
      data.set(k, { v, exp: clock.t + ttl * 1000 });
      return true;
    },
    del: async (k) => void (calls.push(`DEL ${k}`), data.delete(k)),
    incrEx: async (k, ttl) => {
      const n = Number(live(k)?.v ?? 0) + 1;
      data.set(k, { v: String(n), exp: live(k)?.exp ?? clock.t + ttl * 1000 });
      return n;
    },
  };
  return { kv, data, calls };
}

function setup(opts: { kv?: CacheKV | null; fetch?: (k: string) => Promise<unknown>; clock?: { t: number } } = {}) {
  const clock = opts.clock ?? { t: 1_000_000 };
  let upstream = 0;
  const cache = createGeckoCache({
    kv: () => opts.kv ?? null,
    fetch: opts.fetch ?? (async (k) => (upstream++, { k, n: upstream })),
    now: () => clock.t,
    sleep: async (ms) => {
      clock.t += ms;
      await new Promise((r) => setImmediate(r));
    },
    perInstance: { priority: 3, detail: 2 },
    shared: { priority: 4, detail: 3 },
  });
  return { cache, clock, upstreamCalls: () => upstream };
}

test("works from memory only when no store is configured", async () => {
  const { cache, clock, upstreamCalls } = setup();
  const a = await cache.get("/x", 1000);
  const b = await cache.get("/x", 1000);
  assert.equal(upstreamCalls(), 1);
  assert.deepEqual(a.value, b.value);
  clock.t += 1500;
  await cache.get("/x", 1000);
  assert.equal(upstreamCalls(), 2);
});

test("a second instance reads the first one's answer from the store instead of the upstream", async () => {
  const clock = { t: 1_000_000 };
  const { kv } = fakeKV(clock);
  const one = setup({ kv, clock });
  const two = setup({ kv, clock });
  const a = await one.cache.get("/pools", 60_000, true);
  const b = await two.cache.get("/pools", 60_000, true);
  assert.equal(one.upstreamCalls(), 1);
  assert.equal(two.upstreamCalls(), 0);
  assert.deepEqual(b.value, a.value);
  assert.equal(b.stale, false);
});

test("store keys are hashed under gt: (the store adds the fliqo: prefix)", () => {
  assert.match(sharedKey("/networks/robinhood/pools?page=1"), /^gt:v1:[0-9a-f]{40}$/);
});

test("concurrent requests in one instance share one upstream call", async () => {
  let n = 0;
  const { cache } = setup({ fetch: async () => (n++, await new Promise((r) => setTimeout(r, 5)), "v") });
  await Promise.all([cache.get("/a", 1000), cache.get("/a", 1000), cache.get("/a", 1000)]);
  assert.equal(n, 1);
});

test("the site-wide budget refuses calls past the shared limit and serves stale data", async () => {
  const clock = { t: 6_000_000 };
  const { kv } = fakeKV(clock);
  const instances = [setup({ kv, clock }), setup({ kv, clock }), setup({ kv, clock })];
  const results: string[] = [];
  // Four different priority URLs spread over instances: the fifth call in the same minute is refused.
  for (let i = 0; i < 5; i++) {
    try {
      await instances[i % 3].cache.get(`/p${i}`, 60_000, true);
      results.push("ok");
    } catch (e) {
      results.push((e as Error).message);
    }
  }
  assert.deepEqual(results, ["ok", "ok", "ok", "ok", BUSY]);
});

test("a 429 pauses every instance through the store, and the expired answer is served as stale", async () => {
  const clock = { t: 9_000_000 };
  const { kv, data } = fakeKV(clock);
  let fail = false;
  const fetch = async () => {
    if (fail) throw new UpstreamLimited();
    return "fresh";
  };
  const one = setup({ kv, clock, fetch });
  await one.cache.get("/q", 1000, true);
  clock.t += 2000;
  fail = true;
  const s = await one.cache.get("/q", 1000, true);
  assert.equal(s.stale, true);
  assert.equal(s.value, "fresh");
  assert.ok(data.has(BLOCK_KEY));
  let asked = 0;
  const two = setup({ kv, clock, fetch: async () => (asked++, "x") });
  await assert.rejects(two.cache.get("/other", 1000, true), new RegExp(BUSY.slice(0, 20)));
  assert.equal(asked, 0);
});

test("an instance that loses the fetch lock waits for the winner's answer", async () => {
  const clock = { t: 12_000_000 };
  const { kv } = fakeKV(clock);
  await kv.setNx("gt:lock:" + sharedKey("/w").slice(6), "1", 10);
  const two = setup({ kv, clock });
  // The other instance stores its answer while we wait (just before our first poll).
  const get = kv.get;
  kv.get = async (k) => {
    await kv.setEx(sharedKey("/w"), JSON.stringify({ at: clock.t, ttl: 60_000, value: "theirs" }), 60);
    return get(k);
  };
  const r = await two.cache.get("/w", 60_000, true);
  assert.equal(r.value, "theirs");
  assert.equal(two.upstreamCalls(), 0);
});

test("a failing store is skipped and the cache keeps working from memory", async () => {
  const broken: CacheKV = {
    get: async () => Promise.reject(new Error("down")),
    mget: async () => Promise.reject(new Error("down")),
    setEx: async () => Promise.reject(new Error("down")),
    setNx: async () => Promise.reject(new Error("down")),
    del: async () => Promise.reject(new Error("down")),
    incrEx: async () => Promise.reject(new Error("down")),
  };
  const { cache, upstreamCalls } = setup({ kv: broken });
  const r = await cache.get("/z", 1000);
  assert.equal(upstreamCalls(), 1);
  assert.equal(r.stale, false);
  assert.equal(cache.stats().kvDown, true);
});

test("the per-instance budget keeps a share for priority reads", async () => {
  const { cache } = setup();
  await cache.get("/d1", 1000);
  await cache.get("/d2", 1000);
  await assert.rejects(cache.get("/d3", 1000));
  await cache.get("/p1", 1000, true);
  await assert.rejects(cache.get("/p2", 1000, true));
});
