import "server-only";
import { encodeFunctionData, decodeFunctionResult, encodePacked, type Abi } from "viem";
import { USDG, WETH } from "@/config/brand";
import { UNISWAP, V3_FEES } from "@/config/dex";
import { V2_FACTORY_ABI, V2_PAIR_ABI, V2_ROUTER_ABI, V3_FACTORY_ABI, V3_QUOTER_ABI, V4_POSITIONS_ABI, V4_QUOTER_ABI, V4_STATE_VIEW_ABI } from "@/lib/abi";
import { QUOTE_GAS, hexBlock, latestBlock, rawAll, readAll } from "@/lib/server/chainread";
import { uint, words } from "@/lib/feeds/rpc";
import { midOut } from "@/lib/routes";
import type { RouteQuote } from "@/lib/routes";

/*
 * Read-only swap quotes from the Uniswap deployments on Robinhood Chain, all at one block:
 *   v2   router getAmountsOut on the direct pair
 *   v3   QuoterV2 for each fee tier with a pool, and two-hop paths through WETH or USDG
 *   v4   the v4 Quoter for pools the caller names (ids found in the market lists)
 * Quoters simulate the swap with eth_call; nothing is sent and nothing is signed. The "mid" output prices the
 * same amount at each pool's current price, so the gap to the quote is the price impact plus the pool fees.
 */

const NATIVE = "0x0000000000000000000000000000000000000000";
const SLOT0 = "0x3850c7bd";
const low = (a: string) => a.toLowerCase();

type Leg = { pool: string; kind: 2 | 3 | 4; fee: number | null; tokenIn: string; tokenOut: string; zeroForOne?: boolean };

function enc(abi: Abi, fn: string, args: readonly unknown[]) {
  return encodeFunctionData({ abi, functionName: fn, args } as never);
}
function dec<T>(abi: Abi, fn: string, raw: string | null): T | null {
  if (!raw) return null;
  try {
    return decodeFunctionResult({ abi, functionName: fn, data: raw as `0x${string}` } as never) as T;
  } catch {
    return null;
  }
}

/** Current price of a leg as an output-per-input ratio numerator/denominator (raw units), or null. */
type Mid = { num: bigint; den: bigint } | null;

function midFromSqrt(sqrtP: bigint, zeroForOne: boolean): Mid {
  if (sqrtP === 0n) return null;
  const p2 = sqrtP * sqrtP;
  const q192 = 2n ** 192n;
  return zeroForOne ? { num: p2, den: q192 } : { num: q192, den: p2 };
}

export type QuoteResult = { block: number; amountIn: string; routes: RouteQuote[] };

/**
 * Quotes `amountIn` raw units of `tokenIn` for `tokenOut`. `v4Pools` are pool ids to try through the v4 quoter.
 * Every route is returned, best first; routes that revert (no pool, no liquidity) are left out.
 */
