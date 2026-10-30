import { test } from "node:test";
import assert from "node:assert/strict";
import { HOODLOCK, LOCKED_TOPIC, activeRows, filterShapeOk, lockFilter, lockIds, lockedShareBps, padTopic, shareBps, walkLogs, windows, type GetLogs, type RawLog } from "./locks";
import { toEventSelector } from "viem";

const T = "0x9a02ee3c610f8cf76b9d42ccfc418fc424761b26";

test("Locked topic is the event selector of the HoodLock source", () => {
  assert.equal(toEventSelector("Locked(uint256,address,address,uint256,uint256)"), LOCKED_TOPIC);
});

test("the filter puts the token in topic3 and nothing else is accepted", () => {
  const f = lockFilter(T);
  assert.equal(f.topics[3], padTopic(T));
  assert.ok(filterShapeOk(f));
  assert.equal(filterShapeOk({ ...f, address: "0x" + "1".repeat(40) }), false);
  assert.equal(filterShapeOk({ ...f, topics: ["0x" + "ab".repeat(32), null, null, padTopic(T)] as never }), false);
});

test("windows walk back in 10M spans to the deploy block", () => {
  const w = windows(HOODLOCK.deployBlock, 101_430_000);
  assert.equal(w[0][1], 101_430_000);
  assert.equal(w[w.length - 1][0], HOODLOCK.deployBlock);
  assert.ok(w.every(([a, b]) => b - a + 1 <= 10_000_000));
});

const log = (id: number): RawLog => ({ address: HOODLOCK.address, topics: [LOCKED_TOPIC, `0x${id.toString(16).padStart(64, "0")}`, padTopic("0x" + "5".repeat(40)), padTopic(T)] as never, data: "0x", blockNumber: "0x1", transactionHash: "0x" as never });

test("walkLogs splits a window the node refuses as too many results", async () => {
  const calls: [number, number][] = [];
  const get: GetLogs = async (f) => {
    calls.push([f.fromBlock, f.toBlock]);
    if (f.toBlock - f.fromBlock > 6_000_000) throw new Error("query returned more than 10000 results");
    return f.fromBlock > 95_000_000 ? [log(700)] : [];
  };
  const r = await walkLogs(get, lockFilter(T), 90_000_001, 101_000_000);
  assert.equal(r.complete, true);
  assert.ok(r.logs.length >= 1);
  assert.ok(calls.length > 2);
});

test("walkLogs is incomplete when the windows stop before the start block", async () => {
  const r = await walkLogs(async () => [], lockFilter(T), 1, 50_000_000, 2);
  assert.equal(r.complete, false);
});

test("lock ids are unique and ascending", () => {
  assert.deepEqual(lockIds([log(703), log(699), log(703)]), [699n, 703n]);
});

test("active rows drop withdrawn and empty locks, mark passed unlock times, and sum the live share", () => {
  const supply = 1_000_000_000n * 10n ** 18n;
  const l = (id: number, amount: bigint, unlock: number, withdrawn = false, token = T) => ({ id: BigInt(id), owner: "0xAb", token, amount: amount * 10n ** 18n, unlockTime: BigInt(unlock), withdrawn });
  const rows = activeRows(
    [l(699, 20_000_000n, 2_000), l(702, 5_000_000n, 500), l(718, 28_000_000n, 3_000, true), l(720, 0n, 3_000), l(721, 1n, 3_000, false, "0x" + "9".repeat(40))],
    T,
    supply,
    1_000,
  );
  assert.deepEqual(rows.map((r) => r.id), ["702", "699"]);
  assert.equal(rows[0].unlocked, true);
  assert.equal(rows[1].unlocked, false);
  assert.equal(rows[1].shareBps, 200);
  assert.equal(lockedShareBps(rows), 200);
  assert.equal(rows[0].proofUrl, "https://hoodlock.tech/proof/lock/702");
});

test("share in basis points", () => {
  assert.equal(shareBps(1n, 10_000n), 1);
  assert.equal(shareBps(1n, 1_000_000n), 0.01);
  assert.equal(shareBps(5n, 0n), null);
  assert.equal(shareBps(5n, null), null);
});
