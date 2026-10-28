import "server-only";
import { USDG, WETH } from "@/config/brand";
import { stockOf } from "@/config/stocks";
import { logoFor } from "@/config/token-logos";
import { gecko } from "@/lib/server/gecko";
import {
  NATIVE,
  movers,
  normalizeCandles,
  normalizePools,
  normalizeTrades,
  tokensFromPools,
  uniquePools,
  type Candle,
  type PoolRow,
  type TokenKind,
  type TokenRow,
  type Trade,
  venueSummary,
  type VenueSummary,
} from "@/lib/market";

/*
 * Market lists, token rows and pool details from GeckoTerminal, normalised. Cache times keep the whole site well
 * inside the public API's free budget however many visitors there are (see gecko.ts). Prices are what each token's
 * most liquid listed pool says; the chain itself is read for quotes and token facts (quote.ts, tokenfacts.ts).
 */

const LIST_TTL = 180_000;
const DETAIL_TTL = 120_000;
const TRADES_TTL = 45_000;
const CANDLE_TTL = 120_000;
const INCLUDE = "include=base_token,quote_token,dex";
export const TOP_PAGES = 3;

const WETH_LOW = WETH.toLowerCase();
const USDG_LOW = USDG.address.toLowerCase();

export function kindOf(address: string): TokenKind {
  const a = address.toLowerCase();
  if (a === NATIVE) return "native";
  if (a === WETH_LOW || a === USDG_LOW) return "crypto";
  if (stockOf(a)) return "stock";
  return "token";
}

export async function topPools(): Promise<{ pools: PoolRow[]; at: number; stale: boolean }> {
  const pages = await Promise.allSettled(
    Array.from({ length: TOP_PAGES }, (_, i) => gecko<unknown>(`/pools?page=${i + 1}&sort=h24_volume_usd_desc&${INCLUDE}`, LIST_TTL, true)),
  );
  const ok = pages.flatMap((p) => (p.status === "fulfilled" ? [p.value] : []));
  if (!ok.length) throw new Error("Pool lists are not available right now.");
  return {
    pools: uniquePools(...ok.map((p) => normalizePools(p.value))),
    at: Math.min(...ok.map((p) => p.at)),
    stale: ok.some((p) => p.stale) || ok.length < pages.length,
  };
}

async function list(path: string) {
  try {
    const r = await gecko<unknown>(`${path}${path.includes("?") ? "&" : "?"}${INCLUDE}`, LIST_TTL, true);
    return { pools: normalizePools(r.value), stale: r.stale, at: r.at };
  } catch {
    return { pools: [] as PoolRow[], stale: true, at: Date.now() };
  }
}

export async function trades(pool: string, priority = false): Promise<Trade[]> {
  const r = await gecko<unknown>(`/pools/${pool}/trades`, TRADES_TTL, priority);
  return normalizeTrades(r.value);
}

export type MarketBoard = {
  at: number;
  stale: boolean;
  /** ETH (native, priced by its WETH pool), WETH, USDG and the busiest other tokens. */
  tokens: TokenRow[];
  /** Pools created recently (newest first). */
  fresh: PoolRow[];
  trending: PoolRow[];
  gainers: TokenRow[];
  losers: TokenRow[];
  stats: { tokens: number; volume24h: number | null; freshPools: number; pools: number };
};

/** The market board: token rows for the lists, new and trending pools, movers. */
export async function marketBoard(): Promise<MarketBoard> {
  const [top, trending, fresh] = await Promise.all([topPools(), list("/trending_pools?page=1"), list("/new_pools?page=1")]);
  const all = uniquePools(top.pools, trending.pools);
  // v4 pools list native ETH as the zero address; ETH gets one synthetic row priced from WETH instead.
  const rows = tokensFromPools(all, kindOf).filter((r) => r.address !== NATIVE);
  const weth = rows.find((r) => r.address === WETH_LOW) ?? null;
  const usdg = rows.find((r) => r.address === USDG_LOW) ?? null;
  const native: TokenRow | null = weth
    ? { ...weth, address: NATIVE, symbol: "ETH", name: "Ether", logo: logoFor(NATIVE), kind: "native" }
    : null;
  const rest = rows.filter((r) => r.address !== WETH_LOW && r.address !== USDG_LOW).sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0));
  const tokens = [native, usdg, weth, ...rest].filter((x): x is TokenRow => x !== null);
  const freshPools = uniquePools(fresh.pools).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  const { up, down } = movers(tokens);
  const volume = top.pools.reduce((s, p) => s + (p.volume24h ?? 0), 0);
  return {
    at: Math.min(top.at, trending.at, fresh.at),
    stale: top.stale || trending.stale || fresh.stale,
    tokens,
    fresh: freshPools,
    trending: trending.pools,
    gainers: up,
    losers: down,
    stats: {
      tokens: tokens.length,
      volume24h: top.pools.length ? volume : null,
      freshPools: freshPools.filter((p) => p.createdAt !== null && Date.now() - p.createdAt < 86_400_000).length,
      pools: all.length,
    },
  };
}

