import { poolKindOf, venueLabel, type PoolKind } from "@/config/dex";
import { logoFor } from "@/config/token-logos";

/*
 * Pool and trade shapes the site works with, and the normaliser for GeckoTerminal's JSON:API answers.
 * Shared by server and browser code. Every text field from the upstream is trimmed, stripped of control
 * characters and length-capped before it reaches a page; numbers that do not parse become null ("—").
 */

export type TokenRef = { address: string; symbol: string; name: string; decimals: number | null; logo: string | null };

export type PoolRow = {
  /** Lowercase pool address (20 bytes) or Uniswap v4 pool id (32 bytes). */
  address: string;
  name: string;
  venue: string;
  venueLabel: string;
  feeLabel: string | null;
  base: TokenRef;
  quote: TokenRef;
  liquidityUsd: number | null;
  volume1h: number | null;
  volume6h: number | null;
  volume24h: number | null;
  txns1h: number | null;
  txns24h: number | null;
  buys24h: number | null;
  sells24h: number | null;
  priceUsd: number | null;
  quotePriceUsd: number | null;
  fdvUsd: number | null;
  marketCapUsd: number | null;
  change1h: number | null;
  change24h: number | null;
  createdAt: number | null;
  kind: PoolKind | null;
};

export type Trade = {
  block: number | null;
  time: number | null;
  tx: string;
  wallet: string;
  side: "buy" | "sell";
  volumeUsd: number | null;
  fromToken: string;
  toToken: string;
  fromAmount: number | null;
  toAmount: number | null;
};

/** [unix seconds, open, high, low, close, volume USD] */
export type Candle = [number, number, number, number, number, number];

export type MarketLists = {
  at: number;
  stale: boolean;
  top: PoolRow[];
  trending: PoolRow[];
  fresh: PoolRow[];
  tape: { pool: string; name: string; trades: Trade[] } | null;
};

export const SOURCE_NAME = "GeckoTerminal";

type Json = Record<string, unknown>;

export function cleanText(v: unknown, max = 40): string {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, "").trim().slice(0, max);
}

export function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const HEX_ADDR = /^0x([0-9a-f]{40}|[0-9a-f]{64})$/;

/** Parses the network-prefixed id GeckoTerminal uses ("robinhood_0xabc…") into a lowercase address. */
function idAddress(id: unknown): string | null {
  if (typeof id !== "string") return null;
  const a = id.replace(/^[a-z0-9-]+_/, "").toLowerCase();
  return HEX_ADDR.test(a) ? a : null;
}

function tokenFrom(included: Map<string, Json>, id: unknown): TokenRef | null {
  const address = idAddress(id);
  if (!address) return null;
  const t = included.get(String(id));
  const a = (t?.attributes ?? {}) as Json;
  const decimals = typeof a.decimals === "number" && Number.isInteger(a.decimals) && a.decimals >= 0 && a.decimals <= 36 ? a.decimals : null;
  return {
    address,
    symbol: cleanText(a.symbol, 24) || `${address.slice(0, 6)}…`,
    name: cleanText(a.name, 48) || cleanText(a.symbol, 24) || address,
    decimals,
    logo: logoFor(address),
  };
}

function feeFrom(name: string): string | null {
  const m = name.match(/(\d+(?:\.\d+)?)%\s*$/);
  return m ? `${m[1]}%` : null;
}

/** One JSON:API pool list (data + included) into rows. Rows with an unusable address are dropped. */
export function normalizePools(body: unknown): PoolRow[] {
  const b = (body ?? {}) as { data?: unknown; included?: unknown };
  const data = Array.isArray(b.data) ? (b.data as Json[]) : [];
  const included = new Map<string, Json>();
  for (const i of Array.isArray(b.included) ? (b.included as Json[]) : []) if (typeof i.id === "string") included.set(i.id, i);
  const out: PoolRow[] = [];
  for (const p of data) {
    const row = normalizePool(p, included);
    if (row) out.push(row);
  }
  return out;
}

