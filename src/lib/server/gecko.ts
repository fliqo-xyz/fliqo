import "server-only";
import { GT_NETWORK } from "@/config/dex";
import { createGeckoCache, UpstreamLimited, type Fetched } from "@/lib/gtcache";
import { readCappedResponse } from "@/lib/server/capped";
import { getStore } from "@/lib/server/store";

/*
 * GeckoTerminal public API (no key) for pool lists, volumes, trades and candles on Robinhood Chain.
 * The free tier allows a few dozen calls a minute for the whole site, so every answer is cached per URL in memory
 * and, when a store is configured, in Redis shared by every instance (src/lib/gtcache.ts); concurrent requests for
 * one URL share a single upstream call, outbound calls are capped per instance and site-wide, and a cached answer
 * keeps being served (marked stale) when the upstream refuses or fails.
 */

const BASE = "https://api.geckoterminal.com/api/v2";
const MAX_BYTES = 3_000_000;
/** Outbound budget for this server instance: calls per rolling minute. */
export const OUTBOUND_PER_MINUTE = 24;
/** Share of that budget open to per-pool lookups, so visitors asking for many pools never starve the lists. */
export const DETAIL_PER_MINUTE = 14;
/** Site-wide budget per clock minute across every instance (shared store only); the free tier allows about 30. */
export const SHARED_PER_MINUTE = 28;
export const SHARED_DETAIL_PER_MINUTE = 18;
export type { Fetched };

const cache = createGeckoCache({
  kv: getStore,
  fetch: upstream,
  perInstance: { priority: OUTBOUND_PER_MINUTE, detail: DETAIL_PER_MINUTE },
  shared: { priority: SHARED_PER_MINUTE, detail: SHARED_DETAIL_PER_MINUTE },
});

async function upstream(key: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${BASE}${key}`, {
      headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (compatible; trade planner)" },
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (res.status === 429) throw new UpstreamLimited();
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
  return cache.get<T>(key, ttl, priority);
}

/** Counters of this instance (cache hits per level, upstream calls, refusals, store errors). */
export const geckoStats = () => cache.stats();

/** Test hook: clears every cached answer and the outbound window. */
export function resetGeckoForTests() {
  cache.reset();
}
