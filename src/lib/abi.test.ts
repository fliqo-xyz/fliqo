import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toFunctionSignature, toEventSignature, type AbiFunction, type AbiEvent } from "viem";
import { WATCH_ABI } from "./abi";

// The hand-written ABI must describe exactly the compiled FliqoWatchBook (src/lib/contracts/artifacts.json).
test("WATCH_ABI matches the compiled contract", () => {
  const art = JSON.parse(readFileSync(new URL("./contracts/artifacts.json", import.meta.url), "utf8"));
  const compiled = art.contracts.FliqoWatchBook.abi as (AbiFunction | AbiEvent | { type: string; name: string })[];
  const sig = (x: (typeof compiled)[number]) =>
    x.type === "function" ? toFunctionSignature(x as AbiFunction) : x.type === "event" ? toEventSignature(x as AbiEvent) : `${x.type}:${x.name}`;
  const a = new Set(compiled.map(sig));
  const b = new Set((WATCH_ABI as unknown as (typeof compiled)[number][]).map(sig));
  assert.deepEqual([...b].sort(), [...a].sort());
});
