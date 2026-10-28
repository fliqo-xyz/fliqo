import type { Store } from "@/lib/server/store";
import { DIRECT, aggregateKey, isAggregate } from "@/lib/netkey";

/*
 * Fixed-window counters.
 *
 * With a store (Redis in production) every counter is a store key with its
 * own TTL, shared by all server instances. If the store fails, the request is
 * refused: the routes behind these limits need the store anyway.
 *
 * Without any store (a local run, or the RPC relay deployed without Redis)
 * counters live in this process: per instance and best-effort. Memory has a
 * hard cap: 80% for leaf keys, 20% for pinned entries (aggregates and
 * "direct") in a separate map. Pinned entries are never evicted inside their
 * window; leaves are, lowest count among the oldest first, so evicting a leaf
 * never resets an aggregate. When the pinned map is full a new aggregate is
 * charged to one of OVERFLOW_SHARDS overflow counters (picked by a hash of
 * the aggregate key) per bucket and window, with the aggregate budget: a
 * flood of fresh networks never goes unbudgeted, and one flood only uses up
 * the shards it lands in instead of every untracked network's budget.
 * Every step is O(sample).
 */

const SHARED_FACTOR = 20; // "direct" stands for every visitor at once
const AGGREGATE_FACTOR = 16; // a /24 or /48 may hold many legitimate users
export const MEMORY_KEYS = 10_000;
const SAMPLE = 64;

type Entry = { n: number; until: number };
/** Pinned entries (aggregates and "direct") live in their own map, capped at 20% of the total. */
export const PINNED_KEYS = Math.floor(MEMORY_KEYS * 0.2);
const LEAF_KEYS = MEMORY_KEYS - PINNED_KEYS;
const leaves = new Map<string, Entry>();
const pinnedMap = new Map<string, Entry>();
/** Overflow counters: at most OVERFLOW_SHARDS live entries per bucket and window, so this map stays small. */
export const OVERFLOW_SHARDS = 64;
/** All shards together never exceed this many aggregate budgets per bucket and window. */
export const OVERFLOW_TOTAL_FACTOR = 8;
/** Per-process random seed, so a caller cannot pick which shard its block lands in. */
const SHARD_SEED = (Math.random() * 0x1_0000_0000) >>> 0;
const overflow = new Map<string, Entry>();
export const memorySize = () => leaves.size + pinnedMap.size + overflow.size;

/** Drops the expired entries among the oldest SAMPLE of a map. O(SAMPLE). */
function sweep(map: Map<string, Entry>, now: number) {
  let i = 0;
  for (const [k, e] of map) {
    if (i++ >= SAMPLE) break;
    if (e.until < now) map.delete(k);
  }
}

/** Frees one leaf slot: expired first, else the lowest count among the oldest SAMPLE leaves. O(SAMPLE). */
function makeLeafRoom(now: number) {
  sweep(leaves, now);
  if (leaves.size < LEAF_KEYS) return;
  let victim: string | null = null;
  let low = Infinity;
  let i = 0;
  for (const [k, e] of leaves) {
    if (i++ >= SAMPLE) break;
    if (e.n < low) {
      victim = k;
      low = e.n;
    }
  }
  if (victim !== null) leaves.delete(victim);
}

/**
 * Adds to an in-memory counter. A leaf always gets a slot (the leaf map only
 * holds evictable entries). A pinned entry is never evicted inside its
 * window; when the pinned map is full a new pinned key is not tracked and
 * null is returned, so its check is skipped for this window.
 */
function memoryAdd(k: string, units: number, windowSec: number, pinned: boolean): number | null {
  const now = Date.now();
  const map = pinned ? pinnedMap : leaves;
  const hit = map.get(k);
  if (hit && hit.until > now) {
    hit.n += units;
    return hit.n;
  }
  if (!hit) {
    if (pinned) {
      if (pinnedMap.size >= PINNED_KEYS) sweep(pinnedMap, now);
      if (pinnedMap.size >= PINNED_KEYS) return null;
    } else if (leaves.size >= LEAF_KEYS) makeLeafRoom(now);
  }
  map.set(k, { n: units, until: now + windowSec * 1000 });
  return units;
}

/**
 * Adds units to one counter. With a store, the store is the only source of
 * truth: if it fails the request is refused (fail closed). Memory counts only
 * when no store is configured at all.
 */
async function add(store: Store | null, k: string, units: number, windowSec: number, pinned: boolean): Promise<number | null> {
  if (store) {
    try {
      return await store.incrByEx(k, units, windowSec + 5);
    } catch {
      return Infinity;
    }
  }
  return memoryAdd(k, units, windowSec, pinned);
}

/** Seeded FNV-1a, enough to spread aggregate keys over the overflow shards. */
function shardOf(key: string) {
  let h = SHARD_SEED;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
  return (h >>> 0) % OVERFLOW_SHARDS;
}

/** Sharded counter for aggregates that memory could not pin this window. Expired windows are dropped first. */
function overflowAddShard(bucket: string, agg: string, slot: number, units: number, windowSec: number) {
  const now = Date.now();
  const k = `rl:${bucket}:overflow:${shardOf(agg)}:${slot}`;
  const hit = overflow.get(k);
  if (hit && hit.until > now) return (hit.n += units);
  for (const [key, e] of overflow) if (e.until <= now) overflow.delete(key);
  overflow.set(k, { n: units, until: now + windowSec * 1000 });
  return units;
}

/** One total per bucket and window across every shard (expired entries are swept by the shard counter). */
function overflowTotal(bucket: string, slot: number, units: number, windowSec: number) {
  const now = Date.now();
  const k = `rl:${bucket}:overflow:all:${slot}`;
  const hit = overflow.get(k);
  if (hit && hit.until > now) return (hit.n += units);
  overflow.set(k, { n: units, until: now + windowSec * 1000 });
  return units;
}

/** Charges the block's shard, then the bucket total only if the shard accepted; Infinity once the total is spent. */
function overflowAdd(bucket: string, agg: string, slot: number, units: number, windowSec: number, budget: number) {
  const shard = overflowAddShard(bucket, agg, slot, units, windowSec);
  if (shard > budget) return shard; // refused by its own shard: the shared total is not charged
  return overflowTotal(bucket, slot, units, windowSec) > budget * OVERFLOW_TOTAL_FACTOR ? Infinity : shard;
}

export type SpendOptions = {
  /** Also charge the /24 or /48 aggregate (cost and abuse buckets only, never verified-wallet limits). */
  aggregate?: boolean;
};

/** Adds `units` to the caller's window; true while every counter stays within budget. */
export async function spend(store: Store | null, bucket: string, key: string, units: number, max: number, windowSec: number, opts: SpendOptions = {}) {
  const slot = Math.floor(Date.now() / 1000 / windowSec);
  const own = key === DIRECT ? max * SHARED_FACTOR : max;
  const leaf = await add(store, `rl:${bucket}:${key}:${slot}`, units, windowSec, isAggregate(key));
  // "direct" is pinned; if memory could not track it, it is refused, never let through.
  let ok = leaf !== null && leaf <= own;
  const agg = opts.aggregate ? aggregateKey(key) : null;
  if (agg) {
    const wide = await add(store, `rl:${bucket}:${agg}:${slot}`, units, windowSec, true);
    const budget = max * AGGREGATE_FACTOR;
    // An aggregate that memory could not pin is charged to the shared overflow counter, never skipped.
    ok = ok && (wide !== null ? wide <= budget : overflowAdd(bucket, agg, slot, units, windowSec, budget) <= budget);
  }
  return ok;
}
