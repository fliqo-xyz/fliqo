/*
 * Shapes and arithmetic for swap route previews, shared by the quote API and the pages. A quote is what a
 * DEX quoter returns for an exact input; "mid" is the same input priced at each pool's current price with no
 * fee and no slippage. The gap between the two is what the trade would cost beyond the current price.
 */

export type RouteLeg = { pool: string; kind: 2 | 3 | 4; fee: number | null; tokenIn: string; tokenOut: string };

export type RouteQuote = {
  label: string;
  /** Raw output units, decimal text. */
  amountOut: string;
  /** Raw output at the pools' current prices, decimal text; null when a price could not be read. */
  midOut: string | null;
  legs: RouteLeg[];
};

/** amountIn priced through each leg's current price (num/den = output per input, raw units). */
export function midOut(amountIn: bigint, mids: { num: bigint; den: bigint }[]): bigint {
  let num = amountIn;
  let den = 1n;
  for (const m of mids) {
    num *= m.num;
    den *= m.den;
  }
  return den === 0n ? 0n : num / den;
}

/** Cost beyond the current price, in percent (impact plus fees). Null without a mid. */
export function costPct(r: Pick<RouteQuote, "amountOut" | "midOut">): number | null {
  if (!r.midOut) return null;
  const mid = BigInt(r.midOut);
  if (mid === 0n) return null;
  const out = BigInt(r.amountOut);
  // Basis points with two extra digits, then percent.
  const bps = Number(((mid - out) * 1_000_000n) / mid) / 10_000;
  return Math.max(-100, Math.min(100, bps));
}

/** Minimum received at a slippage tolerance in basis points. */
export function minReceived(amountOut: bigint, slippageBps: number): bigint {
  const bps = BigInt(Math.max(0, Math.min(5000, Math.round(slippageBps))));
  return (amountOut * (10_000n - bps)) / 10_000n;
}

/** How much more the best route gives than another, in percent of the other. */
export function edgePct(best: bigint, other: bigint): number | null {
  if (other === 0n) return null;
  return Number(((best - other) * 1_000_000n) / other) / 10_000;
}