/** Every pool the lists currently know (for search and v4 quote candidates). */
export async function universe(): Promise<PoolRow[]> {
  const [top, trending, fresh] = await Promise.all([topPools().then((t) => t.pools).catch(() => [] as PoolRow[]), list("/trending_pools?page=1"), list("/new_pools?page=1")]);
  return uniquePools(top, trending.pools, fresh.pools);
}

/** Pools that hold a token (GeckoTerminal's own index for that token), most liquid first. */
export async function tokenPools(address: string): Promise<{ pools: PoolRow[]; at: number; stale: boolean }> {
  const r = await gecko<unknown>(`/tokens/${address.toLowerCase()}/pools?page=1&${INCLUDE}`, DETAIL_TTL, true);
  const pools = normalizePools(r.value).sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0));
  return { pools, at: r.at, stale: r.stale };
}

export const TIMEFRAMES = {
  "1m": { path: "minute", aggregate: 1, limit: 120 },
  "5m": { path: "minute", aggregate: 5, limit: 120 },
  "15m": { path: "minute", aggregate: 15, limit: 120 },
  "1h": { path: "hour", aggregate: 1, limit: 96 },
  "4h": { path: "hour", aggregate: 4, limit: 90 },
  "1d": { path: "day", aggregate: 1, limit: 90 },
  "1w": { path: "day", aggregate: 1, limit: 180 },
} as const;
export type Timeframe = keyof typeof TIMEFRAMES;

export async function poolDetail(address: string, tf: Timeframe, quoteSide = false): Promise<{ pool: PoolRow | null; trades: Trade[]; candles: Candle[]; at: number; stale: boolean }> {
  const t = TIMEFRAMES[tf];
  const [d, tr, c] = await Promise.allSettled([
    gecko<unknown>(`/pools/${address}?${INCLUDE}`, DETAIL_TTL),
    gecko<unknown>(`/pools/${address}/trades`, TRADES_TTL),
    gecko<unknown>(`/pools/${address}/ohlcv/${t.path}?aggregate=${t.aggregate}&limit=${t.limit}&currency=usd${quoteSide ? "&token=quote" : ""}`, CANDLE_TTL),
  ]);
  let pool: PoolRow | null = null;
  if (d.status === "fulfilled") {
    const v = d.value.value as { data?: unknown; included?: unknown };
    pool = normalizePools({ data: v?.data ? [v.data] : [], included: v?.included })[0] ?? null;
  }
  let candles = c.status === "fulfilled" ? normalizeCandles(c.value.value) : [];
  // "1w" shows daily candles grouped by week.
  if (tf === "1w" && candles.length) candles = weekly(candles);
  return {
    pool,
    trades: tr.status === "fulfilled" ? normalizeTrades(tr.value.value) : [],
    candles,
    at: d.status === "fulfilled" ? d.value.at : Date.now(),
    stale: d.status !== "fulfilled" || d.value.stale,
  };
}

function weekly(days: Candle[]): Candle[] {
  const out: Candle[] = [];
  for (const k of days) {
    const wk = Math.floor(k[0] / 604_800) * 604_800;
    const last = out[out.length - 1];
    if (last && last[0] === wk) {
      last[2] = Math.max(last[2], k[2]);
      last[3] = Math.min(last[3], k[3]);
      last[4] = k[4];
      last[5] += k[5];
    } else out.push([wk, k[1], k[2], k[3], k[4], k[5]]);
  }
  return out;
}

const SPARK_TTL = 600_000;

/**
 * 24 hourly closes of each pool's base token, for sparklines (one low-priority call per pool, cached ten minutes).
 * A pool the shared GeckoTerminal budget cannot serve right now comes back as null (drawn as a flat dash).
 */
export async function sparks(pools: string[]): Promise<Record<string, number[] | null>> {
  const out: Record<string, number[] | null> = {};
  await Promise.all(
    pools.map(async (p) => {
      try {
        const c = await gecko<unknown>(`/pools/${p}/ohlcv/hour?aggregate=1&limit=24&currency=usd`, SPARK_TTL);
        const closes = normalizeCandles(c.value).map((k) => k[4]);
        out[p] = closes.length > 1 ? closes : null;
      } catch {
        out[p] = null;
      }
    }),
  );
  return out;
}

/** One swap of the site-wide tape: a trade of one of the busiest pools, with that pool's names attached. */
export type TapeItem = Trade & { pool: string; poolName: string; base: { address: string; symbol: string }; quoteSymbol: string };

/**
 * Recent swaps across the busiest pools (GeckoTerminal trades of the top `n` pools by 24h volume, merged and
 * sorted newest first). Low-priority calls, cached 45 s each, so the tape never starves the lists.
 */
