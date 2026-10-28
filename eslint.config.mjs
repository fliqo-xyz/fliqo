import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Brand art is served as pre-sized .webp; next/image renders blank at
    // icon sizes, so plain <img> is used on purpose.
    rules: { "@next/next/no-img-element": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Local fork-test build and the vendored Solidity libraries / build output.
    ".next-local/**",
    "contracts/lib/**",
    "contracts/out/**",
    "contracts/cache/**",
    // Local end-to-end builds, the bundled browser prover, circuit output and keeper dependencies.
    ".next-e2e*/**",
    "public/zk/**",
    "circuits/**/target/**",
    "keeper/node_modules/**",
  ]),
]);

export default eslintConfig;
