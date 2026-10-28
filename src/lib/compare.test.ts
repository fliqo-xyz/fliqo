import { test } from "node:test";
import assert from "node:assert/strict";
import { metricRows, rebase } from "./compare";
import type { Candle } from "./market";

const c = (t: number, close: number): Candle => [t, close, close, close, close, 1];

test("rebase puts both series at 0% on the first shared timestamp", () => {
  const p = rebase([c(1, 10), c(2, 11), c(3, 12)], [c(2, 100), c(3, 50), c(4, 60)]);
  assert.deepEqual(p.map((x) => x.t), [2, 3]);
  assert.equal(p[0].a, 0);
  assert.equal(p[0].b, 0);
  assert.ok(Math.abs((p[1].a ?? 0) - 9.0909) < 1e-3);
  assert.equal(p[1].b, -50);
});

test("rebase without shared times rebases each side on its own", () => {
  const p = rebase([c(1, 2), c(3, 4)], [c(2, 5), c(4, 10)]);
  assert.deepEqual(p.map((x) => x.t), [1, 2, 3, 4]);
  assert.equal(p[0].a, 0);
  assert.equal(p[0].b, null);
  assert.equal(p[3].b, 100);
  assert.deepEqual(rebase([], []), []);
});

test("metric rows mark the larger side only when both are known", () => {
  const rows = metricRows(
    { priceUsd: 1, change24h: 5, marketCapUsd: null, fdvUsd: 10, liquidityUsd: 100, volume24h: 50, txns24h: 3, buys24h: 2, sells24h: 1 },
    { priceUsd: 2, change24h: 5, marketCapUsd: 7, fdvUsd: 5, liquidityUsd: 0, volume24h: 10, txns24h: 3, buys24h: 1, sells24h: 0 },
  );
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(by.price.larger, "b");
  assert.equal(by.ch24.larger, null);
  assert.equal(by.mc.larger, null);
  assert.equal(by.fdv.larger, "a");
  assert.equal(by.turn.a, 0.5);
  assert.equal(by.turn.b, null);
  assert.equal(by.bs.b, null);
});
