import { json, overBudget } from "@/lib/server/http";
import { simplePrices } from "@/lib/server/market";

export const dynamic = "force-dynamic";

/* GET /api/prices?tokens=0x…,0x… (at most 30) — prices, 24h change, volume and liquidity from GeckoTerminal. */
export async function GET(request: Request) {
  const raw = (new URL(request.url).searchParams.get("tokens") ?? "").toLowerCase().split(",").filter(Boolean);
  if (!raw.length || raw.length > 30 || raw.some((a) => !/^0x[0-9a-f]{40}$/.test(a))) return json({ error: "tokens must be 1 to 30 comma-separated addresses." }, 400);
  const refused = await overBudget(request, "market");
  if (refused) return refused;
  try {
    return json(await simplePrices(raw));
  } catch (e) {
    return json({ error: e instanceof Error ? e.message.slice(0, 200) : "Prices are not available." }, 503);
  }
}
