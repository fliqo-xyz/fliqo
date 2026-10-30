import { parseAbi, type Hex } from "viem";

/*
 * HoodLock token locks: the locker contract, the log filters the server issues, how a log range is walked, and the
 * lock rows the pages show. HoodLock (contract RobinhoodLocker, verified on Sourcify for chain 4663) holds plain
 * ERC-20 balances until an unlock time; only the lock owner withdraws, after that time. It can hold a token's own
 * supply or a Uniswap v2 style LP token. Liquidity in Uniswap v3 (an NFT position), v4 (an entry inside the pool
 * manager) or a Pons curve (the curve contract itself) is not an ERC-20 balance, so a HoodLock lock cannot cover it.
 */

export const HOODLOCK = {
  name: "HoodLock",
  address: "0xD0f7d8c6e9f6D80c297bEbe4F7fD1B9C8125C32F",
  deployBlock: 4_591_195,
  site: "https://hoodlock.tech",
  proofUrl: (id: number | string) => `https://hoodlock.tech/proof/lock/${id}`,
} as const;

/** Multicall3 (canonical address, code present on chain 4663). */
export const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";

export const LOCKER_ABI = parseAbi([
  "struct Lock { address owner; address token; uint256 amount; uint256 unlockTime; bool withdrawn; }",
  "function getLock(uint256 id) view returns (Lock)",
  "function nextLockId() view returns (uint256)",
  "event Locked(uint256 indexed id, address indexed owner, address indexed token, uint256 amount, uint256 unlockTime)",
]);

export const MULTICALL3_ABI = parseAbi([
  "struct Call3 { address target; bool allowFailure; bytes callData; }",
  "struct Result { bool success; bytes returnData; }",
  "function aggregate3(Call3[] calls) payable returns (Result[] returnData)",
]);

/** keccak256("Locked(uint256,address,address,uint256,uint256)") */
export const LOCKED_TOPIC = "0x1cb39d6ecc8f823fa6183785ee795ddcb2873e92effbff9b9a377ef761035676" as Hex;

// ---------- log walking (the official RPC answers one query over at most 10,000,000 blocks and 10,000 logs) ----------

export const WINDOW = 10_000_000;
export const MAX_WINDOWS = 12;
export const MAX_SPLIT_DEPTH = 6;
export const MAX_EVENTS = 500;

export type LogFilter = { address: string; topics: (Hex | null)[] };
export type RawLog = { address: string; topics: Hex[]; data: Hex; blockNumber: Hex; transactionHash: Hex };
export type GetLogs = (f: LogFilter & { fromBlock: number; toBlock: number }) => Promise<RawLog[]>;

export const padTopic = (address: string) => `0x${address.slice(2).toLowerCase().padStart(64, "0")}` as Hex;

/** The one filter shape the server issues: the locker, the Locked topic, and the locked token as topic3. */
export function lockFilter(token: string): LogFilter {
  return { address: HOODLOCK.address, topics: [LOCKED_TOPIC, null, null, padTopic(token)] };
}

export function filterShapeOk(f: LogFilter): boolean {
  if (f.address !== HOODLOCK.address || f.topics[0] !== LOCKED_TOPIC) return false;
  return f.topics.slice(1).every((t) => t === null || /^0x0{24}[0-9a-f]{40}$/.test(t));
}

/** Windows [from, to] walking back from `latest` to `start`, newest first, at most `max`. */
export function windows(start: number, latest: number, span = WINDOW, max = MAX_WINDOWS): [number, number][] {
  const out: [number, number][] = [];
  let to = latest;
  while (to >= start && out.length < max) {
    const from = Math.max(start, to - span + 1);
    out.push([from, to]);
    to = from - 1;
  }
  return out;
}

const tooMany = (e: unknown) => e instanceof Error && /exceed|limit|too many|more than/i.test(e.message);

/** Logs of one window; a window over the node's match limit is split in half, down to MAX_SPLIT_DEPTH. */
export async function logsInWindow(get: GetLogs, f: LogFilter, from: number, to: number, depth = 0): Promise<{ logs: RawLog[]; partial: boolean }> {
  try {
    return { logs: await get({ ...f, fromBlock: from, toBlock: to }), partial: false };
  } catch (e) {
    if (!tooMany(e) || depth >= MAX_SPLIT_DEPTH || to <= from) throw e;
    const mid = Math.floor((from + to) / 2);
    const hi = await logsInWindow(get, f, mid + 1, to, depth + 1);
    if (hi.logs.length >= MAX_EVENTS) return { logs: hi.logs, partial: true };
    const lo = await logsInWindow(get, f, from, mid, depth + 1);
    return { logs: [...hi.logs, ...lo.logs], partial: hi.partial || lo.partial };
  }
}

