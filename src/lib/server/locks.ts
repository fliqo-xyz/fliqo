import "server-only";
import { decodeFunctionResult, encodeFunctionData, type Abi, type Hex } from "viem";
import { ERC20_ABI } from "@/lib/abi";
import { rpc } from "@/lib/feeds/rpc";
import { hexBlock, latestBlock, readAll } from "@/lib/server/chainread";
import type { PoolRow } from "@/lib/market";
import {
  HOODLOCK,
  LOCKER_ABI,
  MULTICALL3,
  MULTICALL3_ABI,
  activeRows,
  lockFilter,
  lockIds,
  lockedShareBps,
  walkLogs,
  type GetLogs,
  type LockAnswer,
  type LockOnChain,
  type LockTarget,
  type RawLog,
} from "@/lib/locks";

/*
 * HoodLock lock status of a token: its own supply and the LP tokens of its Uniswap v2 style pairs. Lock ids come from
 * the locker's Locked logs filtered on the locked token (topic3), walked in 10M-block windows back to the locker's
 * deployment; each lock is then re-read with getLock through Multicall3, so withdrawn locks drop out. When no
 * endpoint answers log queries over that span, every lock id up to nextLockId() is read instead (the locker holds a
 * few hundred locks), and the answer says which way was used.
 */

const MAX_SCAN = 5_000;
const CHUNK = 200;
const MULTI_GAS = 12_000_000;

const getLogs: GetLogs = (f) => rpc<RawLog[]>("eth_getLogs", [{ address: f.address, topics: f.topics, fromBlock: hexBlock(f.fromBlock), toBlock: hexBlock(f.toBlock) }]);

/** getLock for each id, through Multicall3 in chunks; ids whose read fails are left out. */
async function readLocks(ids: bigint[], tag: string): Promise<LockOnChain[]> {
  const out: LockOnChain[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const data = encodeFunctionData({
      abi: MULTICALL3_ABI,
      functionName: "aggregate3",
      args: [chunk.map((id) => ({ target: HOODLOCK.address as Hex, allowFailure: true, callData: encodeFunctionData({ abi: LOCKER_ABI, functionName: "getLock", args: [id] }) }))],
    });
    const raw = await rpc<string>("eth_call", [{ to: MULTICALL3, data, gas: `0x${MULTI_GAS.toString(16)}` }, tag]);
    const results = decodeFunctionResult({ abi: MULTICALL3_ABI, functionName: "aggregate3", data: raw as Hex }) as readonly { success: boolean; returnData: Hex }[];
    results.forEach((r, k) => {
      if (!r.success) return;
      try {
        const l = decodeFunctionResult({ abi: LOCKER_ABI, functionName: "getLock", data: r.returnData }) as { owner: string; token: string; amount: bigint; unlockTime: bigint; withdrawn: boolean };
        out.push({ id: chunk[k], owner: l.owner, token: l.token, amount: l.amount, unlockTime: l.unlockTime, withdrawn: l.withdrawn });
      } catch {
        // not a lock
      }
    });
  }
  return out;
}

/** Lock status of `token` and its v2 LP tokens (from `pools`, GeckoTerminal's index for the token). */
export async function lockStatus(token: string, pools: PoolRow[], symbol: string): Promise<LockAnswer> {
  const t = token.toLowerCase();
  const block = await latestBlock();
  const tag = hexBlock(block);
  const v2 = pools.filter((p) => p.kind === 2 && /^0x[0-9a-f]{40}$/.test(p.address)).slice(0, 3);
  const targets = [{ kind: "token" as const, address: t, label: `$${symbol} supply` }, ...v2.map((p) => ({ kind: "lp" as const, address: p.address, label: `${p.name} LP (${p.venueLabel})` }))];

  let method: LockAnswer["method"] = "logs";
  let complete = true;
  let locks: LockOnChain[] = [];
  try {
    const walks = await Promise.all(targets.map((x) => walkLogs(getLogs, lockFilter(x.address), HOODLOCK.deployBlock, block)));
    complete = walks.every((w) => w.complete);
    locks = await readLocks(lockIds(walks.flatMap((w) => w.logs)), tag);
  } catch {
    // No endpoint answered the log windows: read every lock id instead.
    method = "scan";
    const [next] = await readAll([{ to: HOODLOCK.address, abi: LOCKER_ABI as Abi, fn: "nextLockId" }], tag);
    if (typeof next !== "bigint") throw new Error("The HoodLock locker could not be read right now.");
    const n = next > BigInt(MAX_SCAN) ? BigInt(MAX_SCAN) : next;
    complete = next <= BigInt(MAX_SCAN);
    locks = await readLocks(Array.from({ length: Number(n) + 1 }, (_, i) => BigInt(i)), tag);
  }

  const facts = await readAll(targets.flatMap((x) => [{ to: x.address, abi: ERC20_ABI as Abi, fn: "totalSupply" }, { to: x.address, abi: ERC20_ABI as Abi, fn: "decimals" }]), tag);
  const now = Math.floor(Date.now() / 1000);
  const out: LockTarget[] = targets.map((x, i) => {
    const supply = typeof facts[i * 2] === "bigint" ? (facts[i * 2] as bigint) : null;
    const decimals = facts[i * 2 + 1] === null || facts[i * 2 + 1] === undefined ? null : Number(facts[i * 2 + 1]);
    const rows = activeRows(locks, x.address, supply, now);
    return { ...x, decimals, totalSupply: supply === null ? null : supply.toString(), locks: rows, lockedShareBps: rows.length ? lockedShareBps(rows) : 0 };
  });

  const notes: string[] = [];
  const kinds = new Set(pools.map((p) => (p.venue === "pons-v2" && /^0x[0-9a-f]{40}$/.test(p.address) ? "curve" : p.kind)));
  if (kinds.has(4)) notes.push("Uniswap v4 pools have no LP token: liquidity is an entry inside the pool manager, so a HoodLock lock cannot hold it and Fliqo cannot read a lock for it. Who can withdraw that liquidity is not checked here.");
  if (kinds.has(3)) notes.push("Uniswap v3 style pools hold liquidity as NFT positions, not as an ERC-20 LP token, so a HoodLock lock cannot hold them; NFT position lockers are not checked here.");
  if (kinds.has("curve")) notes.push("While a coin is on its Pons curve, the curve contract itself holds the liquidity; there is no LP token to lock.");
  if (!v2.length) notes.push("No Uniswap v2 style pair of this token is listed, so only locks of the token's own supply are looked up.");
  return { token: t, locker: HOODLOCK.address, method, complete, targets: out, notes, block, at: Date.now() };
}