export async function quoteAll(tokenIn: string, tokenOut: string, amountIn: bigint, v4Pools: string[] = []): Promise<QuoteResult> {
  const tin = low(tokenIn);
  const tout = low(tokenOut);
  const block = await latestBlock();
  const tag = hexBlock(block);

  // Phase 1: which pools exist (v2 pair, v3 per fee, hub legs) and the v4 keys.
  const hubs = [low(WETH), low(USDG.address)].filter((h) => h !== tin && h !== tout);
  type Probe = { what: "v2" | "v3" | "hubIn" | "hubOut" | "v4key"; fee?: number; hub?: string; id?: string; data: string; to: string };
  const probes: Probe[] = [{ what: "v2", to: UNISWAP.v2Factory, data: enc(V2_FACTORY_ABI as Abi, "getPair", [tin, tout]) }];
  for (const fee of V3_FEES) probes.push({ what: "v3", fee, to: UNISWAP.v3Factory, data: enc(V3_FACTORY_ABI as Abi, "getPool", [tin, tout, fee]) });
  for (const hub of hubs)
    for (const fee of V3_FEES) {
      probes.push({ what: "hubIn", fee, hub, to: UNISWAP.v3Factory, data: enc(V3_FACTORY_ABI as Abi, "getPool", [tin, hub, fee]) });
      probes.push({ what: "hubOut", fee, hub, to: UNISWAP.v3Factory, data: enc(V3_FACTORY_ABI as Abi, "getPool", [hub, tout, fee]) });
    }
  const ids = [...new Set(v4Pools.map(low).filter((x) => /^0x[0-9a-f]{64}$/.test(x)))].slice(0, 6);
  for (const id of ids) probes.push({ what: "v4key", id, to: UNISWAP.v4Positions, data: enc(V4_POSITIONS_ABI as Abi, "poolKeys", [id.slice(0, 52)]) });
  const probeRaw = await rawAll(probes.map((p) => ({ to: p.to, data: p.data })), tag);
  const addr = (raw: string | null) => {
    if (!raw) return null;
    const w = words(raw)[0];
    if (!w) return null;
    const a = `0x${w.slice(24)}`;
    return /^0x0{40}$/.test(a) ? null : a;
  };

  type Candidate = { label: string; legs: Leg[]; data: { to: string; data: string; gas?: number }; decode: (raw: string | null) => bigint | null };
  const cands: Candidate[] = [];
  const v2Pair = addr(probeRaw[0]);
  if (v2Pair)
    cands.push({
      label: "Uniswap v2",
      legs: [{ pool: v2Pair, kind: 2, fee: 3000, tokenIn: tin, tokenOut: tout }],
      data: { to: UNISWAP.v2Router, data: enc(V2_ROUTER_ABI as Abi, "getAmountsOut", [amountIn, [tin, tout]]) },
      decode: (raw) => {
        const r = dec<readonly bigint[]>(V2_ROUTER_ABI as Abi, "getAmountsOut", raw);
        return r && r.length === 2 ? r[1] : null;
      },
    });
  const hubPools = new Map<string, string>();
  probes.forEach((p, i) => {
    const a = addr(probeRaw[i]);
    if (!a) return;
    if (p.what === "v3")
      cands.push({
        label: `Uniswap v3 · ${(p.fee! / 10_000).toString()}%`,
        legs: [{ pool: a, kind: 3, fee: p.fee!, tokenIn: tin, tokenOut: tout }],
        data: { to: UNISWAP.v3QuoterV2, data: enc(V3_QUOTER_ABI as Abi, "quoteExactInputSingle", [{ tokenIn: tin, tokenOut: tout, amountIn, fee: p.fee!, sqrtPriceLimitX96: 0n }]) },
        decode: (raw) => dec<readonly [bigint, bigint, number, bigint]>(V3_QUOTER_ABI as Abi, "quoteExactInputSingle", raw)?.[0] ?? null,
      });
    if (p.what === "hubIn" || p.what === "hubOut") hubPools.set(`${p.what}:${p.hub}:${p.fee}`, a);
  });
  for (const hub of hubs) {
    const ins = V3_FEES.filter((f) => hubPools.has(`hubIn:${hub}:${f}`));
    const outs = V3_FEES.filter((f) => hubPools.has(`hubOut:${hub}:${f}`));
    const combos = ins.flatMap((a) => outs.map((b) => [a, b] as const)).slice(0, 4);
    const hubName = hub === low(WETH) ? "WETH" : "USDG";
    for (const [fa, fb] of combos) {
      const path = encodePacked(["address", "uint24", "address", "uint24", "address"], [tin as `0x${string}`, fa, hub as `0x${string}`, fb, tout as `0x${string}`]);
      cands.push({
        label: `Uniswap v3 · via ${hubName} (${fa / 10_000}% + ${fb / 10_000}%)`,
        legs: [
          { pool: hubPools.get(`hubIn:${hub}:${fa}`)!, kind: 3, fee: fa, tokenIn: tin, tokenOut: hub },
          { pool: hubPools.get(`hubOut:${hub}:${fb}`)!, kind: 3, fee: fb, tokenIn: hub, tokenOut: tout },
        ],
        data: { to: UNISWAP.v3QuoterV2, data: enc(V3_QUOTER_ABI as Abi, "quoteExactInput", [path, amountIn]) },
        decode: (raw) => dec<readonly [bigint, readonly bigint[], readonly number[], bigint]>(V3_QUOTER_ABI as Abi, "quoteExactInput", raw)?.[0] ?? null,
      });
    }
  }
  probes.forEach((p, i) => {
    if (p.what !== "v4key" || !probeRaw[i]) return;
    const k = dec<readonly [string, string, number, number, string]>(V4_POSITIONS_ABI as Abi, "poolKeys", probeRaw[i]);
    if (!k || /^0x0{40}$/i.test(k[1])) return;
    const c0 = low(k[0]);
    const c1 = low(k[1]);
    // Native ETH pools quote the same economics as WETH ones; map WETH onto the native side.
    const norm = (t: string) => (t === low(WETH) && (c0 === NATIVE || c1 === NATIVE) ? NATIVE : t);
    const a = norm(tin);
    const b = norm(tout);
    if (!((a === c0 && b === c1) || (a === c1 && b === c0))) return;
    if (amountIn >= 2n ** 128n) return;
    const zeroForOne = a === c0;
    cands.push({
      label: `Uniswap v4 · ${Number(k[2]) & 0x800000 ? "dynamic fee" : `${Number(k[2]) / 10_000}%`}${/^0x0{40}$/i.test(k[4]) ? "" : " · hooked"}`,
      legs: [{ pool: p.id!, kind: 4, fee: Number(k[2]), tokenIn: tin, tokenOut: tout, zeroForOne }],
      data: {
        to: UNISWAP.v4Quoter,
        data: enc(V4_QUOTER_ABI as Abi, "quoteExactInputSingle", [
          { poolKey: { currency0: k[0], currency1: k[1], fee: k[2], tickSpacing: k[3], hooks: k[4] }, zeroForOne, exactAmount: amountIn, hookData: "0x" },
        ]),
      },
      decode: (raw) => dec<readonly [bigint, bigint]>(V4_QUOTER_ABI as Abi, "quoteExactInputSingle", raw)?.[0] ?? null,
    });
  });

  // Phase 2: quotes plus each leg's current price.
  const legs = [...new Map(cands.flatMap((c) => c.legs).map((l) => [`${l.pool}:${l.tokenIn}`, l])).values()];
  const legReads = legs.map((l) =>
    l.kind === 2
      ? { to: l.pool, data: enc(V2_PAIR_ABI as Abi, "getReserves", []) }
      : l.kind === 3
        ? { to: l.pool, data: SLOT0 }
        : { to: UNISWAP.v4StateView, data: enc(V4_STATE_VIEW_ABI as Abi, "getSlot0", [l.pool]) },
  );
  const v2Tokens = legs.filter((l) => l.kind === 2).map((l) => ({ to: l.pool, data: enc(V2_PAIR_ABI as Abi, "token0", []) }));
  // Quoter simulations run the swap through the token contracts, so they get the larger (still bounded) gas cap.
  const raw = await rawAll([...cands.map((c) => ({ ...c.data, gas: QUOTE_GAS })), ...legReads, ...v2Tokens], tag);
  const quoteRaw = raw.slice(0, cands.length);
  const legRaw = raw.slice(cands.length, cands.length + legs.length);
  const v2T0 = raw.slice(cands.length + legs.length);
  const mids = new Map<string, Mid>();
  let v2i = 0;
  legs.forEach((l, i) => {
    const r = legRaw[i];
    let mid: Mid = null;
    if (r && l.kind === 2) {
      const w = words(r);
      const t0 = v2T0[v2i++];
      const token0 = t0 ? `0x${words(t0)[0]?.slice(24)}` : null;
      if (w.length >= 2 && token0) {
        const r0 = uint(w[0]);
        const r1 = uint(w[1]);
        const zf = low(token0) === l.tokenIn;
        mid = zf ? { num: r1, den: r0 } : { num: r0, den: r1 };
        if (mid.den === 0n) mid = null;
      }
    } else if (r) {
      const w = words(r);
      if (w.length >= 1) {
        const sqrtP = uint(w[0]);
        const zf = l.kind === 4 ? Boolean(l.zeroForOne) : BigInt(l.tokenIn) < BigInt(l.tokenOut);
        mid = midFromSqrt(sqrtP, zf);
      }
    }
    mids.set(`${l.pool}:${l.tokenIn}`, mid);
  });

  const routes: RouteQuote[] = [];
  cands.forEach((c, i) => {
    const out = c.decode(quoteRaw[i]);
    if (out === null || out === 0n) return;
    const legMids = c.legs.map((l) => mids.get(`${l.pool}:${l.tokenIn}`) ?? null);
    routes.push({
      label: c.label,
      amountOut: out.toString(),
      midOut: legMids.every(Boolean) ? midOut(amountIn, legMids as { num: bigint; den: bigint }[]).toString() : null,
      legs: c.legs.map((l) => ({ pool: l.pool, kind: l.kind, fee: l.fee, tokenIn: l.tokenIn, tokenOut: l.tokenOut })),
    });
  });
  routes.sort((a, b) => (BigInt(b.amountOut) > BigInt(a.amountOut) ? 1 : BigInt(b.amountOut) < BigInt(a.amountOut) ? -1 : 0));
  return { block, amountIn: amountIn.toString(), routes };
}

