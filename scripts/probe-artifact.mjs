// Writes the runtime code and ABI of the sell probe (contracts/src/FliqoSellProbe.sol) to
// src/lib/contracts/probe.json. The probe is never deployed: the server places this code at a throwaway address for
// one eth_call (a state override). Run after a forge build:
//   (cd contracts && ./setup.sh && forge build --force) && node scripts/probe-artifact.mjs
// With --check it only compares the committed file against the current build output.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const SRC = new URL("../contracts/out/FliqoSellProbe.sol/FliqoSellProbe.json", import.meta.url);
const TARGET = new URL("../src/lib/contracts/probe.json", import.meta.url);
const a = JSON.parse(readFileSync(SRC, "utf8"));
const runtime = a.deployedBytecode.object.toLowerCase();
if (!runtime.startsWith("0x") || runtime.length < 10) throw new Error("no runtime code (build first)");
if (Object.keys(a.deployedBytecode.immutableReferences ?? {}).length) throw new Error("the probe must not use immutables");
const out = {
  generatedBy: "scripts/probe-artifact.mjs",
  compiler: "solc 0.8.28, optimizer 200 runs, evm paris, no via-ir, no metadata hash",
  abi: a.abi.filter((x) => x.type === "function" || x.type === "error"),
  runtime,
  sha256: createHash("sha256").update(runtime).digest("hex"),
};
const text = JSON.stringify(out) + "\n";
if (process.argv.includes("--check")) {
  const same = readFileSync(TARGET, "utf8") === text;
  console.log(same ? "probe.json matches the build" : "probe.json differs from the build");
  process.exit(same ? 0 : 1);
}
writeFileSync(TARGET, text);
console.log(`wrote ${TARGET.pathname} (${(runtime.length - 2) / 2} bytes of runtime code)`);
