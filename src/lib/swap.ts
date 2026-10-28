import type { RouteQuote } from "@/lib/routes";

/* Amount parsing and fee arithmetic for the swap route preview (pure, unit-tested). */

/** "1.5" with `decimals` -> raw units; null for anything that is not a plain positive decimal. */
export function parseUnits(text: string, decimals: number): bigint | null {
  const t = text.trim();
  if (!/^\d{0,30}(\.\d{0,36})?$/.test(t) || t === "" || t === ".") return null;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;
  const [whole, frac = ""] = t.split(".");
  const f = frac.slice(0, decimals).padEnd(decimals, "0");
  const v = BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(f || "0");
  return v;
}

/** Raw units -> a JS number for display only (never for arithmetic on amounts). */
export function toNumber(raw: string, decimals: number | null): number | null {
  if (decimals === null || !/^\d+$/.test(raw)) return null;
  const s = raw.padStart(decimals + 1, "0");
  return Number(`${s.slice(0, s.length - decimals)}.${s.slice(s.length - decimals) || "0"}`);
}

/**
 * Total pool fee of a route in percent: Uniswap fee units are hundredths of a basis point (3000 = 0.3%), summed
 * over the legs. A v4 dynamic-fee pool (flag 0x800000) has no fixed fee: null.
 */
export function feePct(r: Pick<RouteQuote, "legs">): number | null {
  if (!r.legs.length) return null;
  let total = 0;
  for (const l of r.legs) {
    if (l.fee === null || (l.fee & 0x800000) !== 0) return null;
    total += l.fee / 10_000;
  }
  return total;
}
