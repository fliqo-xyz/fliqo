import { test } from "node:test";
import assert from "node:assert/strict";
import { feePct, parseUnits, toNumber } from "./swap";
import { costPct, minReceived } from "./routes";

test("parseUnits handles decimals, truncation and junk", () => {
  assert.equal(parseUnits("1.5", 18), 1_500_000_000_000_000_000n);
  assert.equal(parseUnits("0.000001", 6), 1n);
  assert.equal(parseUnits("0.0000001", 6), 0n);
  assert.equal(parseUnits(".5", 2), 50n);
  assert.equal(parseUnits("12", 0), 12n);
  for (const bad of ["", ".", "-1", "1e3", "1,5", "abc", "1.2.3"]) assert.equal(parseUnits(bad, 18), null);
  assert.equal(parseUnits("1", 40), null);
});

test("toNumber reads raw units back for display", () => {
  assert.equal(toNumber("1500000000000000000", 18), 1.5);
  assert.equal(toNumber("1", 6), 0.000001);
  assert.equal(toNumber("42", 0), 42);
  assert.equal(toNumber("x", 6), null);
  assert.equal(toNumber("1", null), null);
});

test("feePct sums leg fees and refuses dynamic fees", () => {
  const leg = (fee: number | null) => ({ pool: "0x", kind: 3 as const, fee, tokenIn: "a", tokenOut: "b" });
  assert.equal(feePct({ legs: [leg(3000)] }), 0.3);
  assert.equal(feePct({ legs: [leg(500), leg(3000)] }), 0.35);
  assert.equal(feePct({ legs: [leg(0x800000)] }), null);
  assert.equal(feePct({ legs: [leg(null)] }), null);
  assert.equal(feePct({ legs: [] }), null);
});

test("cost and minimum received", () => {
  assert.equal(costPct({ amountOut: "990", midOut: "1000" }), 1);
  assert.equal(costPct({ amountOut: "990", midOut: null }), null);
  assert.equal(minReceived(10_000n, 100), 9_900n);
  assert.equal(minReceived(10_000n, 99_999), 5_000n);
});
