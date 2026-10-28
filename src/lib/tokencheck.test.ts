import { test } from "node:test";
import assert from "node:assert/strict";
import { buildChecks, marketChecks, scanCode, type MarketInput, type TokenFacts } from "./tokencheck";

test("selectors are found only as PUSH4 operands, not inside other push data", () => {
  // PUSH4 40c10f19 (mint) then PUSH32 holding 8456cb59 (pause) as plain data.
  const code = "0x6340c10f19" + "7f" + "8456cb59".padEnd(64, "0");
  const s = scanCode(code);
  assert.equal(s.mint, true);
  assert.equal(s.pause, false);
});

test("trading switch, limits and upgrade selectors are recognised", () => {
  const s = scanCode("0x638a8c523c63ec28438a634f1ef286");
  assert.equal(s.tradingSwitch, true);
  assert.equal(s.limits, true);
  assert.equal(s.upgrade, true);
});

const base: TokenFacts = {
  address: "0x" + "1".repeat(40),
  block: 1,
  codeSize: 100,
  name: "T",
  symbol: "T",
  decimals: 18,
  totalSupply: "1",
  owner: "renounced",
  proxy: null,
  selectors: { mint: false, pause: false, blocklist: false, fees: false, ownerTransfer: false, tradingSwitch: false, limits: false, upgrade: false },
  stockToken: null,
};

test("checks are facts with a source; nothing found never reads as a verdict", () => {
  const none = buildChecks(base);
  assert.deepEqual(none.map((c) => c.id), ["erc20", "owner", "none"]);
  assert.match(none[2].detail, /not a guarantee/);
  const flagged = buildChecks({ ...base, owner: "0x" + "3".repeat(40), proxy: { implementation: "0x" + "2".repeat(40), admin: null, beacon: null }, selectors: { ...base.selectors, mint: true, tradingSwitch: true } });
  assert.deepEqual(flagged.map((c) => c.id).sort(), ["erc20", "mint", "owner", "proxy", "switch"]);
  for (const c of [...none, ...flagged]) {
    assert.ok(c.source.length > 0);
    assert.doesNotMatch(`${c.title} ${c.detail}`, /\bsafe\b|scam|aud[i]t/i);
  }
});

test("missing metadata and missing owner() are stated", () => {
  const c = buildChecks({ ...base, symbol: null, owner: null });
  assert.equal(c.find((x) => x.id === "erc20")?.level, "flag");
  assert.equal(c.find((x) => x.id === "owner")?.level, "note");
});

test("no code and native ETH", () => {
  assert.equal(buildChecks({ ...base, codeSize: 0 })[0].id, "nocode");
  assert.equal(buildChecks(null, true)[0].id, "native");
  assert.equal(buildChecks(null)[0].id, "unread");
});

const pool = (p: Partial<MarketInput>): MarketInput => ({ liquidityUsd: 100_000, volume24h: 1000, txns24h: 50, buys24h: 25, sells24h: 25, createdAt: 0, venue: "uniswap-v4-robinhood", ...p });

test("market checks: thin, modest and read liquidity", () => {
  assert.equal(marketChecks([pool({ liquidityUsd: 5_000 })])[0].level, "flag");
  assert.equal(marketChecks([pool({ liquidityUsd: 20_000 })])[0].level, "note");
  assert.equal(marketChecks([pool({})])[0].level, "ok");
  assert.equal(marketChecks([])[0].id, "nopools");
});

test("market checks: one pool dominates, young market, one-sided and quiet flow", () => {
  const now = 10 * 86_400_000;
  const ids = (x: ReturnType<typeof marketChecks>) => x.map((c) => c.id);
  assert.ok(ids(marketChecks([pool({ liquidityUsd: 99_000 }), pool({ liquidityUsd: 1_000 })], now)).includes("onepool"));
  assert.ok(ids(marketChecks([pool({ createdAt: now - 3_600_000 })], now)).includes("young"));
  assert.ok(!ids(marketChecks([pool({ createdAt: now - 3 * 86_400_000 })], now)).includes("young"));
  assert.ok(ids(marketChecks([pool({ buys24h: 100, sells24h: 5 })], now)).includes("oneway"));
  assert.ok(ids(marketChecks([pool({ buys24h: 0, sells24h: 0 })], now)).includes("quiet"));
  for (const c of marketChecks([pool({ liquidityUsd: 1 })], now)) assert.doesNotMatch(c.detail, /\bsafe\b/i);
});
