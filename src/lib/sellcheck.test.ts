import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeAbiParameters, encodeErrorResult, parseAbi, type Hex } from "viem";
import {
  PROBE_ABI,
  PROBE_MAGIC,
  balanceSlotCandidates,
  judge,
  legOut,
  legTaxBps,
  lossBps,
  matchSlot,
  revertWords,
  sellPools,
  solidityMapSlot,
  unitsForUsd,
  venueOf,
} from "./sellcheck";
import type { PoolRow } from "./market";

const PROBE_AT = "0x00000000000000000000000000000000f1140b0e";

test("solidity mapping slot matches the USDG balance slot found on chain 4663", () => {
  // eth_createAccessList of USDG.balanceOf(PROBE_AT) touched this key, and an override of it moved the balance (30 Oct 2026).
  assert.equal(solidityMapSlot(PROBE_AT, 1n), "0x0e16f63e3cf6ff63201495e77e4cf0b69ec113cde504c065ece66bfd3ca8448e");
});

test("slot candidates cover the common layouts without repeats", () => {
  const c = balanceSlotCandidates(PROBE_AT);
  assert.equal(new Set(c.map((x) => x.slot)).size, c.length);
  assert.ok(c.some((x) => x.layout.startsWith("OpenZeppelin v5")));
  assert.ok(c.some((x) => x.layout === "Solady ERC20"));
  assert.ok(c.some((x) => x.layout.startsWith("vyper")));
  assert.ok(c.every((x) => /^0x[0-9a-f]{64}$/.test(x.slot)));
});

test("the probe marker fits a 64-bit packed balance", () => {
  assert.ok(PROBE_MAGIC < 2n ** 40n);
});

test("matchSlot accepts only an exact echo of the marker", () => {
  const w = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}`;
  assert.equal(matchSlot([null, w(0n), w(PROBE_MAGIC), w(PROBE_MAGIC)]), 2);
  assert.equal(matchSlot([w(PROBE_MAGIC + 1n), "0x", null]), -1);
  // A token that packs only part of the word answers a different number: not a match.
  assert.equal(matchSlot([w(PROBE_MAGIC & 0xffffn)]), -1);
});

test("loss and tax arithmetic in basis points", () => {
  assert.equal(lossBps(1000n, 970n), 300);
  assert.equal(lossBps(1000n, 1000n), 0);
  assert.equal(lossBps(1000n, 1200n), 0);
  assert.equal(lossBps(0n, 5n), null);
  // Buy: tax on the way out of the pool. Sell: tax on the way into the pool.
  assert.equal(legTaxBps({ sent: 10n, arrived: 10n, poolOut: 10_000n, received: 9_500n }, "buy"), 500);
  assert.equal(legTaxBps({ sent: 10_000n, arrived: 9_700n, poolOut: 1n, received: 1n }, "sell"), 300);
  // A curve that burns what it buys back: arrival not measured.
  assert.equal(legTaxBps({ sent: 10_000n, arrived: 0n, poolOut: 1n, received: 1n }, "sell"), null);
});

test("units for a USD size", () => {
  assert.equal(unitsForUsd(5, 2000, 18), 2_500_000_000_000_000n);
  assert.equal(unitsForUsd(5, 1, 6), 5_000_000n);
  assert.equal(unitsForUsd(5, 0.000001, 18), 5_000_000n * 10n ** 18n);
  assert.equal(unitsForUsd(5, null, 18), null);
  assert.equal(unitsForUsd(5, 3, null), null);
});

test("revert words: strings, the probe's own errors, panics and unknown selectors", () => {
  const err = (m: string) => encodeErrorResult({ abi: parseAbi(["error Error(string)"]), errorName: "Error", args: [m] });
  assert.equal(revertWords(err("sell locked")), 'it reverted with "sell locked"');
  assert.match(revertWords(err("IIA")), /fee on transfer/);
  assert.match(revertWords(encodeErrorResult({ abi: PROBE_ABI, errorName: "TaxedTransfer", args: [1000n, 950n] })), /5\.00% less/);
  assert.match(revertWords(encodeErrorResult({ abi: PROBE_ABI, errorName: "TaxedTransfer", args: [1000n, 0n] })), /nothing of the amount/);
  assert.match(revertWords(encodeErrorResult({ abi: parseAbi(["error Panic(uint256)"]), errorName: "Panic", args: [0x11n] })), /0x11/);
  assert.match(revertWords("0xbe8b8507" as Hex), /SwapAmountCannotBeZero|unknown custom error/);
  assert.match(revertWords("0xdeadbeef"), /unknown custom error \(selector 0xdeadbeef\)/);
  assert.equal(revertWords("0x"), "it reverted without a reason");
});

test("a leg that burnt its whole gas budget is reported as out of gas", () => {
  const l = legOut({ ok: false, sent: 0n, arrived: 0n, poolOut: 0n, received: 0n, gas: 7_400_000n, err: "0x" }, "buy", 8_000_000);
  assert.match(l.error!, /ran out of the simulation's gas/);
});

const tok = (address: string) => ({ address, symbol: address.slice(2, 6), name: "", decimals: 18, logo: null });
function pool(address: string, venue: string, kind: 2 | 3 | 4 | null, liq: number, base: string, quote: string, quotePriceUsd: number | null = 2000): PoolRow {
  return { address, name: "", venue, venueLabel: venue, feeLabel: null, base: tok(base), quote: tok(quote), liquidityUsd: liq, volume1h: null, volume6h: null, volume24h: null, txns1h: null, txns24h: null, buys24h: null, sells24h: null, priceUsd: 1, quotePriceUsd, fdvUsd: null, marketCapUsd: null, change1h: null, change24h: null, createdAt: null, kind };
}
const T = "0x" + "1".repeat(40);
const Q = "0x" + "2".repeat(40);

test("sell pools: supported venues holding the token with a priced other side, deepest first", () => {
  const pools = [
    pool("0x" + "a".repeat(40), "uniswap-v2-robinhood", 2, 100, T, Q),
    pool("0x" + "b".repeat(64), "uniswap-v4-robinhood", 4, 900, T, Q),
    pool("0x" + "c".repeat(40), "pons-v2", null, 500, T, Q),
    pool("0x" + "d".repeat(40), "some-other-dex", null, 5000, T, Q),
    pool("0x" + "e".repeat(40), "uniswap-v3-robinhood", 3, 9000, T, Q, null),
  ];
  assert.deepEqual(sellPools(pools, T).map((p) => venueOf(p)), ["v4", "curve", "v2"]);
});

test("judge: wording follows what the legs show", () => {
  const ok = { ok: true, sent: "1", poolOut: "1", received: "1", taxBps: 0, gas: 1, error: null };
  assert.equal(judge(ok, ok, false, "X").status, "sells");
  assert.match(judge(ok, ok, false, "X").summary, /no transfer tax measured/);
  assert.match(judge({ ...ok, taxBps: 300 }, { ...ok, taxBps: 500 }, false, "X").summary, /buy tax 3\.0% and sell tax 5\.0%/);
  const bad = { ...ok, ok: false, error: 'it reverted with "sell locked"' };
  assert.equal(judge(ok, bad, false, "X").status, "sell-reverts");
  assert.equal(judge(bad, null, false, "X").status, "buy-reverts");
  assert.match(judge(bad, ok, true, "X").summary, /holder's sell went through/);
});

test("venue bytes for v2/v3 are one padded address", () => {
  assert.equal(encodeAbiParameters([{ type: "address" }], [T as Hex]).length, 66);
});
