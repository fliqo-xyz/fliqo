import { json, overBudget } from "@/lib/server/http";
import { tape } from "@/lib/server/market";

export const dynamic = "force-dynamic";

/* Site-wide tape: recent swaps of the busiest pools (GeckoTerminal trades, cached upstream). */
export async function GET(request: Request) {
  const refused = await overBudget(request, "market");
  if (refused) return refused;
  try {
    return json(await tape());
  } catch (e) {
    return json({ error: e instanceof Error ? e.message.slice(0, 200) : "Swaps are not available." }, 503);
  }
}
