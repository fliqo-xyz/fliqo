import "server-only";
import { decodeFunctionResult, encodeFunctionData, type Abi } from "viem";
import { rpc, rpcBatch } from "@/lib/feeds/rpc";

/* Typed eth_call helpers for server code: one batch, each read decoded on its own (null when it fails). */

export type Read = { to: string; abi: Abi; fn: string; args?: readonly unknown[]; from?: string; gas?: number };

/** Gas given to a plain view read (name, balance, allowance…). Any call into a contract a visitor chose is capped. */
export const VIEW_GAS = 120_000;
/** Gas given to a quoter simulation (a swap through one or two pools, hooks included). */
export const QUOTE_GAS = 3_000_000;
const hexGas = (n: number) => `0x${n.toString(16)}`;

export const callOf = (r: Read, block: string) => ({
  method: "eth_call",
  params: [{ to: r.to, gas: hexGas(r.gas ?? VIEW_GAS), data: encodeFunctionData({ abi: r.abi, functionName: r.fn, args: r.args ?? [] } as never), ...(r.from ? { from: r.from } : {}) }, block],
});

export function decodeRead<T>(r: Read, raw: unknown): T | null {
  if (typeof raw !== "string" || raw.length < 4) return null;
  try {
    return decodeFunctionResult({ abi: r.abi, functionName: r.fn, data: raw as `0x${string}` } as never) as T;
  } catch {
    return null;
  }
}

/** Reads in batches of 20 at `block` ("latest" or a hex number). Failed or undecodable reads are null. */
export async function readAll(reads: Read[], block = "latest"): Promise<unknown[]> {
  const out: unknown[] = [];
  for (let i = 0; i < reads.length; i += 20) {
    const chunk = reads.slice(i, i + 20);
    const raw = await rpcBatch<string>(chunk.map((r) => callOf(r, block))).catch(() => chunk.map(() => null));
    chunk.forEach((r, k) => out.push(decodeRead(r, raw[k])));
  }
  return out;
}

/** Raw eth_call results (hex or null) in batches of 20. Each call is gas-capped (VIEW_GAS unless it names its own). */
export async function rawAll(calls: { to: string; data: string; gas?: number }[], block = "latest"): Promise<(string | null)[]> {
  const out: (string | null)[] = [];
  for (let i = 0; i < calls.length; i += 20) {
    const chunk = calls.slice(i, i + 20);
    const raw = await rpcBatch<string>(chunk.map((c) => ({ method: "eth_call", params: [{ to: c.to, data: c.data, gas: hexGas(c.gas ?? VIEW_GAS) }, block] }))).catch(() => chunk.map(() => null));
    chunk.forEach((_, k) => out.push(typeof raw[k] === "string" && (raw[k] as string).length > 2 ? (raw[k] as string) : null));
  }
  return out;
}

export async function latestBlock(): Promise<number> {
  return Number(BigInt(await rpc<string>("eth_blockNumber", [])));
}

export const hexBlock = (n: number) => `0x${n.toString(16)}`;
