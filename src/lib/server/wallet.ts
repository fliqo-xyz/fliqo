import "server-only";
import { type Abi } from "viem";
import { KNOWN_SPENDERS, UNISWAP } from "@/config/dex";
import { ALLOWANCE_ABI, ERC20_ABI, PERMIT2_ABI } from "@/lib/abi";
import { NATIVE, type TokenRow } from "@/lib/market";
import { rpcBatch } from "@/lib/feeds/rpc";
import { readAll, type Read } from "@/lib/server/chainread";
import { marketBoard } from "@/lib/server/market";

/*
 * A wallet as Robinhood Chain sees it: ETH balance, nonces, balances of the tokens the market lists know (busiest
 * tokens on the market lists), valued at their pool prices, and the approvals those tokens carry towards the
 * Uniswap contracts (plain ERC-20 allowances and Permit2's allowance for the Universal Router). Reads only.
 */

export type Holding = { address: string; symbol: string; name: string; logo: string | null; kind: TokenRow["kind"]; decimals: number; raw: string; amount: number; priceUsd: number | null; valueUsd: number | null };
export type Approval = { token: string; symbol: string; decimals: number; spender: string; label: string; via: "erc20" | "permit2"; raw: string; unlimited: boolean; expiration: number | null };
export type WalletView = {
  owner: string;
  block: number | null;
  eth: { raw: string; amount: number; priceUsd: number | null; valueUsd: number | null };
  nonce: { latest: number | null; pending: number | null };
  holdings: Holding[];
  approvals: Approval[];
  coverage: { tokensChecked: number };
  totalUsd: number | null;
};

const MAX_TOKENS = 120;
const MAX_APPROVAL_TOKENS = 30;
const UNLIMITED = 2n ** 255n;
const P2_UNLIMITED = 2n ** 159n;

export async function readWallet(owner: string): Promise<WalletView> {
  const board = await marketBoard().catch(() => null);
  const seen = new Set<string>();
  const list: TokenRow[] = [];
  for (const t of board?.tokens ?? []) {
    if (t.address === NATIVE || seen.has(t.address)) continue;
    seen.add(t.address);
    list.push(t);
    if (list.length >= MAX_TOKENS) break;
  }
  const eth = board?.tokens.find((t) => t.address === NATIVE)?.priceUsd ?? null;
  const head = await rpcBatch<string>([
    { method: "eth_getBalance", params: [owner, "latest"] },
    { method: "eth_getTransactionCount", params: [owner, "latest"] },
    { method: "eth_getTransactionCount", params: [owner, "pending"] },
    { method: "eth_blockNumber", params: [] },
  ]);
  const hex = (v: unknown) => (typeof v === "string" && /^0x[0-9a-f]*$/i.test(v) ? BigInt(v) : null);
  const reads: Read[] = list.flatMap((t) => [
    { to: t.address, abi: ERC20_ABI as Abi, fn: "balanceOf", args: [owner] },
    { to: t.address, abi: ERC20_ABI as Abi, fn: "decimals" },
  ]);
  const r = await readAll(reads);
  const holdings: Holding[] = [];
  list.forEach((t, i) => {
    const bal = r[i * 2];
    const dec = r[i * 2 + 1];
    if (typeof bal !== "bigint" || bal === 0n || dec === null) return;
    const decimals = Number(dec);
    if (!Number.isInteger(decimals) || decimals > 36) return;
    const amount = Number(bal) / 10 ** decimals;
    holdings.push({ address: t.address, symbol: t.symbol, name: t.name, logo: t.logo, kind: t.kind, decimals, raw: bal.toString(), amount, priceUsd: t.priceUsd, valueUsd: t.priceUsd === null ? null : amount * t.priceUsd });
  });
  holdings.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));

  const targets = holdings.slice(0, MAX_APPROVAL_TOKENS);
  const aReads: Read[] = targets.flatMap((h) => [
    ...KNOWN_SPENDERS.map((s) => ({ to: h.address, abi: ALLOWANCE_ABI as Abi, fn: "allowance", args: [owner, s.address] })),
    { to: UNISWAP.permit2, abi: PERMIT2_ABI as Abi, fn: "allowance", args: [owner, h.address, UNISWAP.universalRouter] },
  ]);
  const ar = await readAll(aReads);
  const approvals: Approval[] = [];
  const per = KNOWN_SPENDERS.length + 1;
  targets.forEach((h, i) => {
    KNOWN_SPENDERS.forEach((s, k) => {
      const v = ar[i * per + k];
      if (typeof v === "bigint" && v > 0n) approvals.push({ token: h.address, symbol: h.symbol, decimals: h.decimals, spender: s.address.toLowerCase(), label: s.label, via: "erc20", raw: v.toString(), unlimited: v >= UNLIMITED, expiration: null });
    });
    const p = ar[i * per + KNOWN_SPENDERS.length] as readonly [bigint, number, number] | null;
    if (p && p[0] > 0n) approvals.push({ token: h.address, symbol: h.symbol, decimals: h.decimals, spender: UNISWAP.universalRouter.toLowerCase(), label: "Universal Router via Permit2", via: "permit2", raw: p[0].toString(), unlimited: p[0] >= P2_UNLIMITED, expiration: Number(p[1]) });
  });

  const ethRaw = hex(head[0]) ?? 0n;
  const ethAmount = Number(ethRaw) / 1e18;
  const ethValue = eth === null ? null : ethAmount * eth;
  const valued = holdings.filter((h) => h.valueUsd !== null);
  return {
    owner,
    block: hex(head[3]) === null ? null : Number(hex(head[3])),
    eth: { raw: ethRaw.toString(), amount: ethAmount, priceUsd: eth, valueUsd: ethValue },
    nonce: { latest: hex(head[1]) === null ? null : Number(hex(head[1])), pending: hex(head[2]) === null ? null : Number(hex(head[2])) },
    holdings,
    approvals,
    coverage: { tokensChecked: list.length },
    totalUsd: ethValue === null && !valued.length ? null : (ethValue ?? 0) + valued.reduce((s, h) => s + (h.valueUsd ?? 0), 0),
  };
}
