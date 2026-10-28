import { test } from "node:test";
import assert from "node:assert/strict";
import { PINNED_KEYS, spend } from "./ratelimit";

test("untracked aggregates are budgeted per overflow shard: one flooding block cannot starve the others", async () => {
  // Fill every pinned slot with distinct /24 aggregates.
  for (let i = 0; i < PINNED_KEYS; i++) {
    assert.equal(await spend(null, "t", `n4:10.${i >> 8}.${i & 255}.1`, 1, 1, 60, { aggregate: true }), true);
  }
  // One untracked /24 rotating leaves: each leaf is within its own limit, but the block stops at the
  // aggregate budget (max * 16) of its overflow shard instead of being skipped.
  const flood: boolean[] = [];
  for (let i = 0; i < 40; i++) flood.push(await spend(null, "t", `n4:11.0.0.${i + 1}`, 1, 1, 60, { aggregate: true }));
  assert.equal(flood.filter(Boolean).length, 16);
  // Other untracked blocks mostly land in other shards and still get through.
  let others = 0;
  for (let i = 1; i <= 32; i++) if (await spend(null, "t", `n4:12.${i}.0.1`, 1, 1, 60, { aggregate: true })) others++;
  assert.ok(others >= 24, `only ${others}/32 other blocks passed`);
});

test("all overflow shards together stay under one total ceiling", async () => {
  // The pinned map is already full from the test above. Spread over many fresh blocks, one request each:
  // every shard stays under its own budget, so only the total (16 * 8 = 128) can stop this.
  let served = 0;
  for (let i = 0; i < 1000; i++) if (await spend(null, "t2", `n4:13.${i >> 8}.${i & 255}.1`, 1, 1, 60, { aggregate: true })) served++;
  assert.equal(served, 128);
});

test("refused requests from one flooding block do not use up the shared total", async () => {
  // Pinned map still full. One block floods far past its shard budget...
  for (let i = 0; i < 500; i++) await spend(null, "t3", `n4:14.0.0.${(i % 250) + 1}`, 1, 1, 60, { aggregate: true });
  // ...and fresh blocks elsewhere are still served.
  let others = 0;
  for (let i = 0; i < 32; i++) if (await spend(null, "t3", `n4:15.${i}.0.1`, 1, 1, 60, { aggregate: true })) others++;
  assert.ok(others >= 24, `only ${others}/32 other blocks served`);
});
