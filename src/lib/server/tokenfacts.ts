import "server-only";
import { type Abi } from "viem";
import { STOCK_BEACON } from "@/config/dex";
import { stockOf } from "@/config/stocks";
import { ERC20_ABI, OWNER_ABI } from "@/lib/abi";
import { rpcBatch } from "@/lib/feeds/rpc";
import { callOf, decodeRead, type Read } from "@/lib/server/chainread";
import { scanCode, type TokenFacts } from "@/lib/tokencheck";

/*
 * Facts about one token, read from Robinhood Chain: ERC-20 fields, contract code size, the owner() answer, the
 * EIP-1967 proxy slots, function selectors found in the code (and in the implementation behind a proxy), and
 * whether it is an official Robinhood Stock Token (beacon proxy + name, see config/stocks.ts). Every eth_call is
 * gas-capped (chainread VIEW_GAS); the caller validates the address and charges the budgets first.
 */

const SLOT_IMPL = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const SLOT_ADMIN = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";
const SLOT_BEACON = "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50";
const ZERO = /^0x0{40}$/;

const slotAddress = (word: unknown) => {
  if (typeof word !== "string" || word.length < 42) return null;
  const a = `0x${word.slice(-40)}`.toLowerCase();
  return ZERO.test(a) ? null : a;
};

export async function readTokenFacts(address: string): Promise<TokenFacts> {
  const a = address.toLowerCase();
  const reads: Read[] = [
    { to: a, abi: ERC20_ABI as Abi, fn: "name" },
    { to: a, abi: ERC20_ABI as Abi, fn: "symbol" },
    { to: a, abi: ERC20_ABI as Abi, fn: "decimals" },
    { to: a, abi: ERC20_ABI as Abi, fn: "totalSupply" },
    { to: a, abi: OWNER_ABI as Abi, fn: "owner", gas: 60_000 },
  ];
  const head = await rpcBatch<unknown>([
    { method: "eth_getCode", params: [a, "latest"] },
    { method: "eth_getStorageAt", params: [a, SLOT_IMPL, "latest"] },
    { method: "eth_getStorageAt", params: [a, SLOT_ADMIN, "latest"] },
    { method: "eth_getStorageAt", params: [a, SLOT_BEACON, "latest"] },
    { method: "eth_blockNumber", params: [] },
    ...reads.map((r) => callOf(r, "latest")),
  ]);
  const code = typeof head[0] === "string" ? head[0] : "0x";
  const impl = slotAddress(head[1]);
  const admin = slotAddress(head[2]);
  const beacon = slotAddress(head[3]);
  const block = typeof head[4] === "string" ? Number(BigInt(head[4])) : null;
  const v = reads.map((r, i) => decodeRead<unknown>(r, head[5 + i]));
  // The code behind a proxy is where the selectors live: read the implementation once (one hop, no loops).
  let implCode: string | null = null;
  if (impl) {
    const r = await rpcBatch<string>([{ method: "eth_getCode", params: [impl, "latest"] }]).catch(() => [null]);
    implCode = typeof r[0] === "string" ? r[0] : null;
  }
  const scan = scanCode(implCode && implCode.length > 2 ? implCode : code);
  const stock = stockOf(a);
  const official = Boolean(stock) && code.toLowerCase().includes(STOCK_BEACON.slice(2));
  const owner = typeof v[4] === "string" ? (v[4] as string).toLowerCase() : null;
  return {
    address: a,
    block,
    codeSize: code.length > 2 ? (code.length - 2) / 2 : 0,
    name: typeof v[0] === "string" ? (v[0] as string).slice(0, 80) : null,
    symbol: typeof v[1] === "string" ? (v[1] as string).slice(0, 24) : null,
    decimals: v[2] === null ? null : Number(v[2]),
    totalSupply: typeof v[3] === "bigint" ? (v[3] as bigint).toString() : null,
    owner: owner && !ZERO.test(owner) ? owner : owner ? "renounced" : null,
    proxy: impl || beacon ? { implementation: impl, admin, beacon } : null,
    selectors: scan,
    stockToken: official && stock ? { symbol: stock.symbol, name: stock.name, etf: stock.etf } : null,
  };
}