export async function tape(n = 3): Promise<{ at: number; stale: boolean; items: TapeItem[] }> {
  const top = await topPools();
  // Hub-only pairs (ETH, WETH, USDG against each other) are skipped: the tape follows the tokens traded against them.
  const hub = new Set([NATIVE, WETH_LOW, USDG_LOW]);
  const pools = [...top.pools].filter((p) => !hub.has(p.base.address)).sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0)).slice(0, n);
  const lists = await Promise.allSettled(pools.map((p) => trades(p.address)));
  const items: TapeItem[] = [];
  lists.forEach((r, i) => {
    if (r.status !== "fulfilled") return;
    const p = pools[i];
    for (const t of r.value.slice(0, 20)) items.push({ ...t, pool: p.address, poolName: p.name, base: { address: p.base.address, symbol: p.base.symbol }, quoteSymbol: p.quote.symbol });
  });
  items.sort((a, b) => (b.time ?? 0) - (a.time ?? 0));
  return { at: top.at, stale: top.stale || lists.some((r) => r.status !== "fulfilled"), items: items.slice(0, 48) };
}

export type Overview = {
  at: number;
  stale: boolean;
  pools: number;
  liquidityUsd: number;
  volume24h: number;
  txns24h: number;
  venues: VenueSummary[];
  /** Liquidity by what the pools are paired with (ETH, USDG, Stock Tokens, other tokens). */
  pairedWith: { key: "eth" | "usdg" | "stock" | "other"; label: string; pools: number; liquidityUsd: number }[];
  deepest: PoolRow[];
};

/** Liquidity overview of every pool the lists know right now (busiest, trending and new pools on GeckoTerminal). */
export async function overview(): Promise<Overview> {
  const [top, trending, fresh] = await Promise.all([topPools(), list("/trending_pools?page=1"), list("/new_pools?page=1")]);
  const all = uniquePools(top.pools, trending.pools, fresh.pools);
  const sum = (f: (p: PoolRow) => number | null) => all.reduce((s, p) => s + (f(p) ?? 0), 0);
  const groups = {
    eth: { label: "ETH / WETH", pools: 0, liquidityUsd: 0 },
    usdg: { label: "USDG", pools: 0, liquidityUsd: 0 },
    stock: { label: "Stock Tokens", pools: 0, liquidityUsd: 0 },
    other: { label: "Other tokens", pools: 0, liquidityUsd: 0 },
  };
  for (const p of all) {
    const q = p.quote.address;
    const key = q === NATIVE || q === WETH_LOW ? "eth" : q === USDG_LOW ? "usdg" : stockOf(q) ? "stock" : "other";
    groups[key].pools += 1;
    groups[key].liquidityUsd += p.liquidityUsd ?? 0;
  }
  return {
    at: Math.min(top.at, trending.at, fresh.at),
    stale: top.stale || trending.stale || fresh.stale,
    pools: all.length,
    liquidityUsd: sum((p) => p.liquidityUsd),
    volume24h: sum((p) => p.volume24h),
    txns24h: sum((p) => p.txns24h),
    venues: venueSummary(all),
    pairedWith: (Object.keys(groups) as (keyof typeof groups)[]).map((k) => ({ key: k, ...groups[k] })),
    deepest: [...all].sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0)).slice(0, 12),
  };
}

export type PriceRow = { address: string; priceUsd: number | null; change24h: number | null; volume24h: number | null; liquidityUsd: number | null; marketCapUsd: number | null };

/**
 * Prices of up to 30 tokens in one GeckoTerminal call (simple token prices with 24h change, volume, total reserve
 * and market cap). Used by the watchlist and its alerts; cached two minutes per address set.
 */
export async function simplePrices(addresses: string[]): Promise<{ at: number; stale: boolean; rows: PriceRow[] }> {
  const list = [...new Set(addresses.map((a) => a.toLowerCase()))].slice(0, 30).sort();
  if (!list.length) return { at: Date.now(), stale: false, rows: [] };
  const r = await gecko<unknown>(
    `/simple/networks/robinhood/token_price/${list.join(",")}?include_24hr_vol=true&include_24hr_price_change=true&include_total_reserve_in_usd=true&include_market_cap=true`,
    120_000,
    true,
  );
  type Attr = Record<string, Record<string, unknown> | undefined>;
  const a = ((r.value as { data?: { attributes?: Attr } })?.data?.attributes ?? {}) as Attr;
  const n = (k: string, addr: string) => {
    const v = a[k]?.[addr];
    const x = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
    return Number.isFinite(x) ? x : null;
  };
  return {
    at: r.at,
    stale: r.stale,
    rows: list.map((addr) => ({
      address: addr,
      priceUsd: n("token_prices", addr),
      change24h: n("h24_price_change_percentage", addr),
      volume24h: n("h24_volume_usd", addr),
      liquidityUsd: n("total_reserve_in_usd", addr),
      marketCapUsd: n("market_cap_usd", addr),
    })),
  };
}
