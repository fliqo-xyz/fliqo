import { decodeErrorResult, encodeAbiParameters, keccak256, type Abi, type Hex } from "viem";
import probe from "@/lib/contracts/probe.json";
import type { PoolRow } from "@/lib/market";

/*
 * Sell check ("can this token be sold?"), the parts shared by the server route and the pages: storage-slot
 * candidates for balance overrides, tax and round-trip arithmetic, plain words for revert data, which pool to use,
 * and the answer shape. The simulation itself runs on the server (src/lib/server/sellcheck.ts) as one eth_call of
 * the never-deployed FliqoSellProbe (contracts/src/FliqoSellProbe.sol) with state overrides.
 */

export const PROBE_ABI = probe.abi as Abi;
export const PROBE_RUNTIME = probe.runtime as Hex;

/** Venue codes of FliqoSellProbe.run. */
export const VENUE = { v2: 1, v3: 2, v4: 3, curve: 4 } as const;
export type VenueKind = keyof typeof VENUE;

export type Leg = { ok: boolean; sent: bigint; arrived: bigint; poolOut: bigint; received: bigint; gas: bigint; err: Hex };

// ---------- storage slots ----------

const word = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const addrWord = (a: string) => `0x${a.toLowerCase().replace(/^0x/, "").padStart(64, "0")}` as Hex;

/** ERC-7201 base of OpenZeppelin v5 upgradeable ERC20Storage (its first field is the balances mapping). */
export const OZ_ERC20_STORAGE = 0x52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00n;
/** Solady ERC20 balance seed. */
export const SOLADY_BALANCE_SEED = 0x87a211a2n;

export type SlotCandidate = { layout: string; slot: Hex };

/** Solidity mapping slot: keccak256(pad(key) . pad(index)). */
export function solidityMapSlot(holder: string, index: bigint): Hex {
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [holder as Hex, index]));
}
/** Vyper mapping slot: keccak256(pad(index) . pad(key)). */
export function vyperMapSlot(holder: string, index: bigint): Hex {
  return keccak256(`0x${word(index).slice(2)}${addrWord(holder).slice(2)}` as Hex);
}
/** Solady: keccak256(holder (20 bytes) . 8 zero bytes . seed (4 bytes)). */
export function soladyBalanceSlot(holder: string): Hex {
  return keccak256(`0x${holder.toLowerCase().slice(2)}0000000000000000${SOLADY_BALANCE_SEED.toString(16).padStart(8, "0")}` as Hex);
}

/** Every layout tried for balanceOf(holder), most common first. */
export function balanceSlotCandidates(holder: string, maxIndex = 24): SlotCandidate[] {
  const out: SlotCandidate[] = [];
  for (let i = 0n; i <= BigInt(maxIndex); i++) out.push({ layout: `solidity mapping at slot ${i}`, slot: solidityMapSlot(holder, i) });
  out.push({ layout: "OpenZeppelin v5 namespaced storage", slot: solidityMapSlot(holder, OZ_ERC20_STORAGE) });
  out.push({ layout: "Solady ERC20", slot: soladyBalanceSlot(holder) });
  for (let i = 0n; i <= 6n; i++) out.push({ layout: `vyper mapping at slot ${i}`, slot: vyperMapSlot(holder, i) });
  return out;
}

/**
 * The value written while probing: distinctive and small (under 2^40), because some tokens pack a balance into
 * part of a word (USDG on Robinhood Chain answers only the low 64 bits).
 */
export const PROBE_MAGIC = 0x1f1140b0e1n;

/** Index of the candidate whose override made balanceOf answer `magic`, or -1. */
export function matchSlot(answers: (string | null)[], magic = PROBE_MAGIC): number {
  return answers.findIndex((a) => typeof a === "string" && /^0x[0-9a-fA-F]{64}$/.test(a) && BigInt(a) === magic);
}

// ---------- arithmetic ----------

/** Share lost between `expected` and `actual`, in basis points (0..10000), or null when nothing was expected. */
export function lossBps(expected: bigint, actual: bigint): number | null {
  if (expected <= 0n) return null;
  if (actual >= expected) return 0;
  return Number(((expected - actual) * 10_000n) / expected);
}

/**
 * Transfer tax seen in one leg: paying in (sent vs arrived at the pool) and paying out (released by the pool vs
 * received), combined. Returns null when neither side could be measured.
 */