export function normalizePool(p: Json, included: Map<string, Json>): PoolRow | null {
  const a = (p.attributes ?? {}) as Json;
  const rel = (p.relationships ?? {}) as Record<string, { data?: { id?: unknown } }>;
  const address = typeof a.address === "string" ? a.address.toLowerCase() : idAddress(p.id);
  if (!address || !HEX_ADDR.test(address)) return null;
  const base = tokenFrom(included, rel.base_token?.data?.id);
  const quote = tokenFrom(included, rel.quote_token?.data?.id);
  if (!base || !quote) return null;
  const venue = cleanText(rel.dex?.data?.id, 48).toLowerCase() || "unknown";
  const name = cleanText(a.name, 64) || `${base.symbol} / ${quote.symbol}`;
  const tx = (a.transactions ?? {}) as Record<string, { buys?: unknown; sells?: unknown }>;
  const vol = (a.volume_usd ?? {}) as Record<string, unknown>;
  const chg = (a.price_change_percentage ?? {}) as Record<string, unknown>;
  const count = (w: { buys?: unknown; sells?: unknown } | undefined) => {
    const b2 = num(w?.buys);
    const s2 = num(w?.sells);
    return b2 === null && s2 === null ? null : (b2 ?? 0) + (s2 ?? 0);
  };
  const created = typeof a.pool_created_at === "string" ? Date.parse(a.pool_created_at) : NaN;
  return {
    address,
    name,
    venue,
    venueLabel: venueLabel(venue),
    feeLabel: feeFrom(name),
    base,
    quote,
    liquidityUsd: num(a.reserve_in_usd),
    volume1h: num(vol.h1),
    volume6h: num(vol.h6),
    volume24h: num(vol.h24),
    txns1h: count(tx.h1),
    txns24h: count(tx.h24),
    buys24h: num(tx.h24?.buys),
    sells24h: num(tx.h24?.sells),
    priceUsd: num(a.base_token_price_usd),
    quotePriceUsd: num(a.quote_token_price_usd),
    fdvUsd: num(a.fdv_usd),
    marketCapUsd: num(a.market_cap_usd),
    change1h: num(chg.h1),
    change24h: num(chg.h24),
    createdAt: Number.isFinite(created) ? created : null,
    kind: poolKindOf(address, venue),
  };
}

export function normalizeTrades(body: unknown, max = 60): Trade[] {
  const data = Array.isArray((body as { data?: unknown })?.data) ? ((body as { data: Json[] }).data) : [];
  const out: Trade[] = [];
  for (const d of data.slice(0, max)) {
    const a = (d.attributes ?? {}) as Json;
    const tx = typeof a.tx_hash === "string" && /^0x[0-9a-fA-F]{64}$/.test(a.tx_hash) ? a.tx_hash.toLowerCase() : null;
    const wallet = typeof a.tx_from_address === "string" && /^0x[0-9a-fA-F]{40}$/.test(a.tx_from_address) ? a.tx_from_address.toLowerCase() : null;
    if (!tx || !wallet) continue;
    const t = typeof a.block_timestamp === "string" ? Date.parse(a.block_timestamp) : NaN;
    out.push({
      block: num(a.block_number),
      time: Number.isFinite(t) ? t : null,
      tx,
      wallet,
      side: a.kind === "sell" ? "sell" : "buy",
      volumeUsd: num(a.volume_in_usd),
      fromToken: typeof a.from_token_address === "string" ? a.from_token_address.toLowerCase() : "",
      toToken: typeof a.to_token_address === "string" ? a.to_token_address.toLowerCase() : "",
      fromAmount: num(a.from_token_amount),
      toAmount: num(a.to_token_amount),
    });
  }
  return out;
}

