import { USDG, WETH } from "@/config/brand";
import { NATIVE, type PoolRow } from "@/lib/market";
import { memo } from "@/lib/server/memo";
import { depthCurve, ponsCurveBuy, quoteAll, quoteTokens } from "@/lib/server/quote";
import { tokenPools, universe } from "@/lib/server/market";
import { cleanAddress, json, overBudget } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const MAX_IN = 10n ** 40n;
const WETH_LOW = WETH.toLowerCase();
const HUBS = new Set([WETH_LOW, USDG.address.toLowerCase()]);

/*
 * Read-only swap route preview: GET /api/quote?in=<token>&out=<token>&amount=<raw units>. The zero address stands
 * for ETH and is quoted through WETH. Quotes come from the Uniswap quoter contracts (v2 router, v3 QuoterV2, v4
 * Quoter) and, for a buy with ETH of a token still on its Pons bonding curve, from a simulated call of the curve's
 * own buy function. Every call is a gas-capped eth_call at one block; nothing is signed or sent, and Fliqo never
 * routes or holds funds.
 */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const rawIn = cleanAddress(q.get("in"));
  const rawOut = cleanAddress(q.get("out"));
  const amountText = q.get("amount") ?? "";
  if (!rawIn || !rawOut) return json({ error: "in and out must be token addresses (0x000… for ETH)." }, 400);
  const tin = rawIn === NATIVE ? WETH_LOW : rawIn;
  const tout = rawOut === NATIVE ? WETH_LOW : rawOut;
  if (tin === tout) return json({ error: "Pick two different tokens (ETH and WETH quote the same)." }, 400);
  if (!/^\d{1,40}$/.test(amountText) || BigInt(amountText) === 0n || BigInt(amountText) > MAX_IN) return json({ error: "amount must be a positive whole number of raw units." }, 400);
  const refused = await overBudget(request, "quote");
  if (refused) return refused;
  const amount = BigInt(amountText);
  try {
    const key = `${tin}:${tout}:${amount}`;
    const { value, at } = await memo(key, 10_000, async () => {
      // Pools that hold either side: the busiest lists plus GeckoTerminal's own index for each non-hub token.
      const own = await Promise.all(
        [tin, tout].filter((t) => !HUBS.has(t)).map((t) => tokenPools(t).then((r) => r.pools).catch(() => [] as PoolRow[])),
      );
      const pools = [...(await universe().catch(() => [] as PoolRow[])), ...own.flat()];
      // Native ETH appears as the zero address (v4) or as 0xeeee…eeee (curves); both quote like WETH.
      const norm = (a: string) => (a === NATIVE || a === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" ? WETH_LOW : a);
      const pair = new Set([tin, tout]);
      const v4 = [...new Set(pools.filter((p) => p.kind === 4 && pair.has(norm(p.base.address)) && pair.has(norm(p.quote.address))).map((p) => p.address))];
      const pairOf = (p: PoolRow) => new Set([norm(p.base.address), norm(p.quote.address)]);
      const idsFor = (x: string, y: string) => [...new Set(pools.filter((p) => p.kind === 4 && pairOf(p).has(x) && pairOf(p).has(y)).map((p) => p.address))];
      const [tokens, quote] = await Promise.all([quoteTokens(tin, tout), quoteAll(tin, tout, amount, v4)]);
      // Two hops through a hub (USDG or WETH) when the token trades against the hub: quote the first hop, then the
      // second hop with the exact output of the first. Both are eth_calls at the chain head; nothing is sent.
      for (const hub of [...HUBS].filter((h) => h !== tin && h !== tout)) {
        const first = idsFor(tin, hub);
        const second = idsFor(hub, tout);
        if (!first.length && !second.length) continue;
        const a = await quoteAll(tin, hub, amount, first).catch(() => null);
        const r1 = a?.routes[0];
        if (!r1) continue;
        const b = await quoteAll(hub, tout, BigInt(r1.amountOut), second).catch(() => null);
        const r2 = b?.routes[0];
        if (!r2) continue;
        const mid = r1.midOut && r2.midOut && BigInt(r1.amountOut) > 0n ? ((BigInt(r1.midOut) * BigInt(r2.midOut)) / BigInt(r1.amountOut)).toString() : null;
        quote.routes.push({ label: `${r1.label} → ${r2.label} (via ${hub === WETH_LOW ? "WETH" : "USDG"})`, amountOut: r2.amountOut, midOut: mid, legs: [...r1.legs, ...r2.legs] });
      }
      quote.routes.sort((x, y) => (BigInt(y.amountOut) > BigInt(x.amountOut) ? 1 : BigInt(y.amountOut) < BigInt(x.amountOut) ? -1 : 0));
      const best = quote.routes[0];
      const curve = best ? await depthCurve(best, amount, [0.25, 0.5, 1, 2, 4]).catch(() => []) : [];
      // A buy with ETH of a token whose Pons curve is listed: simulate the curve's own buy.
      let pons = null;
      if (tin === WETH_LOW) {
        const c = pools.find((p) => p.venue === "pons-v2" && /^0x[0-9a-f]{40}$/.test(p.address) && norm(p.base.address) === tout && norm(p.quote.address) === WETH_LOW);
        if (c) pons = await ponsCurveBuy(c.address, tout, amount).catch(() => null);
      }
      const sellOnCurve = tout === WETH_LOW && pools.some((p) => p.venue === "pons-v2" && norm(p.base.address) === tin);
      return { ...quote, tokens, curve, pons, sellOnCurve };
    });
    return json({ ...value, nativeIn: rawIn === NATIVE, nativeOut: rawOut === NATIVE, at });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message.slice(0, 200) : "Quotes are not available." }, 503);
  }
}
