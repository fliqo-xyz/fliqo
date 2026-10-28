import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_SETTINGS, cleanWatch, decodeSettings, encodeSettings, evaluate, sameWatch, type Watch } from "./watch";

const A = "0x" + "a".repeat(40);
const B = "0x" + "b".repeat(40);

test("cleanWatch lowercases, dedupes, drops junk and the zero address, caps at 50", () => {
  const w = cleanWatch({ tokens: [A.toUpperCase().replace("0X", "0x"), A, "nope", "0x" + "0".repeat(40), B, 5], rules: { [A]: { priceAbove: 2, move24h: -1 }, [B]: "x", ["0x" + "c".repeat(40)]: { priceAbove: 1 } } });
  assert.deepEqual(w.tokens, [A, B]);
  assert.deepEqual(w.rules[A], { priceAbove: 2, priceBelow: null, move24h: null, liqBelow: null });
  assert.equal(Object.keys(w.rules).length, 2);
  const many = cleanWatch({ tokens: Array.from({ length: 70 }, (_, i) => "0x" + i.toString(16).padStart(40, "1")) });
  assert.equal(many.tokens.length, 50);
  assert.deepEqual(cleanWatch(null), { tokens: [], rules: {} });
});

test("settings round-trip through the saved byte form", () => {
  const w: Watch = { tokens: [A, B], rules: { [B]: { priceAbove: 0.0123456789, priceBelow: null, move24h: 15, liqBelow: 5000 } } };
  const bytes = encodeSettings(w);
  const back = decodeSettings(bytes, w.tokens);
  assert.deepEqual(Object.keys(back), [B]);
  assert.equal(back[B].move24h, 15);
  assert.equal(back[B].liqBelow, 5000);
  assert.ok(Math.abs((back[B].priceAbove ?? 0) - 0.0123456789) < 1e-9);
  assert.ok(sameWatch(w, { tokens: [A, B], rules: back }));
});

test("malformed or oversized settings decode to nothing", () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  assert.deepEqual(decodeSettings(enc("not json"), [A]), {});
  assert.deepEqual(decodeSettings(enc('{"v":2,"r":[[0,1,0,0,0]]}'), [A]), {});
  assert.deepEqual(decodeSettings(enc('{"v":1,"r":[[5,1,null,null,null]]}'), [A]), {});
  assert.deepEqual(decodeSettings(enc('{"v":1,"r":[[0,"1",null,null,null]]}'), [A]), {});
  assert.deepEqual(decodeSettings(new Uint8Array(MAX_SETTINGS + 1), [A]), {});
  assert.deepEqual(decodeSettings(new Uint8Array([0xff, 0xfe]), [A]), {});
});

test("encodeSettings refuses settings above the contract limit", () => {
  const tokens = Array.from({ length: 50 }, (_, i) => "0x" + (i + 1).toString(16).padStart(40, "0"));
  const rules = Object.fromEntries(tokens.map((t) => [t, { priceAbove: 123456.78912345, priceBelow: 0.00012345678, move24h: 12.345678, liqBelow: 98765.4321 }]));
  assert.throws(() => encodeSettings({ tokens, rules }), /at most 1536/);
  const few = Object.fromEntries(tokens.map((t) => [t, { priceAbove: 2, priceBelow: null, move24h: 10, liqBelow: null }]));
  assert.ok(encodeSettings({ tokens, rules: few }).length <= MAX_SETTINGS);
});

test("evaluate triggers on met thresholds only; unknown numbers never trigger", () => {
  const r = { priceAbove: 2, priceBelow: 1, move24h: 10, liqBelow: 1000 };
  assert.deepEqual(evaluate(r, { priceUsd: 2.5, change24h: -12, liquidityUsd: 500 }).map((h) => h.kind), ["priceAbove", "move24h", "liqBelow"]);
  assert.deepEqual(evaluate(r, { priceUsd: 0.5, change24h: 3, liquidityUsd: 5000 }).map((h) => h.kind), ["priceBelow"]);
  assert.deepEqual(evaluate(r, { priceUsd: null, change24h: null, liquidityUsd: null }), []);
  assert.deepEqual(evaluate(undefined, { priceUsd: 1, change24h: 1, liquidityUsd: 1 }), []);
});
