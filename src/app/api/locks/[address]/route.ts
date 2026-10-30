import { NATIVE } from "@/lib/market";
import { USDG, WETH } from "@/config/brand";
import { cleanAddress, json, overBudget } from "@/lib/server/http";
import { sharedCache } from "@/lib/server/kvcache";
import { lockStatus } from "@/lib/server/locks";
import { tokenPools } from "@/lib/server/market";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HUBS = new Set([NATIVE, WETH.toLowerCase(), USDG.address.toLowerCase()]);

/*
 * GET /api/locks/<token>: HoodLock locks of the token's own supply and of its v2 LP tokens that still hold tokens
 * (see src/lib/server/locks.ts). Chain reads only; cached ten minutes per token and shared through the store.
 */
export async function GET(request: Request, ctx: { params: Promise<{ address: string }> }) {
  const address = cleanAddress((await ctx.params).address);
  if (!address) return json({ error: "Not a token address." }, 400);
  if (HUBS.has(address)) return json({ error: "Lock status is shown for the tokens traded against ETH, WETH and USDG." }, 400);
  const refused = await overBudget(request, "token");
  if (refused) return refused;
  try {
    const { value } = await sharedCache(`locks:v1:${address}`, 600, async () => {
      const { pools, stale } = await tokenPools(address);
      if (!pools.length && stale) throw new Error("The pool index is busy right now; lock status is read on the next try.");
      const ref = pools.flatMap((p) => [p.base, p.quote]).find((t) => t.address === address);
      return lockStatus(address, pools, ref?.symbol ?? address.slice(0, 8));
    });
    return json(value);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message.slice(0, 200) : "Lock status is not available." }, 503);
  }
}
