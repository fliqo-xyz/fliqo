import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// store.ts imports "server-only", so its prefix is checked as source text: the kv-gateway ACL only allows fliqo:* keys.
test("store keys default to the fliqo: prefix", () => {
  const src = readFileSync(new URL("./store.ts", import.meta.url), "utf8");
  assert.match(src, /KEY_PREFIX = process\.env\.STORE_KEY_PREFIX \|\| "fliqo:"/);
  assert.match(src, /const k = \(key: string\) => `\$\{prefix\}\$\{key\}`/);
});
