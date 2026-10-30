import "server-only";
import { decodeFunctionResult, encodeAbiParameters, encodeFunctionData, type Abi, type Hex } from "viem";
import { WETH } from "@/config/brand";
import { UNISWAP } from "@/config/dex";
import { ERC20_ABI, V4_POSITIONS_ABI } from "@/lib/abi";
import { NATIVE, type PoolRow } from "@/lib/market";
import { hexBlock, latestBlock, rawAll, readAll, VIEW_GAS } from "@/lib/server/chainread";
import { RpcError, rpc, rpcBatch } from "@/lib/feeds/rpc";
import { sharedCache } from "@/lib/server/kvcache";
import {
  PROBE_ABI,
  PROBE_MAGIC,
  PROBE_RUNTIME,
  VENUE,
  balanceSlotCandidates,
  judge,
  legOut,
  lossBps,
  matchSlot,
  revertWords,
  sellPools,
  unitsForUsd,
  venueOf,
  type Leg,
  type SellCheck,
  type SellCheckLeg,
  type VenueKind,
} from "@/lib/sellcheck";

/*
 * Sell check on the server. For the token's most liquid pool that the probe can trade (Uniswap v2/v3/v4 or a Pons
 * curve), one eth_call runs FliqoSellProbe from a throwaway address whose code, ETH balance and (when the pool pays
 * in another token) token balance are set by state overrides only for that call: a small buy (about $5 at the pool's
 * own prices), then the sell of everything received. When the buy itself reverts, the sell is tried once more with a
 * token balance written into the token's balance slot, found by probing the common storage layouts; a token whose
 * layout is not recognised is reported as "could not simulate", never guessed. Nothing is signed or sent, and it
 * never runs in the visitor's browser or through the read relay.
 */

