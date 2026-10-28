/* Number formatting shared by every page. Missing numbers read "—", never 0. */

export const DASH = "—";

/** 18_941_033 -> "$18.9M"; 76_800 -> "$76.8K"; 174.74 -> "$174.74". */
export function usdShort(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(abs >= 1e8 ? 0 : 1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(abs >= 1e5 ? 0 : 1)}K`;
  if (abs >= 1) return `${sign}$${abs.toFixed(2)}`;
  if (abs === 0) return "$0";
  return `${sign}$${abs.toPrecision(3)}`;
}

/** Full dollars with cents: 1144284.39 -> "$1,144,284.39". */
export function usdFull(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** Token prices span many orders of magnitude: keep 4 significant digits below $1. */
export function price(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  if (n >= 1000) return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (n >= 1) return `$${n.toFixed(n >= 100 ? 2 : 4)}`;
  if (n === 0) return "$0";
  const digits = Math.min(12, Math.max(2, -Math.floor(Math.log10(n)) + 3));
  return `$${n.toFixed(digits)}`;
}

export function int(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  return Math.round(n).toLocaleString("en-US");
}

/** Signed percent with two decimals: 1.234 -> "+1.23%". */
export function pct(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

export const share = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);

/** Plain amount of tokens with sensible precision. */
export function amount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e4) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (abs >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  if (abs === 0) return "0";
  return n.toPrecision(4);
}

export function ago(ms: number | null | undefined, now = Date.now()): string {
  if (ms == null) return DASH;
  const d = Math.max(0, Math.floor((now - ms) / 1000));
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

/** Age of a pool: "9h", "3d", "4mo". */
export function age(ms: number | null | undefined, now = Date.now()): string {
  if (ms == null) return DASH;
  const h = Math.max(0, (now - ms) / 3_600_000);
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`;
  if (h < 48) return `${Math.round(h)}h`;
  const d = h / 24;
  if (d < 60) return `${Math.round(d)}d`;
  return `${Math.round(d / 30)}mo`;
}

/** "11d 20h 16m" style clock from seconds. */
export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m ${String(r).padStart(2, "0")}s` : `${m}m ${String(r).padStart(2, "0")}s`;
}
