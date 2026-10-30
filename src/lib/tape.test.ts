import { test } from "node:test";
import assert from "node:assert/strict";
import { newestTrade, pickTapePools, recentTxns, type PoolRow, type Trade } from "./market";

const WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const HUBS = new Set(["0x0000000000000000000000000000000000000000", WETH, USDG]);
const tok = (address: string, symbol = address.slice(0, 6)) => ({ address, symbol, name: symbol, decimals: 18, logo: null });

function pool(address: string, base: string, quote: string, txns1h: number | null, volume24h = 0, txns24h: number | null = null): PoolRow {
  return {
    address, name: `${base.slice(0, 6)} / ${quote.slice(0, 6)}`, venue: "uniswap-v3-robinhood", venueLabel: "Uniswap v3", feeLabel: null,
    base: tok(base), quote: tok(quote), liquidityUsd: null, volume1h: null, volume6h: null, volume24h, txns1h, txns24h,
    buys24h: null, sells24h: null, priceUsd: null, quotePriceUsd: null, fdvUsd: null, marketCapUsd: null, change1h: null,
    change24h: null, createdAt: null, kind: 3,
  };
}
const A = "0x" + "a".repeat(40);
const B = "0x" + "b".repeat(40);
const C = "0x" + "c".repeat(40);

test("tape ranks by trades in the last hour, not by 24h volume", () => {
  const pools = [
    pool("0x01", A, USDG, 0, 50_000_000), // big volume, no trades this hour (a quiet v4 pool)
    pool("0x02", B, WETH, 1231, 7_000_000),
    pool("0x03", C, USDG, 538, 5_000_000),
  ];
  assert.deepEqual(pickTapePools(pools, HUBS, 3).map((p) => p.address), ["0x02", "0x03"]);
});

test("tape keeps one pool per token and fills with hub pairs last", () => {
  const pools = [
    pool("0xhub", USDG, WETH, 5878),
    pool("0x02", B, WETH, 900),
    pool("0x03", B, USDG, 800),
    pool("0x04", USDG, C, 100), // token on the quote side still counts as token C
  ];
  assert.deepEqual(pickTapePools(pools, HUBS, 3).map((p) => p.address), ["0x02", "0x04", "0xhub"]);
  assert.deepEqual(pickTapePools(pools, HUBS, 2).map((p) => p.address), ["0x02", "0x04"]);
});

test("recent activity falls back to an hourly share of the 24h count", () => {
  assert.equal(recentTxns(pool("0x1", A, USDG, null, 0, 48)), 2);
  assert.equal(recentTxns(pool("0x1", A, USDG, null, 0, null)), 0);
  assert.equal(pickTapePools([pool("0x1", A, USDG, null, 0, null)], HUBS, 3).length, 0);
});

test("newest trade time", () => {
  const t = (time: number | null) => ({ time }) as Trade;
  assert.equal(newestTrade([t(5), t(null), t(9), t(1)]), 9);
  assert.equal(newestTrade([]), null);
});
