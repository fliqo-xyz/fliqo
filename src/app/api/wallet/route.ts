import { cleanAddress, json, overBudget } from "@/lib/server/http";
import { memo } from "@/lib/server/memo";
import { readWallet } from "@/lib/server/wallet";

export const dynamic = "force-dynamic";

/* GET /api/wallet?owner=0x… — balances, nonces and Uniswap approvals of any address, read from chain. */
export async function GET(request: Request) {
  const owner = cleanAddress(new URL(request.url).searchParams.get("owner"));
  if (!owner || /^0x0{40}$/.test(owner)) return json({ error: "owner must be an address." }, 400);
  const refused = await overBudget(request, "wallet");
  if (refused) return refused;
  try {
    const { value, at } = await memo(`wallet:${owner}`, 15_000, () => readWallet(owner));
    return json({ ...value, at });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message.slice(0, 200) : "The wallet could not be read." }, 503);
  }
}