/**
 * Walks windows newest first (`parallel` at a time) until MAX_EVENTS logs are found or the start block is reached.
 * `complete` is false when the walk stopped early or a window had to be cut short.
 */
export async function walkLogs(get: GetLogs, f: LogFilter, start: number, latest: number, maxWindows = MAX_WINDOWS, parallel = 4): Promise<{ logs: RawLog[]; complete: boolean }> {
  if (!filterShapeOk(f)) throw new Error("Refused log filter shape.");
  const ws = windows(start, latest, WINDOW, maxWindows);
  const logs: RawLog[] = [];
  // Complete only when the windows reach the start block, no window was cut short and the cap was not hit.
  let complete = ws.length > 0 && ws[ws.length - 1][0] <= start;
  for (let i = 0; i < ws.length; i += parallel) {
    const group = await Promise.all(ws.slice(i, i + parallel).map(([from, to]) => logsInWindow(get, f, from, to)));
    for (const r of group) {
      logs.push(...r.logs);
      if (r.partial) complete = false;
    }
    if (logs.length >= MAX_EVENTS && i + parallel < ws.length) {
      complete = false;
      break;
    }
  }
  if (logs.length > MAX_EVENTS) complete = false;
  return { logs: logs.slice(0, MAX_EVENTS), complete };
}

/** Lock ids named by Locked logs (topic1), unique, ascending. */
export function lockIds(logs: RawLog[]): bigint[] {
  return [...new Set(logs.filter((l) => l.topics[0] === LOCKED_TOPIC && l.topics[1]).map((l) => BigInt(l.topics[1])))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

// ---------- rows ----------

export type LockOnChain = { id: bigint; owner: string; token: string; amount: bigint; unlockTime: bigint; withdrawn: boolean };

export type LockRow = { id: string; owner: string; amount: string; unlockTime: number; unlocked: boolean; shareBps: number | null; proofUrl: string };

/** Share of `supply` in basis points with two decimals kept (0.01% = 1), or null without a supply. */
export function shareBps(amount: bigint, supply: bigint | null): number | null {
  if (!supply || supply <= 0n) return null;
  return Number((amount * 1_000_000n) / supply) / 100;
}

/** Locks that still hold tokens (not withdrawn, amount above zero) for `token`, soonest unlock first. */
export function activeRows(locks: LockOnChain[], token: string, supply: bigint | null, nowSec: number): LockRow[] {
  const t = token.toLowerCase();
  return locks
    .filter((l) => l.token.toLowerCase() === t && !l.withdrawn && l.amount > 0n)
    .sort((a, b) => (a.unlockTime < b.unlockTime ? -1 : a.unlockTime > b.unlockTime ? 1 : 0))
    .map((l) => ({
      id: l.id.toString(),
      owner: l.owner.toLowerCase(),
      amount: l.amount.toString(),
      unlockTime: Number(l.unlockTime),
      unlocked: Number(l.unlockTime) <= nowSec,
      shareBps: shareBps(l.amount, supply),
      proofUrl: HOODLOCK.proofUrl(l.id.toString()),
    }));
}

/** Sum of the shares of the locks still before their unlock time. */
export function lockedShareBps(rows: LockRow[]): number | null {
  const live = rows.filter((r) => !r.unlocked);
  if (live.some((r) => r.shareBps === null)) return null;
  return Math.round(live.reduce((s, r) => s + (r.shareBps ?? 0), 0) * 100) / 100;
}

export type LockTarget = {
  /** What was looked up: the token's own supply, or the LP token of a v2 style pair. */
  kind: "token" | "lp";
  address: string;
  label: string;
  decimals: number | null;
  totalSupply: string | null;
  locks: LockRow[];
  /** Share of the supply in locks that have not reached their unlock time. */
  lockedShareBps: number | null;
};

export type LockAnswer = {
  token: string;
  locker: string;
  /** "logs": Locked logs filtered by token, then each lock re-read. "scan": every lock id read (logs unavailable). */
  method: "logs" | "scan";
  complete: boolean;
  targets: LockTarget[];
  /** Plain statements about pools whose liquidity a HoodLock ERC-20 lock cannot cover. */
  notes: string[];
  block: number;
  at: number;
};
