import { test } from "node:test";
import assert from "node:assert/strict";
import { DASH, age, amount, int, pct, price, usdFull, usdShort } from "./format";

test("missing numbers read as a dash, never zero", () => {
  for (const f of [usdShort, usdFull, price, int, pct, amount]) assert.equal(f(null), DASH);
  assert.equal(usdShort(Number.NaN), DASH);
  assert.equal(age(null), DASH);
});

test("dollar formats", () => {
  assert.equal(usdShort(18_941_033), "$18.9M");
  assert.equal(usdShort(76_800), "$76.8K");
  assert.equal(usdShort(174.74), "$174.74");
  assert.equal(usdShort(1_472_000_000), "$1.47B");
  assert.equal(usdFull(1144284.39), "$1,144,284.39");
  assert.equal(price(0.000084), "$0.00008400");
  assert.equal(price(2396.2), "$2,396.2");
  assert.equal(pct(1.234), "+1.23%");
  assert.equal(pct(-0.5), "-0.50%");
});
