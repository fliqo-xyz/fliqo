/*
 * Watchlist and alert thresholds: the shapes the browser keeps, the compact byte form saved in FliqoWatchBook, and
 * the threshold check run in the open tab. Pure functions, shared by the pages and the tests.
 *
 * Saved form (UTF-8 JSON, at most MAX_SETTINGS bytes): {"v":1,"r":[[index, priceAbove, priceBelow, move24h, liqBelow], …]}
 * where index points into the token list saved next to it and each threshold is a number or null (off).
 */

export const MAX_TOKENS = 50;
export const MAX_SETTINGS = 1536;

export type Rule = {
  /** Alert when the USD price rises to or above this. */
  priceAbove: number | null;
  /** Alert when the USD price falls to or below this. */
  priceBelow: number | null;
  /** Alert when the 24h move is at least this many percent either way. */
  move24h: number | null;
  /** Alert when the token's main-pool liquidity (USD) falls below this. */
  liqBelow: number | null;
};

export type Watch = { tokens: string[]; rules: Record<string, Rule> };

export const EMPTY_RULE: Rule = { priceAbove: null, priceBelow: null, move24h: null, liqBelow: null };
const ADDR = /^0x[0-9a-f]{40}$/;

const okNum = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 && v < 1e15 ? v : null);

export function cleanRule(v: unknown): Rule {
  const r = (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;
  return { priceAbove: okNum(r.priceAbove), priceBelow: okNum(r.priceBelow), move24h: okNum(r.move24h), liqBelow: okNum(r.liqBelow) };
}

export const hasRule = (r: Rule | undefined) => Boolean(r && (r.priceAbove || r.priceBelow || r.move24h || r.liqBelow));

/** A stored watchlist, validated: lowercase unique addresses (at most 50), rules only for listed tokens. */
export function cleanWatch(v: unknown): Watch {
  const o = (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;
  const list = Array.isArray(o.tokens) ? o.tokens : [];
  const tokens = [...new Set(list.filter((a): a is string => typeof a === "string").map((a) => a.toLowerCase()).filter((a) => ADDR.test(a) && !/^0x0{40}$/.test(a)))].slice(0, MAX_TOKENS);
  const raw = (typeof o.rules === "object" && o.rules !== null ? o.rules : {}) as Record<string, unknown>;
  const rules: Record<string, Rule> = {};
  for (const t of tokens) if (raw[t]) rules[t] = cleanRule(raw[t]);
  return { tokens, rules };
}

const trim = (n: number | null) => (n === null ? null : Number(n.toPrecision(8)));

/** Settings bytes (UTF-8 JSON) for the rules of `w`; throws when they exceed MAX_SETTINGS. */
export function encodeSettings(w: Watch): Uint8Array {
  const rows = w.tokens
    .map((t, i) => [i, w.rules[t]] as const)
    .filter(([, r]) => hasRule(r))
    .map(([i, r]) => [i, trim(r!.priceAbove), trim(r!.priceBelow), trim(r!.move24h), trim(r!.liqBelow)]);
  const bytes = new TextEncoder().encode(JSON.stringify({ v: 1, r: rows }));
  if (bytes.length > MAX_SETTINGS) throw new Error(`Alert settings take ${bytes.length} bytes; the contract keeps at most ${MAX_SETTINGS}.`);
  return bytes;
}

/** Rules decoded from saved settings for the saved token list. Anything malformed is skipped, never trusted. */
export function decodeSettings(bytes: Uint8Array, tokens: string[]): Record<string, Rule> {
  const out: Record<string, Rule> = {};
  if (bytes.length === 0 || bytes.length > MAX_SETTINGS) return out;
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return out;
  }
  const rows = (body as { v?: unknown; r?: unknown })?.v === 1 ? (body as { r?: unknown }).r : null;
  if (!Array.isArray(rows)) return out;
  for (const row of rows.slice(0, MAX_TOKENS)) {
    if (!Array.isArray(row) || row.length !== 5 || !Number.isInteger(row[0])) continue;
    const t = tokens[row[0] as number]?.toLowerCase();
    if (!t || !ADDR.test(t)) continue;
    const r = cleanRule({ priceAbove: row[1], priceBelow: row[2], move24h: row[3], liqBelow: row[4] });
    if (hasRule(r)) out[t] = r;
  }
  return out;
}

export type Market = { priceUsd: number | null; change24h: number | null; liquidityUsd: number | null };
export type Hit = { kind: keyof Rule; text: string };

/** Which thresholds of `r` the current market numbers meet. Unknown numbers ("—") never trigger. */
export function evaluate(r: Rule | undefined, m: Market | undefined): Hit[] {
  if (!r || !m) return [];
  const hits: Hit[] = [];
  if (r.priceAbove !== null && m.priceUsd !== null && m.priceUsd >= r.priceAbove) hits.push({ kind: "priceAbove", text: `price at or above ${r.priceAbove}` });
  if (r.priceBelow !== null && m.priceUsd !== null && m.priceUsd <= r.priceBelow) hits.push({ kind: "priceBelow", text: `price at or below ${r.priceBelow}` });
  if (r.move24h !== null && m.change24h !== null && Math.abs(m.change24h) >= r.move24h) hits.push({ kind: "move24h", text: `24h move of ${m.change24h.toFixed(1)}% (threshold ${r.move24h}%)` });
  if (r.liqBelow !== null && m.liquidityUsd !== null && m.liquidityUsd < r.liqBelow) hits.push({ kind: "liqBelow", text: `liquidity under $${r.liqBelow.toLocaleString("en-US")}` });
  return hits;
}

/** True when two watchlists hold the same tokens in the same order and the same rules. */
export function sameWatch(a: Watch, b: Watch): boolean {
  if (a.tokens.length !== b.tokens.length || a.tokens.some((t, i) => t !== b.tokens[i])) return false;
  const ea = new TextDecoder().decode(encodeSettings(a));
  const eb = new TextDecoder().decode(encodeSettings(b));
  return ea === eb;
}
