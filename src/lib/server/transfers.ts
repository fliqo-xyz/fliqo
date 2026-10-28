import "server-only";
import { type Abi } from "viem";
import { serverRpc } from "@/config/brand";
import { ERC20_ABI } from "@/lib/abi";
import { RpcError } from "@/lib/feeds/rpc";
import { readAll } from "@/lib/server/chainread";
import { readCappedResponse } from "@/lib/server/capped";

/*
 * Wallet Activity without an indexer: ERC-20 Transfer logs where the wallet is the sender or the receiver, read
 * straight from Robinhood Chain over the most recent blocks. The chain's RPC answers log queries of at most 30,000
 * blocks (about 50 minutes at ~0.1 s per block), so the scan walks back in windows of WINDOW blocks, at most
 * MAX_WINDOWS of them, and stops once it has MAX_ITEMS transfers. Each query has the exact shape
 * { fromBlock, toBlock, topics: [Transfer, owner] } or [Transfer, null, owner]; nothing else is ever sent.
 * Native ETH transfers do not emit logs; those need the optional indexer (see /api/activity).
 */

export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export const WINDOW = 25_000;
export const MAX_WINDOWS = 4;
const MAX_ITEMS = 40;
const MAX_BYTES = 1_500_000;
/** Log queries go to the chain's own endpoint (the public mirrors refuse them on free plans). */
const LOG_RPC = "https://rpc.mainnet.chain.robinhood.com";

export type TransferItem = { token: string; symbol: string | null; decimals: number | null; from: string; to: string; raw: string; dir: "in" | "out" | "self"; block: number; tx: string; logIndex: number };
export type TransferScan = { owner: string; head: number; fromBlock: number; windows: number; items: TransferItem[]; complete: boolean };

type Log = { address: string; topics: string[]; data: string; blockNumber: string; transactionHash: string; logIndex: string };

const padTopic = (a: string) => `0x${"0".repeat(24)}${a.slice(2).toLowerCase()}`;
const hex = (n: number) => `0x${n.toString(16)}`;

/** The two exact filters a scan sends for one window (sender side, receiver side). */
export function transferFilters(owner: string, from: number, to: number) {
  const o = padTopic(owner);
  return [
    { fromBlock: hex(from), toBlock: hex(to), topics: [TRANSFER_TOPIC, o] },
    { fromBlock: hex(from), toBlock: hex(to), topics: [TRANSFER_TOPIC, null, o] },
  ];
}

async function post(url: string, body: unknown): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store", signal: ctrl.signal });
    const text = await readCappedResponse(res, MAX_BYTES);
    if (text === null) throw new RpcError("Too many transfers in one window.", true);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

async function logsBatch(filters: unknown[]): Promise<Log[][]> {
  const urls = [...new Set([process.env.ROBINHOOD_RPC_URL || "", LOG_RPC, serverRpc()].filter(Boolean))];
  let last: unknown = null;
  for (const url of urls) {
    try {
      const body = (await post(
        url,
        filters.map((f, id) => ({ jsonrpc: "2.0", id, method: "eth_getLogs", params: [f] })),
      )) as { id: number; result?: Log[]; error?: { message?: string } }[];
      if (!Array.isArray(body)) throw new Error("batch refused");
      const out: Log[][] = filters.map(() => []);
      for (const e of body) {
        if (e.error) throw new Error(e.error.message ?? "log query refused");
        if (Array.isArray(e.result)) out[e.id] = e.result;
      }
      return out;
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error("Logs are not available.");
}

/** Recent ERC-20 transfers of `owner` (lowercase 0x address), newest first. */
export async function scanTransfers(owner: string, head: number): Promise<TransferScan> {
  const items: TransferItem[] = [];
  const seen = new Set<string>();
  let to = head;
  let windows = 0;
  let from = head;
  while (windows < MAX_WINDOWS && items.length < MAX_ITEMS && to > 0) {
    from = Math.max(0, to - WINDOW + 1);
    const [sent, got] = await logsBatch(transferFilters(owner, from, to));
    windows++;
    for (const l of [...sent, ...got]) {
      if (!Array.isArray(l.topics) || l.topics.length !== 3 || l.topics[0] !== TRANSFER_TOPIC) continue; // ERC-721 has 4 topics
      const key = `${l.transactionHash}:${l.logIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const f = `0x${l.topics[1].slice(26)}`.toLowerCase();
      const t = `0x${l.topics[2].slice(26)}`.toLowerCase();
      const raw = /^0x[0-9a-fA-F]{1,64}$/.test(l.data) ? BigInt(l.data).toString() : "0";
      items.push({ token: l.address.toLowerCase(), symbol: null, decimals: null, from: f, to: t, raw, dir: f === t ? "self" : f === owner ? "out" : "in", block: Number(BigInt(l.blockNumber)), tx: l.transactionHash.toLowerCase(), logIndex: Number(BigInt(l.logIndex)) });
    }
    to = from - 1;
  }
  items.sort((a, b) => b.block - a.block || b.logIndex - a.logIndex);
  const kept = items.slice(0, MAX_ITEMS);
  const tokens = [...new Set(kept.map((i) => i.token))].slice(0, 15);
  const meta = await readAll(tokens.flatMap((t) => [
    { to: t, abi: ERC20_ABI as Abi, fn: "symbol" },
    { to: t, abi: ERC20_ABI as Abi, fn: "decimals" },
  ]));
  const byToken = new Map(tokens.map((t, i) => [t, { symbol: typeof meta[i * 2] === "string" ? (meta[i * 2] as string).replace(/[^\x20-\x7e]/g, "").slice(0, 16) : null, decimals: meta[i * 2 + 1] === null ? null : Number(meta[i * 2 + 1]) }]));
  for (const i of kept) Object.assign(i, byToken.get(i.token) ?? {});
  return { owner, head, fromBlock: from, windows, items: kept, complete: items.length < MAX_ITEMS };
}