export function legTaxBps(l: Pick<Leg, "sent" | "arrived" | "poolOut" | "received">, side: "buy" | "sell"): number | null {
  // Buy: the quote is plain (ETH, WETH, USDG …): the token tax shows on the way out of the pool.
  // Sell: the token tax shows on the way into the pool; the quote received is plain.
  if (side === "buy") return lossBps(l.poolOut, l.received);
  return l.arrived > 0n ? lossBps(l.sent, l.arrived) : null;
}

// ---------- revert words ----------

const STD_ERRORS = [
  { type: "error", name: "Error", inputs: [{ name: "message", type: "string" }] },
  { type: "error", name: "Panic", inputs: [{ name: "code", type: "uint256" }] },
] as const;

const V4_ERRORS = [
  { type: "error", name: "CurrencyNotSettled", inputs: [] },
  { type: "error", name: "PoolNotInitialized", inputs: [] },
  { type: "error", name: "PriceLimitAlreadyExceeded", inputs: [{ type: "uint160" }, { type: "uint160" }] },
  { type: "error", name: "WrappedError", inputs: [{ name: "target", type: "address" }, { name: "selector", type: "bytes4" }, { name: "reason", type: "bytes" }, { name: "details", type: "bytes" }] },
] as const;

const STRING_WORDS: Record<string, string> = {
  IIA: "the pool received less than it was owed (the token takes a fee on transfer, which this pool type refuses)",
  TF: "a token transfer inside the pool failed",
  STF: "a token transfer inside the pool failed",
  LOK: "the pool is locked",
  SPL: "the price limit was reached",
  AS: "the amount was zero",
  "UniswapV2: K": "the pair refused the swap (its balance check failed, which usually means a fee on transfer larger than expected)",
  "UniswapV2: INSUFFICIENT_OUTPUT_AMOUNT": "the pair would pay out nothing for this size",
  "UniswapV2: TRANSFER_FAILED": "the pair could not send the token out",
};

/** Plain words for revert data of a step. Never guesses: an unknown error is shown with its selector. */
export function revertWords(data: string | null | undefined, depth = 0): string {
  if (!data || data === "0x" || data.length < 10) return "it reverted without a reason";
  try {
    const d = decodeErrorResult({ abi: [...STD_ERRORS, ...V4_ERRORS, ...PROBE_ABI.filter((x) => x.type === "error")] as Abi, data: data as Hex });
    const args = (d.args ?? []) as readonly unknown[];
    switch (d.errorName) {
      case "Error": {
        const m = String(args[0] ?? "").slice(0, 160);
        return STRING_WORDS[m] ? `"${m}": ${STRING_WORDS[m]}` : `it reverted with "${m}"`;
      }
      case "Panic":
        return `it reverted with panic code 0x${(args[0] as bigint).toString(16)} (an arithmetic or assertion failure)`;
      case "TaxedTransfer": {
        const owed = args[0] as bigint;
        const arrived = args[1] as bigint;
        const b = lossBps(owed, arrived);
        if (arrived === 0n) return "nothing of the amount paid in reached the pool (the token keeps or redirects the whole transfer)";
        return `the pool received ${b === null ? "less" : `${(b / 100).toFixed(2)}% less`} than was paid in (a fee on transfer), and this pool type refuses a short payment`;
      }
      case "NoQuoteBalance":
        return "the simulation could not hold enough of the paying token";
      case "CurrencyNotSettled":
        return "the pool manager was not paid in full (a fee on transfer or a hook took part of the payment)";
      case "PoolNotInitialized":
        return "the pool is not initialised";
      case "WrappedError": {
        const inner = depth < 2 ? revertWords(args[2] as string, depth + 1) : "a nested error";
        return `the pool's hook or a token reverted inside the pool manager: ${inner}`;
      }
      default:
        return `it reverted with ${d.errorName}`;
    }
  } catch {
    return `it reverted with an unknown custom error (selector ${data.slice(0, 10)})`;
  }
}

// ---------- pool choice ----------

const isPonsCurve = (p: PoolRow) => p.venue === "pons-v2" && /^0x[0-9a-f]{40}$/.test(p.address);

/** How the probe trades in a pool, or null when this venue is not simulated. */
export function venueOf(p: PoolRow): VenueKind | null {
  if (isPonsCurve(p)) return "curve";
  if (p.kind === 2) return "v2";
  if (p.kind === 3) return "v3";
  if (p.kind === 4) return "v4";
  return null;
}

/**
 * Pools the sell check may use for `token`, best first: pools whose venue the probe can trade, that hold the token on
 * one side and know the USD price of the other side (to size a small trade), most liquid first.
 */
