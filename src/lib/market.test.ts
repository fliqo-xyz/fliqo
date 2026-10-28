import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanText, normalizeCandles, normalizePools, normalizeTrades, uniquePools, venueSummary } from "./market";

const body = {
  data: [
    {
      id: "robinhood_0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca",
      attributes: {
        address: "0x52E65B17fb6e5ba00ed806f37afcd2daa50271ca",
        name: "USDG / WETH 0.01%",
        reserve_in_usd: "18941033.4184",
        base_token_price_usd: "1.0007",
        volume_usd: { h1: "100", h24: "173449543.68" },
        price_change_percentage: { h24: "0.038" },
        transactions: { h24: { buys: 10, sells: 5 } },
        pool_created_at: "2026-07-02T20:51:08Z",
      },
      relationships: { base_token: { data: { id: "robinhood_0x5fc5360d0400a0fd4f2af552add042d716f1d168" } }, quote_token: { data: { id: "robinhood_0x0bd7d308f8e1639fab988df18a8011f41eacad73" } }, dex: { data: { id: "uniswap-v3-robinhood" } } },
    },
    {
      id: "robinhood_0xbac3aa3b91584a53a579b3c999a56756e954e59247e497bad1d25a4334bde551",
      attributes: { address: "0xbac3aa3b91584a53a579b3c999a56756e954e59247e497bad1d25a4334bde551", name: "WETH / USDG", reserve_in_usd: "not a number" },
      relationships: { base_token: { data: { id: "robinhood_0x0000000000000000000000000000000000000000" } }, quote_token: { data: { id: "robinhood_0x5fc5360d0400a0fd4f2af552add042d716f1d168" } }, dex: { data: { id: "uniswap-v4-robinhood" } } },
    },
    { id: "robinhood_bad", attributes: { address: "nope" }, relationships: {} },
  ],
  included: [
    { id: "robinhood_0x5fc5360d0400a0fd4f2af552add042d716f1d168", type: "token", attributes: { symbol: "USDG‮", name: "Global Dollar", decimals: 6 } },
    { id: "robinhood_0x0bd7d308f8e1639fab988df18a8011f41eacad73", type: "token", attributes: { symbol: "WETH", name: "WETH", decimals: 18 } },
  ],
};

test("pools are normalised, sanitised and classified", () => {
  const rows = normalizePools(body);
  assert.equal(rows.length, 2);
  const [v3, v4] = rows;
  assert.equal(v3.address, "0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca");
  assert.equal(v3.base.symbol, "USDG", "bidi control characters are stripped");
  assert.equal(v3.feeLabel, "0.01%");
  assert.equal(v3.kind, 3);
  assert.equal(v3.txns24h, 15);
  assert.equal(v3.venueLabel, "Uniswap v3");
  assert.equal(v4.kind, 4);
  assert.equal(v4.liquidityUsd, null, "unparseable numbers become null, not 0");
  assert.equal(v4.base.address, "0x0000000000000000000000000000000000000000");
});

test("trades and candles drop malformed rows", () => {
  const t = normalizeTrades({ data: [{ attributes: { tx_hash: "0x" + "ab".repeat(32), tx_from_address: "0x" + "cd".repeat(20), kind: "sell", volume_in_usd: "12.5", block_timestamp: "2026-10-23T21:57:05Z" } }, { attributes: { tx_hash: "bad" } }] });
  assert.equal(t.length, 1);
  assert.equal(t[0].side, "sell");
  const c = normalizeCandles({ data: { attributes: { ohlcv_list: [[2, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1], [3, "x", 1, 1, 1, 1]] } } });
  assert.deepEqual(c.map((x) => x[0]), [1, 2]);
});

test("venue totals and unique pools", () => {
  const rows = normalizePools(body);
  const v = venueSummary(rows);
  assert.equal(v[0].venue, "uniswap-v3-robinhood");
  assert.equal(uniquePools(rows, rows).length, 2);
  assert.equal(cleanText("a\u0000b".repeat(30), 5), "ababa");
});

import { movers, tokensFromPools, type PoolRow } from "./market";

const pool = (address: string, base: string, liq: number, vol: number, chg: number): PoolRow => ({
  address,
  name: "x",
  venue: "uniswap-v3-robinhood",
  venueLabel: "Uniswap v3",
  feeLabel: null,
  base: { address: base, symbol: base.slice(0, 5), name: base, decimals: 18, logo: null },
  quote: { address: "0xq", symbol: "USDG", name: "USDG", decimals: 6, logo: null },
  liquidityUsd: liq,
  volume1h: null,
  volume6h: null,
  volume24h: vol,
  txns1h: null,
  txns24h: null,
  buys24h: null,
  sells24h: null,
  priceUsd: liq / 1000,
  quotePriceUsd: 1,
  fdvUsd: null,
  marketCapUsd: null,
  change1h: null,
  change24h: chg,
  createdAt: null,
  kind: 3,
});

test("token rows: one per base token, priced by the most liquid pool, volume summed", () => {
  const rows = tokensFromPools([pool("0xp1", "0xaaa", 100_000, 10, 5), pool("0xp2", "0xaaa", 500_000, 20, -1), pool("0xp3", "0xbbb", 30_000, 7, 40)], () => "token");
  assert.equal(rows.length, 2);
  const a = rows.find((r) => r.address === "0xaaa")!;
  assert.equal(a.pool, "0xp2");
  assert.equal(a.priceUsd, 500);
  assert.equal(a.volume24h, 30);
  assert.equal(a.change24h, -1);
});

test("movers ignore thin pools", () => {
  const rows = tokensFromPools([pool("0xp1", "0xaaa", 100_000, 1, 5), pool("0xp3", "0xbbb", 1_000, 1, 900), pool("0xp4", "0xccc", 60_000, 1, -9)], () => "token");
  const m = movers(rows);
  assert.deepEqual(m.up.map((r) => r.address), ["0xaaa"]);
  assert.deepEqual(m.down.map((r) => r.address), ["0xccc"]);
});
