import { json, overBudget } from "@/lib/server/http";
import { overview } from "@/lib/server/market";

export const dynamic = "force-dynamic";

/* Liquidity overview: totals per venue and per paired asset over every pool the lists know right now. */
export async function GET(request: Request) {
  const refused = await overBudget(request, "market");
  if (refused) return refused;
  try {
    return json(await overview());
  } catch (e) {
    return json({ error: e instanceof Error ? e.message.slice(0, 200) : "Liquidity data is not available." }, 503);
  }
}