/** Quotes of the best single route at several sizes, for the depth curve. */
export async function depthCurve(route: RouteQuote, amountIn: bigint, multipliers: number[]): Promise<{ m: number; amountIn: string; amountOut: string | null }[]> {
  const leg = route.legs[0];
  if (route.legs.length !== 1 || leg.kind !== 3 || leg.fee === null) return [];
  const sizes = multipliers.map((m) => ({ m, a: (amountIn * BigInt(Math.round(m * 1000))) / 1000n })).filter((x) => x.a > 0n);
  const raw = await rawAll(
    sizes.map((s) => ({ to: UNISWAP.v3QuoterV2, gas: QUOTE_GAS, data: enc(V3_QUOTER_ABI as Abi, "quoteExactInputSingle", [{ tokenIn: leg.tokenIn, tokenOut: leg.tokenOut, amountIn: s.a, fee: leg.fee!, sqrtPriceLimitX96: 0n }]) })),
  );
  return sizes.map((s, i) => ({ m: s.m, amountIn: s.a.toString(), amountOut: dec<readonly [bigint]>(V3_QUOTER_ABI as Abi, "quoteExactInputSingle", raw[i])?.[0]?.toString() ?? null }));
}

/** Decimals and symbols of the two tokens of a quote (ETH for the zero address). */
export async function quoteTokens(a: string, b: string) {
  const { ERC20_ABI } = await import("@/lib/abi");
  const r = await readAll([
    { to: a, abi: ERC20_ABI as Abi, fn: "decimals" },
    { to: a, abi: ERC20_ABI as Abi, fn: "symbol" },
    { to: b, abi: ERC20_ABI as Abi, fn: "decimals" },
    { to: b, abi: ERC20_ABI as Abi, fn: "symbol" },
  ]);
  return {
    in: { address: low(a), decimals: r[0] === null ? null : Number(r[0]), symbol: typeof r[1] === "string" ? r[1].slice(0, 24) : null },
    out: { address: low(b), decimals: r[2] === null ? null : Number(r[2]), symbol: typeof r[3] === "string" ? r[3].slice(0, 24) : null },
  };
}

