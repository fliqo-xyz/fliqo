import { test } from "node:test";
import assert from "node:assert/strict";
import { BUDGETS, charge, chargeRelay } from "./charge";
import { BUDGET, checkBatch } from "./relay";

test("relay refuses every log query, whatever the filter", () => {
  const usdg = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
  for (const f of [
    { address: usdg, fromBlock: "0x1", toBlock: "0x2" },
    { address: usdg, fromBlock: "0x1", toBlock: "0x2", topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"] },
    { fromBlock: "0x1", toBlock: "0x2" },
  ])
    assert.ok("error" in checkBatch([{ method: "eth_getLogs", params: [f] }]));
});

test("transaction lookups take exactly one hash; nonce reads an address and a tag", () => {
  const h = `0x${"ab".repeat(32)}`;
  assert.ok("units" in checkBatch([{ method: "eth_getTransactionByHash", params: [h] }]));
  assert.ok("units" in checkBatch([{ method: "eth_getTransactionReceipt", params: [h] }]));
  assert.ok("error" in checkBatch([{ method: "eth_getTransactionByHash", params: ["0x12"] }]));
  assert.ok("error" in checkBatch([{ method: "eth_getTransactionByHash", params: [h, h] }]));
  const a = `0x${"11".repeat(20)}`;
  assert.ok("units" in checkBatch([{ method: "eth_getTransactionCount", params: [a, "pending"] }]));
  assert.ok("error" in checkBatch([{ method: "eth_getTransactionCount", params: [a, { blockHash: "0x00" }] }]));
  assert.ok("error" in checkBatch([{ method: "eth_getBalance", params: ["nope", "latest"] }]));
});

test("relay always charges the site-wide budget, also with TRUST_PROXY_HEADERS=1", async () => {
  process.env.TRUST_PROXY_HEADERS = "1";
  try {
    let served = 0;
    let siteRefusals = 0;
    for (let i = 0; i < 400; i++) {
      const r = await chargeRelay(null, `n4:30.${i >> 8}.${i & 255}.1`, 100);
      if (r === null) served++;
      else if (/busy/.test(r)) siteRefusals++;
    }
    assert.ok(served * 100 <= BUDGET.siteUnits, `served ${served}`);
    assert.ok(siteRefusals > 0, "site-wide cap never applied");
  } finally {
    delete process.env.TRUST_PROXY_HEADERS;
  }
});

test("token lookups stop at the site-wide budget even when every caller is a different network", async () => {
  process.env.TRUST_PROXY_HEADERS = "1";
  try {
    let ok = 0;
    for (let i = 0; i < BUDGETS.token.site + 50; i++) if ((await charge(null, `n4:20.${i >> 8}.${i & 255}.1`, "token")) === null) ok++;
    assert.ok(ok <= BUDGETS.token.site, `served ${ok}`);
  } finally {
    delete process.env.TRUST_PROXY_HEADERS;
  }
});

test("one network is held to its own budget", async () => {
  let ok = 0;
  for (let i = 0; i < BUDGETS.quote.perNetwork + 10; i++) if ((await charge(null, "n4:40.1.1.1", "quote")) === null) ok++;
  assert.equal(ok, BUDGETS.quote.perNetwork);
});
