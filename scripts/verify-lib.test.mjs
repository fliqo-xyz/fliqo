// verify-lib against a fake chain built from this build's artifacts: a true deployment matches, and
// a foreign runtime, a wrong chain, appended arguments or a creation tx for another address each fail.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { match, verifyDeployment } from "./verify-lib.mjs";

const ART = JSON.parse(readFileSync(new URL("../src/lib/contracts/artifacts.json", import.meta.url), "utf8")).contracts;
const A = (n) => "0x" + n.toString(16).padStart(40, "0");
const BOOK = A(0x9e55);
const TX = "0x" + "01".repeat(32);

function chain(over = {}) {
  const codes = { [BOOK]: ART.FliqoWatchBook.runtime, ...over.codes };
  const tx = { input: over.input ?? ART.FliqoWatchBook.creation, to: over.to ?? null, created: over.created ?? BOOK };
  return async (method, params) => {
    if (method === "eth_chainId") return over.chainId ?? "0x1237";
    if (method === "eth_getCode") return codes[params[0].toLowerCase()] ?? "0x";
    if (method === "eth_getTransactionByHash") return params[0] === TX ? { input: tx.input, to: tx.to } : null;
    if (method === "eth_getTransactionReceipt") return params[0] === TX ? { status: over.status ?? "0x1", contractAddress: tx.created } : null;
    throw new Error(`unexpected ${method}`);
  };
}

const args = { book: BOOK, bookTx: TX, ART };

test("a true deployment matches every check", async () => {
  const r = await verifyDeployment({ ...args, rpc: chain() });
  assert.equal(r.ok, true, r.lines.join("\n"));
  assert.ok(r.lines.some((l) => l.includes("creation input is exactly this build")));
});

test("foreign runtime code fails", async () => {
  const r = await verifyDeployment({ ...args, rpc: chain({ codes: { [BOOK]: "0x6080604052" } }) });
  assert.equal(r.ok, false);
});

test("no code fails", async () => {
  const r = await verifyDeployment({ ...args, book: A(0x1), rpc: chain() });
  assert.equal(r.ok, false);
});

test("the wrong chain fails before anything else", async () => {
  const r = await verifyDeployment({ ...args, rpc: chain({ chainId: "0x1" }) });
  assert.equal(r.ok, false);
  assert.equal(r.lines.length, 1);
});

test("appended constructor bytes fail", async () => {
  const r = await verifyDeployment({ ...args, rpc: chain({ input: ART.FliqoWatchBook.creation + "00".repeat(32) }) });
  assert.equal(r.ok, false);
});

test("a creation tx for another address, a failed tx or a call fail", async () => {
  for (const over of [{ created: A(0x2) }, { status: "0x0" }, { to: A(0x3) }]) {
    const r = await verifyDeployment({ ...args, rpc: chain(over) });
    assert.equal(r.ok, false, JSON.stringify(over));
  }
});

test("an RPC error is a FAIL, not a skip", async () => {
  const r = await verifyDeployment({ ...args, rpc: async () => { throw new Error("down"); } });
  assert.equal(r.ok, false);
});

test("match is byte exact", () => {
  const code = ART.FliqoWatchBook.runtime;
  assert.equal(match(ART, "FliqoWatchBook", code), true);
  const flipped = code.slice(0, 100) + (code[100] === "0" ? "1" : "0") + code.slice(101);
  assert.equal(match(ART, "FliqoWatchBook", flipped), false);
});

test("a missing creation tx is never a MATCH", async () => {
  const r = await verifyDeployment({ book: BOOK, ART, rpc: chain() });
  assert.equal(r.ok, false);
  assert.ok(r.lines.some((l) => l.startsWith("FAIL") && l.includes("no creation tx")));
});

test("a tx hash that is not a deployment of this address fails", async () => {
  const r = await verifyDeployment({ ...args, bookTx: "0x" + "02".repeat(32), rpc: chain() });
  assert.equal(r.ok, false);
  const bad = await verifyDeployment({ ...args, bookTx: "0x01", rpc: chain() });
  assert.equal(bad.ok, false);
});