/*
 * Pons bonding curves (venue "pons-v2" on GeckoTerminal; the pool address is the curve contract). A buy is
 * simulated with eth_call of the curve's own buy(quoteIn, 0, recipient) from a throwaway address whose ETH balance
 * is set for that one call (a state override; nothing is sent, nothing is signed). The curve takes its fee inside
 * buy(), so the answer is what a buyer would receive at this block. Sells pull tokens with an allowance, which a
 * plain call cannot grant, so they are not simulated here.
 */
const SIM_FROM = "0x00000000000000000000000000000000000f1140";
const CURVE_ABI = [
  { type: "function", name: "buy", stateMutability: "payable", inputs: [{ name: "quoteIn", type: "uint256" }, { name: "minTokensOut", type: "uint256" }, { name: "recipient", type: "address" }], outputs: [{ name: "tokensOut", type: "uint256" }] },
  { type: "function", name: "graduated", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "token", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "pairToken", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "feeBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getReserves", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }, { type: "uint256" }] },
] as const satisfies Abi;

export type CurveQuote = { curve: string; graduated: boolean; feeBps: number | null; amountOut: string | null; midOut: string | null; block: number };

/**
 * Quotes a buy of `token` for `amountIn` wei of ETH on its Pons curve. Returns null when the address is not an
 * ETH-paired curve for that token. `amountOut` is null when the simulation reverted (graduated, sold out, too small).
 */
