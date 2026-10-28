import { json, overBudget } from "@/lib/server/http";
import { marketBoard } from "@/lib/server/market";

export const dynamic = "force-dynamic";

/* Market board: token rows (priced by each token's most liquid listed pool), new and trending pools, movers. */
export async function GET(request: Request) {
  const refused = await overBudget(request, "market");
  if (refused) return refused;
  try {
    return json(await marketBoard());
  } catch (e) {
    return json({ error: e instanceof Error ? e.message.slice(0, 200) : "Market data is not available." }, 503);
  }
}