export function sellPools(pools: PoolRow[], token: string): PoolRow[] {
  const t = token.toLowerCase();
  return pools
    .filter((p) => venueOf(p) !== null && (p.base.address === t || p.quote.address === t))
    .filter((p) => (p.base.address === t ? p.quotePriceUsd : p.priceUsd) !== null)
    .sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0));
}

/** Raw units worth `usd` of a token priced `priceUsd` with `decimals`, or null. */
export function unitsForUsd(usd: number, priceUsd: number | null, decimals: number | null): bigint | null {
  if (!priceUsd || priceUsd <= 0 || decimals === null || decimals < 0 || decimals > 36) return null;
  const whole = usd / priceUsd;
  if (!Number.isFinite(whole) || whole <= 0) return null;
  // Six significant digits are plenty for a probe size; scale through a string to stay exact in bigint.
  const [m, e] = whole.toExponential(5).split("e");
  const digits = BigInt(m.replace(".", ""));
  const exp = Number(e) - 5 + decimals;
  return exp >= 0 ? digits * 10n ** BigInt(exp) : digits / 10n ** BigInt(-exp);
}

// ---------- answer ----------

export type SellStatus = "sells" | "sell-reverts" | "buy-reverts" | "not-simulated";

export type SellCheckLeg = {
  ok: boolean;
  /** Paid in (raw units of what this leg spends). */
  sent: string;
  /** Released by the pool (raw units of what this leg buys). */
  poolOut: string;
  /** What reached the probe. */
  received: string;
  taxBps: number | null;
  gas: number | null;
  error: string | null;
};

export type SellCheck = {
  token: string;
  status: SellStatus;
  /** One factual sentence for the page. */
  summary: string;
  pool: { address: string; name: string; venueLabel: string; venue: VenueKind } | null;
  quote: { address: string; symbol: string; decimals: number | null } | null;
  /** USD size of the probe trade (from the pool's own prices). */
  sizeUsd: number | null;
  buy: SellCheckLeg | null;
  sell: SellCheckLeg | null;
  /** True when the sell used a balance given by a storage override (the buy itself reverted). */
  sellFromOverride: boolean;
  /** Share of the quote lost buying and selling back: pool fees, price impact and any taxes together. */
  roundTripBps: number | null;
  block: number | null;
  at: number;
};

/** `maxGas`: the call's gas budget, so a step that burnt (nearly) all of it is reported as running out of gas. */
export function legOut(l: Leg, side: "buy" | "sell", maxGas = 0): SellCheckLeg {
  const outOfGas = !l.ok && (l.err === "0x" || !l.err) && maxGas > 0 && Number(l.gas) >= maxGas * 0.85;
  return {
    ok: l.ok,
    sent: l.sent.toString(),
    poolOut: l.poolOut.toString(),
    received: l.received.toString(),
    taxBps: l.ok ? legTaxBps(l, side) : null,
    gas: l.gas > 0n ? Number(l.gas) : null,
    error: l.ok ? null : outOfGas ? "it ran out of the simulation's gas (the pool may have almost no liquidity near its current price)" : revertWords(l.err),
  };
}

const pctText = (bps: number) => `${(bps / 100).toFixed(bps > 0 && bps < 10 ? 2 : 1)}%`;

/** Status and the one-line summary from the two legs. */
export function judge(buy: SellCheckLeg | null, sell: SellCheckLeg | null, fromOverride: boolean, symbol: string): { status: SellStatus; summary: string } {
  if (!buy?.ok && !fromOverride) return { status: "buy-reverts", summary: `A small buy of $${symbol} reverted in simulation: ${buy?.error ?? "no answer"}. The sell could not be checked.` };
  if (!sell) return { status: "not-simulated", summary: `The sell of $${symbol} could not be simulated.` };
  if (!sell.ok) return { status: "sell-reverts", summary: `Selling $${symbol} reverted in simulation: ${sell.error ?? "no reason"}.` };
  const taxes = [buy?.ok && buy.taxBps ? `buy tax ${pctText(buy.taxBps)}` : null, sell.taxBps ? `sell tax ${pctText(sell.taxBps)}` : null].filter(Boolean);
  const lead = fromOverride ? `A buy reverted (${buy?.error ?? "no reason"}), but a holder's sell went through in simulation` : "A small buy and the sell back both went through in simulation";
  return { status: "sells", summary: `${lead}${taxes.length ? `, with ${taxes.join(" and ")}` : ", with no transfer tax measured"}.` };
}
