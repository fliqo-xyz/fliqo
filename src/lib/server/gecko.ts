import "server-only";
import { GT_NETWORK } from "@/config/dex";
import { readCappedResponse } from "@/lib/server/capped";

/*
 * GeckoTerminal public API (no key) for pool lists, volumes, trades and candles on Robinhood Chain.
 * The free tier allows a few dozen calls a minute for the whole site, so every answer is cached per URL,
 * concurrent requests for one URL share a single upstream call, outbound calls are capped per minute, and a
 * cached answer keeps being served (marked stale) when the upstream refuses or fails.
 */

const BASE = "https://api.geckoterminal.com/api/v2";
const MAX_BYTES = 3_000_000;
/** Outbound budget for this server instance: calls per rolling minute. */
export const OUTBOUND_PER_MINUTE = 24;
/** Share of that budget open to per-pool lookups, so visitors asking for many pools never starve the lists. */
export const DETAIL_PER_MINUTE = 14;
/** How long a cached answer may still be served after it expired, when the upstream cannot answer. */
const MAX_STALE_MS = 30 * 60_000;
const MAX_ENTRIES = 400;

type Entry = { at: number; ttl: number; value: unknown };
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();
const sent: number[] = [];
let blockedUntil = 0;

export type Fetched<T> = { value: T; at: number; stale: boolean };

function takeSlot(now: number, priority: boolean) {
  while (sent.length && now - sent[0] > 60_000) sent.shift();
  if (now < blockedUntil || sent.length >= (priority ? OUTBOUND_PER_MINUTE : DETAIL_PER_MINUTE)) return false;
  sent.push(now);
  return true;
}

function remember(key: string, e: Entry) {
  cache.delete(key);
  cache.set(key, e);
  while (cache.size > MAX_ENTRIES) {
    const first = cache.keys().next().value;
    if (first === undefined) break;
    cache.delete(first);
  }
}

async function upstream(path: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (compatible; trade planner)" },
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (res.status === 429) {
      blockedUntil = Date.now() + 20_000;
      throw new Error("rate limited upstream");
    }
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const text = await readCappedResponse(res, MAX_BYTES);
    if (text === null) {
      ctrl.abort();
      throw new Error("upstream answer too large");
    }
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Cached GET of a GeckoTerminal path under /networks/robinhood. `ttl` in ms. Resolves the cached value (possibly
 * stale) or rejects when nothing usable exists yet. `priority` marks the shared list reads.
 */
export async function gecko<T>(path: string, ttl: number, priority = false): Promise<Fetched<T>> {
  // "/simple/…" paths (batch token prices) already carry the network; everything else lives under it.
  const key = path.startsWith("/simple/") ? path : `/networks/${GT_NETWORK}${path}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < hit.ttl) return { value: hit.value as T, at: hit.at, stale: false };
  let job = inflight.get(key);
  if (!job) {
    if (!takeSlot(now, priority)) {
      if (hit && now - hit.at < hit.ttl + MAX_STALE_MS) return { value: hit.value as T, at: hit.at, stale: true };
      throw new Error("Market data is busy. Try again in a minute.");
    }
    job = upstream(key)
      .then((value) => {
        remember(key, { at: Date.now(), ttl, value });
        return value;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, job);
  }
  try {
    const value = (await job) as T;
    return { value, at: cache.get(key)?.at ?? Date.now(), stale: false };
  } catch (e) {
    if (hit && now - hit.at < hit.ttl + MAX_STALE_MS) return { value: hit.value as T, at: hit.at, stale: true };
    throw e instanceof Error ? e : new Error("Market data is not available.");
  }
}

/** Test hook: clears every cached answer and the outbound window. */
export function resetGeckoForTests() {
  cache.clear();
  inflight.clear();
  sent.length = 0;
  blockedUntil = 0;
}
