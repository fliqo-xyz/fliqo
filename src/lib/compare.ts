import type { Candle } from "@/lib/market";

/*
 * "Flip the View": two markets side by side. Pure helpers for the compare page: both price series rebased to
 * percent change from a shared start, and a metric table that says which side is larger. No metric is a signal.
 */

export type Point = { t: number; a: number | null; b: number | null };

/** Closes of `a` and `b` on their shared timestamps, each as % change from its first shared close. */
export function rebase(a: Candle[], b: Candle[]): Point[] {
  const mb = new Map(b.map((c) => [c[0], c[4]]));
  const shared = a.filter((c) => mb.has(c[0]) && c[4] > 0 && (mb.get(c[0]) ?? 0) > 0).map((c) => [c[0], c[4], mb.get(c[0])!] as const);
  if (shared.length >= 2) {
    const [, a0, b0] = shared[0];
    return shared.map(([t, x, y]) => ({ t, a: ((x - a0) / a0) * 100, b: ((y - b0) / b0) * 100 }));
  }
  // No shared timestamps (one pool trades rarely): rebase each on its own and merge by time.
  const own = (s: Candle[]) => {
    const first = s.find((c) => c[4] > 0)?.[4];
    return first ? s.map((c) => [c[0], ((c[4] - first) / first) * 100] as const) : [];
  };
  const pa = own(a);
  const pb = own(b);
  const times = [...new Set([...pa.map((p) => p[0]), ...pb.map((p) => p[0])])].sort((x, y) => x - y);
  const ma = new Map(pa);
  const mbb = new Map(pb);
  return times.map((t) => ({ t, a: ma.get(t) ?? null, b: mbb.get(t) ?? null }));
}

export type Side = { priceUsd: number | null; change1h?: number | null; change24h: number | null; marketCapUsd: number | null; fdvUsd: number | null; liquidityUsd: number | null; volume24h: number | null; txns24h?: number | null; buys24h?: number | null; sells24h?: number | null };

export type Row = { key: string; label: string; a: number | null; b: number | null; kind: "usd" | "pct" | "num" | "ratio"; larger: "a" | "b" | null };

const ratio = (v: number | null, l: number | null) => (v !== null && l !== null && l > 0 ? v / l : null);

/** The metric table. `larger` marks the larger side (never "better"); null when either side is unknown or equal. */
export function metricRows(a: Side, b: Side): Row[] {
  const rows: Omit<Row, "larger">[] = [
    { key: "price", label: "Price (USD)", a: a.priceUsd, b: b.priceUsd, kind: "usd" },
    { key: "ch1h", label: "1h change", a: a.change1h ?? null, b: b.change1h ?? null, kind: "pct" },
    { key: "ch24", label: "24h change", a: a.change24h, b: b.change24h, kind: "pct" },
    { key: "mc", label: "Market cap", a: a.marketCapUsd, b: b.marketCapUsd, kind: "usd" },
    { key: "fdv", label: "Fully diluted value", a: a.fdvUsd, b: b.fdvUsd, kind: "usd" },
    { key: "liq", label: "Liquidity", a: a.liquidityUsd, b: b.liquidityUsd, kind: "usd" },
    { key: "vol", label: "Volume 24h", a: a.volume24h, b: b.volume24h, kind: "usd" },
    { key: "turn", label: "Volume / liquidity", a: ratio(a.volume24h, a.liquidityUsd), b: ratio(b.volume24h, b.liquidityUsd), kind: "ratio" },
    { key: "tx", label: "Swaps 24h", a: a.txns24h ?? null, b: b.txns24h ?? null, kind: "num" },
    { key: "bs", label: "Buys / sells 24h", a: ratio(a.buys24h ?? null, a.sells24h ?? null), b: ratio(b.buys24h ?? null, b.sells24h ?? null), kind: "ratio" },
  ];
  return rows.map((r) => ({ ...r, larger: r.a === null || r.b === null || r.a === r.b ? null : r.a > r.b ? "a" : "b" }));
}
