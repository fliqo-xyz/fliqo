import { cleanAddress, json, overBudget } from "@/lib/server/http";
import { latestBlock } from "@/lib/server/chainread";
import { memo } from "@/lib/server/memo";
import { scanTransfers } from "@/lib/server/transfers";

export const dynamic = "force-dynamic";

/* GET /api/transfers?owner=0x… — the wallet's recent ERC-20 transfers, read from chain logs (see transfers.ts). */
export async function GET(request: Request) {
  const owner = cleanAddress(new URL(request.url).searchParams.get("owner"));
  if (!owner || /^0x0{40}$/.test(owner)) return json({ error: "owner must be an address." }, 400);
  const refused = await overBudget(request, "wallet");
  if (refused) return refused;
  try {
    const { value, at } = await memo(`transfers:${owner}`, 30_000, async () => scanTransfers(owner, await latestBlock()));
    return json({ ...value, at });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message.slice(0, 160) : "Transfers could not be read." }, 503);
  }
}
