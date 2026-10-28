import { test } from "node:test";
import assert from "node:assert/strict";
import { checkBatch, readTargets, type Call } from "./relay";

const target = [...readTargets()][0];
const callWith = (tx: Record<string, unknown>): Call => ({ method: "eth_call", params: [tx, "latest"] });

test("call data sent as `input` is size-checked like `data`", () => {
  const big = `0x${"ab".repeat(40_000)}`;
  assert.ok("error" in checkBatch([callWith({ to: target, data: big })]));
  assert.ok("error" in checkBatch([callWith({ to: target, input: big })]));
});

test("`data` and `input` that disagree are refused", () => {
  assert.ok("error" in checkBatch([callWith({ to: target, data: "0x01", input: "0x02" })]));
});

test("`input` is folded into `data` and a call without gas gets the relay cap", () => {
  const tx: Record<string, unknown> = { to: target, input: "0x18160ddd" };
  assert.ok("units" in checkBatch([callWith(tx)]));
  assert.equal(tx.data, "0x18160ddd");
  assert.equal(tx.input, undefined);
  assert.equal(typeof tx.gas, "string");
  assert.ok(Number(BigInt(tx.gas as string)) <= 5_000_000);
});

test("gas above the cap and non-hex data are refused", () => {
  assert.ok("error" in checkBatch([callWith({ to: target, data: "0x18160ddd", gas: "0x1312d00" })]));
  assert.ok("error" in checkBatch([callWith({ to: target, data: "hello" })]));
});

test("field names must match exactly: the node would read TO, DATA or FROMBLOCK", () => {
  const other = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
  assert.ok("error" in checkBatch([callWith({ to: target, TO: other, data: "0x95d89b41" })]));
  assert.ok("error" in checkBatch([callWith({ to: target, DATA: "0x95d89b41" })]));
  const logs = (f: Record<string, unknown>): Call => ({ method: "eth_getLogs", params: [f] });
  assert.ok("error" in checkBatch([logs({ address: target, fromBlock: "0x1", toBlock: "0x2", FROMBLOCK: "0x0" })]));
});

test("eth_call block parameter is a tag or a hex number", () => {
  assert.ok("error" in checkBatch([{ method: "eth_call", params: [{ to: target, data: "0x18160ddd" }, { blockHash: "0x00" }] }]));
  assert.ok("units" in checkBatch([{ method: "eth_call", params: [{ to: target, data: "0x18160ddd" }, "latest"] }]));
});
