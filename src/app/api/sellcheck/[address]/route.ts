import { NATIVE } from "@/lib/market";
import { USDG, WETH } from "@/config/brand";
import { cleanAddress, json, overBudget } from "@/lib/server/http";
import { sharedCache } from "@/lib/server/kvcache";
import { tokenPools } from "@/lib/server/market";
import { sellCheck } from "@/lib/server/sellcheck";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HUBS = new Set([NATIVE, WETH.toLowerCase(), USDG.address.toLowerCase()]);

/*
 * GET /api/sellcheck/<token>: simulated buy and sell of a small amount on the token's most liquid supported pool
 * (see src/lib/server/sellcheck.ts). Server only, one gas-capped eth_call with state overrides; cached five minutes
 * per token and shared through the store. Nothing is signed or sent.
 */
export async function GET(request: Request, ctx: { params: Promise<{ address: string }> }) {
  const address = cleanAddress((await ctx.params).address);
  if (!address) return json({ error: "Not a token address." }, 400);
  if (HUBS.has(address)) return json({ error: "ETH, WETH and USDG are the base assets pools trade against; the sell check is for the tokens traded against them." }, 400);
  const refused = await overBudget(request, "token");
  if (refused) return refused;
  try {
    const { value } = await sharedCache(`sell:v1:${address}`, 300, async () => {
      const { pools, stale } = await tokenPools(address);
      if (!pools.length && stale) throw new Error("The pool index is busy right now; the sell check runs on the next read.");
      const ref = pools.flatMap((p) => [p.base, p.quote]).find((t) => t.address === address);
      return sellCheck(address, pools, ref?.symbol ?? address.slice(0, 8));
    });
    return json(value);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message.slice(0, 200) : "The sell check is not available." }, 503);
  }
}
