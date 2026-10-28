import { WETH } from "@/config/brand";
import { NATIVE } from "@/lib/market";
import { buildChecks } from "@/lib/tokencheck";
import { cleanAddress, json, overBudget } from "@/lib/server/http";
import { kindOf, tokenPools } from "@/lib/server/market";
import { memo } from "@/lib/server/memo";
import { readTokenFacts } from "@/lib/server/tokenfacts";

export const dynamic = "force-dynamic";

/*
 * One token: facts read from its contract (gas-capped calls, see tokenfacts.ts), the plain checks built from them,
 * and the pools that hold it (GeckoTerminal's index). The zero address stands for native ETH (priced by WETH pools).
 */
export async function GET(request: Request, ctx: { params: Promise<{ address: string }> }) {
  const address = cleanAddress((await ctx.params).address);
  if (!address) return json({ error: "Not a token address." }, 400);
  const refused = await overBudget(request, "token");
  if (refused) return refused;
  const native = address === NATIVE;
  try {
    // Facts are cached here for a minute; pool lists have their own cache in gecko.ts and are never cached empty.
    const [{ value: facts, at }, pools] = await Promise.all([
      memo(`facts:${address}`, 60_000, async () => (native ? null : readTokenFacts(address))),
      tokenPools(native ? WETH : address).catch(() => ({ pools: [], at: Date.now(), stale: true })),
    ]);
    return json({ address, kind: kindOf(address), native, facts, pools: pools.pools.slice(0, 12), poolsAt: pools.at, poolsStale: pools.stale, checks: buildChecks(facts, native), at });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message.slice(0, 200) : "The token could not be read." }, 503);
  }
}
