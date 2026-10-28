import { isPoolAddress } from "@/lib/market";
import { json, overBudget } from "@/lib/server/http";
import { sparks } from "@/lib/server/market";

export const dynamic = "force-dynamic";

/* GET /api/spark?pools=0x…,0x… (up to 8 pool addresses or v4 ids): 24 hourly closes per pool, null when not available. */
export async function GET(request: Request) {
  const raw = (new URL(request.url).searchParams.get("pools") ?? "").split(",").slice(0, 8);
  const pools = [...new Set(raw.map((p) => p.trim().toLowerCase()).filter(isPoolAddress))];
  if (!pools.length) return json({ error: "pools must list 1 to 8 pool addresses." }, 400);
  const refused = await overBudget(request, "market");
  if (refused) return refused;
  return json({ sparks: await sparks(pools) });
}