const PROBE_AT = "0x00000000000000000000000000000000f1140b0e";
const SIM_FROM = "0x00000000000000000000000000000000000f1140";
const SIZE_USD = 5;
const RUN_GAS = 8_000_000;
const WETH_LOW = WETH.toLowerCase();
const CURVE_ABI = [
  { type: "function", name: "token", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "pairToken", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const satisfies Abi;

const hex = (n: bigint) => `0x${n.toString(16)}`;
const word = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}`;
// Native ETH shows as the zero address (v4) or 0xeeee…eeee (curves) in the pool lists.
const isNative = (a: string) => a === NATIVE || a === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

/**
 * Storage slot holding balanceOf(PROBE_AT) on `token`, or null when none could be confirmed. Candidates: the slots
 * the node reports balanceOf touching (eth_createAccessList), then the common layouts (see balanceSlotCandidates).
 * A candidate counts only when writing a marker value into it makes balanceOf return exactly that value. Cached a
 * day per token, shared through the store.
 */
export async function balanceSlot(token: string, tag: string): Promise<string | null> {
  const { value } = await sharedCache(`slot:v2:${token}`, 86_400, async () => {
    const data = encodeFunctionData({ abi: ERC20_ABI, functionName: "balanceOf", args: [PROBE_AT] });
    const touched = await rpc<{ accessList?: { address: string; storageKeys: string[] }[] }>("eth_createAccessList", [{ to: token, data }, tag])
      .then((r) => (r.accessList ?? []).filter((e) => e.address.toLowerCase() === token).flatMap((e) => e.storageKeys))
      .catch(() => [] as string[]);
    const slots = [...new Set([...touched.map((k) => k.toLowerCase()), ...balanceSlotCandidates(PROBE_AT).map((c) => c.slot.toLowerCase())])];
    for (let i = 0; i < slots.length; i += 20) {
      const chunk = slots.slice(i, i + 20);
      const raw = await rpcBatch<string>(
        chunk.map((slot) => ({ method: "eth_call", params: [{ to: token, data, gas: hex(BigInt(VIEW_GAS)) }, tag, { [token]: { stateDiff: { [slot]: word(PROBE_MAGIC) } } }] })),
      ).catch(() => chunk.map(() => null));
      const hit = matchSlot(raw);
      if (hit >= 0) return chunk[hit];
    }
    return null;
  });
  return value;
}

const INITIALIZE_TOPIC = "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438";
const LOG_WINDOW = 10_000_000;

/**
 * Key of a Uniswap v4 pool: from the position manager (pools with positions minted through it), else from the pool
 * manager's Initialize log for that id (walked back in 10M-block windows, the most one query may span). Cached a
 * month: a pool key never changes.
 */
export async function v4PoolKey(id: string, tag: string): Promise<readonly [string, string, number, number, string] | null> {
  const { value } = await sharedCache(`v4key:v1:${id}`, 30 * 86_400, async () => {
    const raw = await rawAll([{ to: UNISWAP.v4Positions, data: encodeFunctionData({ abi: V4_POSITIONS_ABI, functionName: "poolKeys", args: [id.slice(0, 52) as Hex] }) }], tag);
    if (raw[0]) {
      const k = decodeFunctionResult({ abi: V4_POSITIONS_ABI, functionName: "poolKeys", data: raw[0] as Hex }) as readonly [string, string, number, number, string];
      if (!/^0x0{40}$/i.test(k[1])) return [k[0], k[1], Number(k[2]), Number(k[3]), k[4]] as const;
    }
    const head = Number(BigInt(tag));
    for (let to = head, n = 0; to > 0 && n < 11; to -= LOG_WINDOW, n++) {
      const from = Math.max(0, to - LOG_WINDOW + 1);
      const logs = await rpc<{ topics: string[]; data: string }[]>("eth_getLogs", [{ address: UNISWAP.v4PoolManager, topics: [INITIALIZE_TOPIC, id], fromBlock: hexBlock(from), toBlock: hexBlock(to) }]);
      const l = logs[0];
      if (l) {
        const w = l.data.slice(2).match(/.{64}/g) ?? [];
        const fee = Number(BigInt(`0x${w[0]}`));
        const raw24 = BigInt(`0x${w[1]}`);
        const spacing = raw24 >= 1n << 255n ? Number(raw24 - (1n << 256n)) : Number(raw24);
        return [`0x${l.topics[2].slice(26)}`, `0x${l.topics[3].slice(26)}`, fee, spacing, `0x${w[2].slice(24)}`] as const;
      }
    }
    return null;
  });
  return value;
}

type Plan = { pool: PoolRow; venue: VenueKind; venueBytes: Hex; quote: string; quoteSymbol: string; quoteDecimals: number | null; quotePrice: number | null; tokenPrice: number | null; tokenDecimals: number | null };

async function plan(pool: PoolRow, token: string, tag: string): Promise<Plan | string> {
  const venue = venueOf(pool)!;
  const tokenIsBase = pool.base.address === token;
  const other = tokenIsBase ? pool.quote : pool.base;
  const base = {
    pool,
    venue,
    quoteSymbol: isNative(other.address) ? "ETH" : other.symbol,
    quoteDecimals: isNative(other.address) ? 18 : other.decimals,
    quotePrice: tokenIsBase ? pool.quotePriceUsd : pool.priceUsd,
    tokenPrice: tokenIsBase ? pool.priceUsd : pool.quotePriceUsd,
    tokenDecimals: (tokenIsBase ? pool.base : pool.quote).decimals,
  };
  if (venue === "v2" || venue === "v3") {
    if (isNative(other.address)) return "this pool lists native ETH, which a v2 or v3 pool cannot hold";
    return { ...base, quote: other.address, venueBytes: encodeAbiParameters([{ type: "address" }], [pool.address as Hex]) };
  }
  if (venue === "curve") {
    const r = await rawAll(
      [
        { to: pool.address, data: encodeFunctionData({ abi: CURVE_ABI, functionName: "token" }) },
        { to: pool.address, data: encodeFunctionData({ abi: CURVE_ABI, functionName: "pairToken" }) },
      ],
      tag,
    );
    const t = r[0] ? `0x${r[0].slice(-40)}`.toLowerCase() : null;
    const pair = r[1] ? `0x${r[1].slice(-40)}`.toLowerCase() : null;
    if (t !== token) return "the curve contract does not name this token";
    if (pair !== NATIVE) return "this curve is paired with a token other than ETH, which the probe does not trade";
    return { ...base, quote: NATIVE, quoteSymbol: "ETH", quoteDecimals: 18, venueBytes: encodeAbiParameters([{ type: "address" }], [pool.address as Hex]) };
  }
  const k = await v4PoolKey(pool.address, tag);
  if (!k) return "the v4 pool key could not be read";
  const c0 = k[0].toLowerCase();
  const c1 = k[1].toLowerCase();
  if (c0 !== token && c1 !== token) return "the v4 pool key does not hold this token";
  const quote = c0 === token ? c1 : c0;
  const venueBytes = encodeAbiParameters(
    [{ type: "address" }, { type: "tuple", components: [{ name: "currency0", type: "address" }, { name: "currency1", type: "address" }, { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" }] }],
    [UNISWAP.v4PoolManager as Hex, { currency0: k[0] as Hex, currency1: k[1] as Hex, fee: Number(k[2]), tickSpacing: Number(k[3]), hooks: k[4] as Hex }],
  );
  return { ...base, quote, quoteSymbol: quote === NATIVE ? "ETH" : base.quoteSymbol, quoteDecimals: quote === NATIVE ? 18 : base.quoteDecimals, venueBytes };
}

type Run = { buy: Leg; sell: Leg } | { failed: string };

async function run(p: Plan, token: string, tag: string, quoteIn: bigint, sellAmount: bigint, overrides: Record<string, unknown>): Promise<Run> {
  const data = encodeFunctionData({ abi: PROBE_ABI, functionName: "run", args: [VENUE[p.venue], p.venueBytes, token, p.quote, WETH_LOW, quoteIn, sellAmount] });
  const eth = p.quote === NATIVE || p.quote === WETH_LOW ? quoteIn * 2n + 10n ** 18n : 10n ** 18n;
  try {
    const raw = await rpc<string>("eth_call", [{ from: SIM_FROM, to: PROBE_AT, gas: hex(BigInt(RUN_GAS)), data }, tag, { [PROBE_AT]: { code: PROBE_RUNTIME, balance: hex(eth) }, ...overrides }]);
    const [buy, sell] = decodeFunctionResult({ abi: PROBE_ABI, functionName: "run", data: raw as Hex }) as readonly [Leg, Leg];
    return { buy, sell };
  } catch (e) {
    if (e instanceof RpcError && e.revert) return { failed: `the simulation itself reverted (${revertWords(e.data)})` };
    return { failed: `the chain could not run the simulation right now (${e instanceof Error ? e.message.slice(0, 100) : "no answer"})` };
  }
}

async function decimalsOf(address: string): Promise<number | null> {
  const [d] = await readAll([{ to: address, abi: ERC20_ABI as Abi, fn: "decimals" }]);
  return d === null || d === undefined ? null : Number(d);
}

const notSimulated = (token: string, summary: string, at: number, block: number | null, extra: Partial<SellCheck> = {}): SellCheck => ({
  token,
  status: "not-simulated",
  summary,
  pool: null,
  quote: null,
  sizeUsd: null,
  buy: null,
  sell: null,
  sellFromOverride: false,
  roundTripBps: null,
  block,
  at,
  ...extra,
});

/** Runs the sell check of `token` on the best pools in `pools` (from GeckoTerminal's index for the token). */
export async function sellCheck(token: string, pools: PoolRow[], symbol: string): Promise<SellCheck> {
  const t = token.toLowerCase();
  const at = Date.now();
  const candidates = sellPools(pools, t).slice(0, 3);
  if (!candidates.length) return notSimulated(t, pools.length ? "None of this token's listed pools is on a venue the simulation trades (Uniswap v2, v3, v4 or a Pons curve) with a known price for the other side." : "No pool for this token is listed yet, so there is nothing to simulate against.", at, null);
  const block = await latestBlock();
  const tag = hexBlock(block);
  let last = "";
  // The first pool where the buy itself reverted: used for a holder's sell if no pool accepts a buy.
  let reverted: { p: Plan; overrides: Record<string, unknown>; quoteIn: bigint; buy: SellCheckLeg; poolInfo: NonNullable<SellCheck["pool"]>; quoteInfo: NonNullable<SellCheck["quote"]> } | null = null;
  for (const pool of candidates) {
    const p = await plan(pool, t, tag).catch((e) => (e instanceof Error ? e.message : "the pool could not be read"));
    if (typeof p === "string") {
      last = p;
      continue;
    }
    const poolInfo = { address: pool.address, name: pool.name, venueLabel: pool.venueLabel, venue: p.venue };
    const quoteDecimals = p.quoteDecimals ?? (await decimalsOf(p.quote));
    const quoteInfo = { address: p.quote, symbol: p.quoteSymbol, decimals: quoteDecimals };
    const quoteIn = unitsForUsd(SIZE_USD, p.quotePrice, quoteDecimals);
    if (!quoteIn || quoteIn === 0n) {
      last = `the ${p.quoteSymbol} price or decimals are not known, so the trade could not be sized`;
      continue;
    }
    // The paying side: ETH comes from the probe's balance (wrapped when the pool wants WETH); any other token needs a
    // balance written into its storage.
    const overrides: Record<string, unknown> = {};
    if (p.quote !== NATIVE && p.quote !== WETH_LOW) {
      const slot = await balanceSlot(p.quote, tag);
      if (!slot) {
        last = `the simulation could not hold ${p.quoteSymbol} (its balance storage layout was not recognised)`;
        continue;
      }
      overrides[p.quote] = { stateDiff: { [slot]: word(quoteIn * 2n) } };
    }
    const r = await run(p, t, tag, quoteIn, 0n, overrides);
    if ("failed" in r) {
      last = r.failed;
      continue;
    }
    const buy = legOut(r.buy, "buy", RUN_GAS);
    if (!r.buy.ok) {
      reverted ??= { p, overrides, quoteIn, buy, poolInfo, quoteInfo };
      last = `a buy in ${pool.name} reverted: ${buy.error}`;
      continue;
    }
    if (r.buy.received === 0n) {
      last = `${pool.name} paid out nothing for a $${SIZE_USD} buy (no liquidity near its current price)`;
      continue;
    }
    const sell = legOut(r.sell, "sell", RUN_GAS);
    const j = judge(buy, sell, false, symbol);
    return { token: t, status: j.status, summary: j.summary, pool: poolInfo, quote: quoteInfo, sizeUsd: SIZE_USD, buy, sell, sellFromOverride: false, roundTripBps: sell.ok ? lossBps(BigInt(buy.sent), BigInt(sell.received)) : null, block, at };
  }
  if (reverted) {
    // No pool accepted a buy. Can an existing holder still sell? Give the probe a balance through the token's storage.
    const { p, overrides, quoteIn, buy, poolInfo, quoteInfo } = reverted;
    const base = { token: t, pool: poolInfo, quote: quoteInfo, sizeUsd: SIZE_USD, buy, roundTripBps: null, block, at };
    const slot = await balanceSlot(t, tag);
    const tokenDecimals = p.tokenDecimals ?? (await decimalsOf(t));
    const amount = unitsForUsd(SIZE_USD, p.tokenPrice, tokenDecimals);
    if (!slot || !amount || amount === 0n) {
      const why = !slot ? "its balance storage layout was not recognised" : "its price or decimals are not known";
      return { ...base, status: "buy-reverts", summary: `${judge(buy, null, false, symbol).summary} A holder's sell could not be simulated either: ${why}.`, sell: null, sellFromOverride: false };
    }
    const second = await run(p, t, tag, quoteIn, amount, { ...overrides, [t]: { stateDiff: { [slot]: word(amount) } } });
    if ("failed" in second) return { ...base, status: "buy-reverts", summary: `${judge(buy, null, false, symbol).summary} A holder's sell could not be simulated: ${second.failed}.`, sell: null, sellFromOverride: false };
    const sell = legOut(second.sell, "sell", RUN_GAS);
    if (!sell.ok) {
      // The buy and a holder's sell both fail in the same pool: that points at the pool (a hook that admits only its
      // own router, or no liquidity near the price) as much as at the token, so no verdict is given.
      return { ...base, status: "not-simulated", summary: `In ${poolInfo.name} a small buy reverted (${buy.error}) and a holder's sell reverted as well (${sell.error}). Both failing in the same pool can come from the pool itself, so this does not tell whether $${symbol} can be sold elsewhere.`, sell, sellFromOverride: true };
    }
    const j = judge(buy, sell, true, symbol);
    return { ...base, status: j.status, summary: j.summary, sell, sellFromOverride: true };
  }
  return notSimulated(t, `Could not simulate a sell: ${last || "no pool could be prepared"}.`, at, block);
}
