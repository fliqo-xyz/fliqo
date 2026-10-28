import { test } from "node:test";
import assert from "node:assert/strict";
import { costPct, edgePct, midOut, minReceived } from "./routes";

test("mid output multiplies through every leg", () => {
  // 1,000 in; leg 1 gives 2 per unit, leg 2 gives 0.5 per unit -> 1,000 out.
  assert.equal(midOut(1000n, [{ num: 2n, den: 1n }, { num: 1n, den: 2n }]), 1000n);
  assert.equal(midOut(10n ** 18n, [{ num: 2400n * 10n ** 6n, den: 10n ** 18n }]), 2400n * 10n ** 6n);
});

test("cost is the gap between the mid price and the quote", () => {
  assert.equal(costPct({ amountOut: "9970", midOut: "10000" }), 0.3);
  assert.equal(costPct({ amountOut: "10000", midOut: "10000" }), 0);
  assert.equal(costPct({ amountOut: "1", midOut: null }), null);
  assert.equal(costPct({ amountOut: "1", midOut: "0" }), null);
});

test("minimum received and edge", () => {
  assert.equal(minReceived(10_000n, 50), 9_950n);
  assert.equal(minReceived(10_000n, 99_999), 5_000n);
  assert.equal(minReceived(10_000n, -5), 10_000n);
  assert.equal(edgePct(10_100n, 10_000n), 1);
  assert.equal(edgePct(1n, 0n), null);
});