export function normalizeCandles(body: unknown, max = 500): Candle[] {
  const list = (body as { data?: { attributes?: { ohlcv_list?: unknown } } })?.data?.attributes?.ohlcv_list;
  if (!Array.isArray(list)) return [];
  const out: Candle[] = [];
  for (const row of list.slice(0, max)) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const v = row.slice(0, 6).map((x) => num(x));
    if (v.some((x) => x === null)) continue;
    out.push(v as Candle);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/** Unique pools by address, first occurrence wins. */
export function uniquePools(...lists: PoolRow[][]): PoolRow[] {
  const seen = new Set<string>();
  const out: PoolRow[] = [];
  for (const l of lists) for (const p of l) if (!seen.has(p.address)) {
    seen.add(p.address);
    out.push(p);
  }
  return out;
}

/** What a token row is: the chain's own coin, a base asset, an official Stock Token or any other token. */
export type TokenKind = "native" | "crypto" | "stock" | "token";

/** One token as the market lists show it, priced from its most liquid pool. */
export type TokenRow = {
  address: string;
  symbol: string;
  name: string;
  logo: string | null;
  kind: TokenKind;
  priceUsd: number | null;
  change24h: number | null;
  volume24h: number | null;
  liquidityUsd: number | null;
  fdvUsd: number | null;
  marketCapUsd: number | null;
  createdAt: number | null;
  /** Most liquid pool of the token in the lists (its price source). */
  pool: string | null;
  venueLabel: string | null;
  /** Pool counterpart symbol, for "TOKEN / USDG" style labels. */
  pair: string | null;
};

export const NATIVE = "0x0000000000000000000000000000000000000000";

/**
 * Token rows from pool rows: each base token once, priced by its most liquid pool, 24 h volume summed over its
 * pools. `kindOf` tells native/crypto/stock apart; anything else is "token".
 */
export function tokensFromPools(pools: PoolRow[], kindOf: (address: string) => TokenKind): TokenRow[] {
  const by = new Map<string, { main: PoolRow; vol: number; hasVol: boolean }>();
  for (const p of pools) {
    const a = p.base.address;
    const cur = by.get(a);
    const vol = p.volume24h ?? 0;
    if (!cur) by.set(a, { main: p, vol, hasVol: p.volume24h !== null });
    else {
      cur.vol += vol;
      cur.hasVol ||= p.volume24h !== null;
      if ((p.liquidityUsd ?? -1) > (cur.main.liquidityUsd ?? -1)) cur.main = p;
    }
  }
  const out: TokenRow[] = [];
  for (const [address, { main, vol, hasVol }] of by) {
    out.push({
      address,
      symbol: main.base.symbol,
      name: main.base.name,
      logo: main.base.logo,
      kind: kindOf(address),
      priceUsd: main.priceUsd,
      change24h: main.change24h,
      volume24h: hasVol ? vol : null,
      liquidityUsd: main.liquidityUsd,
      fdvUsd: main.fdvUsd,
      marketCapUsd: main.marketCapUsd,
      createdAt: main.createdAt,
      pool: main.address,
      venueLabel: main.venueLabel,
      pair: main.quote.symbol,
    });
  }
  return out;
}

/** Largest 24 h moves among tokens with enough liquidity (a big move in a thin pool says little). */
export function movers(tokens: TokenRow[], minLiquidity = 25_000, n = 5) {
  const ok = tokens.filter((t) => t.change24h !== null && (t.liquidityUsd ?? 0) >= minLiquidity);
  const up = [...ok].filter((t) => (t.change24h ?? 0) > 0).sort((a, b) => (b.change24h ?? 0) - (a.change24h ?? 0)).slice(0, n);
  const down = [...ok].filter((t) => (t.change24h ?? 0) < 0).sort((a, b) => (a.change24h ?? 0) - (b.change24h ?? 0)).slice(0, n);
  return { up, down };
}

export type VenueSummary = { venue: string; label: string; pools: number; liquidityUsd: number; volume24h: number; txns24h: number; top: PoolRow | null };

/** Per-venue totals over the given pools (missing numbers count as zero), largest liquidity first. */
export function venueSummary(pools: PoolRow[]): VenueSummary[] {
  const map = new Map<string, VenueSummary>();
  for (const p of pools) {
    const v = map.get(p.venue) ?? { venue: p.venue, label: p.venueLabel, pools: 0, liquidityUsd: 0, volume24h: 0, txns24h: 0, top: null };
    v.pools += 1;
    v.liquidityUsd += p.liquidityUsd ?? 0;
    v.volume24h += p.volume24h ?? 0;
    v.txns24h += p.txns24h ?? 0;
    if (!v.top || (p.volume24h ?? 0) > (v.top.volume24h ?? 0)) v.top = p;
    map.set(p.venue, v);
  }
  return [...map.values()].sort((a, b) => b.liquidityUsd - a.liquidityUsd);
}

/** True when a pool address or v4 id is well formed. */
export const isPoolAddress = (v: string) => HEX_ADDR.test(v.toLowerCase());

/** Recent activity of a pool: trades in the last hour, else an hourly share of the last 24 hours, else 0. */
export function recentTxns(p: PoolRow): number {
  if (p.txns1h !== null) return p.txns1h;
  return p.txns24h !== null ? p.txns24h / 24 : 0;
}

/**
 * Pools the swap tape reads, busiest first by trades in the last hour (not by 24 h volume: a pool can show a large
 * volume and no trades for hours). Any venue counts (v2, v3, v4, curves). Pools of a token against a hub (ETH,
 * WETH, USDG) come first, one pool per token so the tape shows several tokens; pools of two hubs only fill the
 * remaining places. Pools without any recent trade are never picked.
 */
export function pickTapePools(pools: PoolRow[], hubs: ReadonlySet<string>, n: number): PoolRow[] {
  const active = pools.filter((p) => recentTxns(p) > 0).sort((a, b) => recentTxns(b) - recentTxns(a) || (b.volume24h ?? 0) - (a.volume24h ?? 0));
  const hubPair = (p: PoolRow) => hubs.has(p.base.address) && hubs.has(p.quote.address);
  const out: PoolRow[] = [];
  const tokens = new Set<string>();
  for (const p of active) {
    if (out.length >= n) break;
    if (hubPair(p)) continue;
    const token = hubs.has(p.base.address) ? p.quote.address : p.base.address;
    if (tokens.has(token)) continue;
    tokens.add(token);
    out.push(p);
  }
  for (const p of active) {
    if (out.length >= n) break;
    if (hubPair(p)) out.push(p);
  }
  return out;
}

/** Newest trade time of a list (ms), or null. */
export function newestTrade(list: Trade[]): number | null {
  let max: number | null = null;
  for (const t of list) if (t.time !== null && (max === null || t.time > max)) max = t.time;
  return max;
}