export async function ponsCurveBuy(curve: string, token: string, amountIn: bigint): Promise<CurveQuote | null> {
  const { rpc } = await import("@/lib/feeds/rpc");
  const block = await latestBlock();
  const tag = hexBlock(block);
  const head = await rawAll(
    [
      { to: curve, data: enc(CURVE_ABI as Abi, "token", []) },
      { to: curve, data: enc(CURVE_ABI as Abi, "pairToken", []) },
      { to: curve, data: enc(CURVE_ABI as Abi, "graduated", []) },
      { to: curve, data: enc(CURVE_ABI as Abi, "feeBps", []) },
      { to: curve, data: enc(CURVE_ABI as Abi, "getReserves", []) },
    ],
    tag,
  );
  const t = dec<string>(CURVE_ABI as Abi, "token", head[0]);
  const pair = dec<string>(CURVE_ABI as Abi, "pairToken", head[1]);
  if (!t || low(t) !== low(token) || !pair || !/^0x0{40}$/i.test(pair)) return null;
  const graduated = Boolean(dec<boolean>(CURVE_ABI as Abi, "graduated", head[2]));
  const fee = dec<bigint>(CURVE_ABI as Abi, "feeBps", head[3]);
  const reserves = dec<readonly [bigint, bigint]>(CURVE_ABI as Abi, "getReserves", head[4]);
  // Mid: the same ETH at the curve's current reserve ratio, before fee and price movement.
  const midOut = reserves && reserves[0] > 0n ? ((amountIn * reserves[1]) / reserves[0]).toString() : null;
  let amountOut: string | null = null;
  if (!graduated) {
    try {
      const raw = await rpc<string>("eth_call", [
        { from: SIM_FROM, to: curve, gas: `0x${QUOTE_GAS.toString(16)}`, value: `0x${amountIn.toString(16)}`, data: enc(CURVE_ABI as Abi, "buy", [amountIn, 0n, SIM_FROM]) },
        tag,
        { [SIM_FROM]: { balance: `0x${(amountIn + 10n ** 18n).toString(16)}` } },
      ]);
      const out = dec<bigint>(CURVE_ABI as Abi, "buy", raw);
      amountOut = out && out > 0n ? out.toString() : null;
    } catch {
      amountOut = null;
    }
  }
  return { curve: low(curve), graduated, feeBps: fee === null ? null : Number(fee), amountOut, midOut, block };
}
