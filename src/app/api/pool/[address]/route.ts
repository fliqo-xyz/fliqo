import { isPoolAddress } from "@/lib/market";
import { TIMEFRAMES, poolDetail, type Timeframe } from "@/lib/server/market";
import { json, overBudget } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/* One pool's market data: stats, recent swaps and candles for a timeframe (1m, 5m, 15m, 1h, 4h, 1d, 1w). */
export async function GET(request: Request, ctx: { params: Promise<{ address: string }> }) {
  const { address } = await ctx.params;
  if (!isPoolAddress(address)) return json({ error: "Not a pool address or v4 pool id." }, 400);
  const tf = (new URL(request.url).searchParams.get("tf") ?? "1h") as Timeframe;
  if (!Object.hasOwn(TIMEFRAMES, tf)) return json({ error: "Unknown timeframe." }, 400);
  const refused = await overBudget(request, "market");
  if (refused) return refused;
  try {
    // ?side=quote charts the pool's quote token instead of its base token.
    return json(await poolDetail(address.toLowerCase(), tf, new URL(request.url).searchParams.get("side") === "quote"));
  } catch (e) {
    return json({ error: e instanceof Error ? e.message.slice(0, 200) : "Pool data is not available." }, 503);
  }
}
