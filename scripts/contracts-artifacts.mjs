// Collects the compiled Fliqo contract into one generated file used by the /deploy page, the app and
// scripts/verify-deployment.mjs:
//   src/lib/contracts/artifacts.json  (abi, creation + runtime bytecode, named immutable ranges)
// Run after a forge build:
//   (cd contracts && ./setup.sh && forge build --force) && node scripts/contracts-artifacts.mjs
// With --check it only compares the committed file against a fresh forge build.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const OUT = new URL("../contracts/out/", import.meta.url);
const TARGET = new URL("../src/lib/contracts/artifacts.json", import.meta.url);
// Deployed once by the owner; it does not depend on the token.
const NAMES = ["FliqoWatchBook"];

/** Immutable byte ranges with the name of the variable they hold (from the AST). */
function namedImmutables(a) {
  const refs = a.deployedBytecode.immutableReferences ?? {};
  const names = {};
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (n.nodeType === "VariableDeclaration" && refs[String(n.id)]) names[n.id] = n.name;
    for (const v of Object.values(n)) walk(v);
  };
  walk(a.ast);
  return Object.entries(refs).flatMap(([id, list]) => {
    if (!names[id]) throw new Error(`no name for immutable ${id} (build with ast = true)`);
    return list.map((r) => ({ name: names[id], start: r.start, length: r.length }));
  });
}

const contracts = {};
for (const name of NAMES) {
  const a = JSON.parse(readFileSync(new URL(`${name}.sol/${name}.json`, OUT), "utf8"));
  const creation = a.bytecode.object.toLowerCase();
  const runtime = a.deployedBytecode.object.toLowerCase();
  if (!creation.startsWith("0x") || creation.length < 10) throw new Error(`${name}: no bytecode (build first)`);
  if (Object.keys(a.bytecode.linkReferences ?? {}).length) throw new Error(`${name}: unexpected library links`);
  contracts[name] = { abi: a.abi, creation, runtime, immutables: namedImmutables(a), sha256: createHash("sha256").update(creation).digest("hex") };
}
const out = {
  generatedBy: "scripts/contracts-artifacts.mjs",
  compiler: "solc 0.8.28, optimizer 200 runs, evm paris, no via-ir, no metadata hash",
  deployOrder: ["FliqoWatchBook"],
  constructorArgs: { FliqoWatchBook: [] },
  contracts,
};
const text = JSON.stringify(out) + "\n";
if (process.argv.includes("--check")) {
  let same = false;
  try {
    same = readFileSync(TARGET, "utf8") === text;
  } catch {
    // missing file: not the same
  }
  console.log(same ? "artifacts.json matches this forge build" : "artifacts.json DIFFERS from this forge build");
  process.exit(same ? 0 : 1);
}
writeFileSync(TARGET, text);
for (const [n, c] of Object.entries(contracts)) console.log(`${n}: ${(c.creation.length - 2) / 2} bytes, sha256 ${c.sha256.slice(0, 16)}…, immutables ${[...new Set(c.immutables.map((i) => i.name))].join(", ") || "none"}`);
