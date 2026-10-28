import { decodeErrorResult, decodeFunctionResult, encodeFunctionData, type Abi } from "viem";
import { CHAIN } from "@/config/brand";
import { ALL_ERRORS, ERROR_WORDS } from "@/lib/abi";

/*
 * Browser-side reads. They go through the site relay first (some networks intercept the chain's public
 * RPC host), then the configured RPC, then the public fallback.
 */

const ENDPOINTS = ["/api/rpc", CHAIN.rpc, CHAIN.fallbackRpc].filter((u, i, all) => all.indexOf(u) === i);
let preferred = 0;

export class ChainError extends Error {
  constructor(
    message: string,
    readonly data: string | null = null,
    readonly final = false,
  ) {
    super(message);
  }
}

type RpcBody = { id?: number; result?: unknown; error?: { message?: string; data?: unknown; code?: number } | string };

function errorData(e: { data?: unknown }) {
  if (typeof e.data === "string") return e.data;
  const inner = e.data as { data?: unknown } | null;
  return inner && typeof inner.data === "string" ? inner.data : null;
}

/** One JSON-RPC call with endpoint fallback. A revert is final (not retried elsewhere). */
export async function rpcCall<T>(method: string, params: unknown[]): Promise<T> {
  let last: unknown = null;
  for (let n = 0; n < ENDPOINTS.length; n++) {
    const index = (preferred + n) % ENDPOINTS.length;
    try {
      const res = await fetch(ENDPOINTS[index], { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), cache: "no-store" });
      const body = (await res.json().catch(() => null)) as RpcBody | null;
      if (!body) throw new Error(`RPC ${res.status}`);
      if (typeof body.error === "string") throw new Error(body.error);
      if (body.error) {
        const final = body.error.code === 3 || /revert/i.test(body.error.message ?? "");
        const err = new ChainError(body.error.message ?? "RPC error", errorData(body.error), final);
        if (final) throw err;
        throw err;
      }
      preferred = index;
      return body.result as T;
    } catch (error) {
      if (error instanceof ChainError && error.final) throw error;
      last = error;
    }
  }
  throw last instanceof Error ? last : new Error("The chain could not be reached.");
}

/** A batch where each entry may fail on its own (null), with endpoint fallback for the whole batch. */
export async function rpcBatchLoose(calls: { method: string; params: unknown[] }[]): Promise<(unknown | null)[]> {
  if (calls.length === 0) return [];
  let last: unknown = null;
  for (let n = 0; n < ENDPOINTS.length; n++) {
    const index = (preferred + n) % ENDPOINTS.length;
    try {
      const res = await fetch(ENDPOINTS[index], { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(calls.map((c, id) => ({ jsonrpc: "2.0", id, ...c }))), cache: "no-store" });
      const body = (await res.json().catch(() => null)) as RpcBody[] | RpcBody | null;
      if (!Array.isArray(body)) throw new Error(typeof body?.error === "string" ? body.error : `RPC ${res.status}`);
      const out: (unknown | null)[] = calls.map(() => null);
      for (const e of body) if (typeof e.id === "number" && !e.error && e.result !== undefined) out[e.id] = e.result;
      preferred = index;
      return out;
    } catch (error) {
      last = error;
    }
  }
  throw last instanceof Error ? last : new Error("The chain could not be reached.");
}

export type Read = { to: string; abi: Abi; fn: string; args?: readonly unknown[] };

export const encodeRead = (r: Read) => encodeFunctionData({ abi: r.abi, functionName: r.fn, args: r.args ?? [] } as never);

export async function read<T>(r: Read): Promise<T> {
  const raw = await rpcCall<`0x${string}`>("eth_call", [{ to: r.to, data: encodeRead(r) }, "latest"]);
  return decodeFunctionResult({ abi: r.abi, functionName: r.fn, data: raw } as never) as T;
}

/** Many reads in batches of 20; a read that fails or does not decode is null. */
export async function readMany(reads: Read[]): Promise<unknown[]> {
  const out: unknown[] = [];
  for (let i = 0; i < reads.length; i += 20) {
    const chunk = reads.slice(i, i + 20);
    const raw = await rpcBatchLoose(chunk.map((r) => ({ method: "eth_call", params: [{ to: r.to, data: encodeRead(r) }, "latest"] })));
    chunk.forEach((r, k) => {
      try {
        out.push(typeof raw[k] === "string" && (raw[k] as string).length > 2 ? decodeFunctionResult({ abi: r.abi, functionName: r.fn, data: raw[k] as `0x${string}` } as never) : null);
      } catch {
        out.push(null);
      }
    });
  }
  return out;
}

/** Waits for a transaction receipt; resolves its status. */
export async function waitForReceipt(hash: string, timeoutMs = 120_000): Promise<{ ok: boolean; blockNumber: number; contractAddress: string | null }> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const r = await rpcCall<{ status: string; blockNumber: string; contractAddress: string | null } | null>("eth_getTransactionReceipt", [hash]).catch(() => null);
    if (r) return { ok: r.status === "0x1", blockNumber: Number(BigInt(r.blockNumber)), contractAddress: r.contractAddress };
    await new Promise((res) => setTimeout(res, 1200));
  }
  throw new Error("No receipt yet. The transaction may still land; check the explorer.");
}

/** Plain words for a revert from the FliqoWatchBook, or the wallet's own message. */
export function explain(cause: unknown): string {
  const e = cause as { code?: number; message?: string; data?: unknown; cause?: unknown } | null;
  if (e?.code === 4001) return "The request was declined in the wallet.";
  const data = e instanceof ChainError ? e.data : typeof e?.data === "string" ? e.data : errorData((e ?? {}) as { data?: unknown });
  if (data && data.length >= 10) {
    try {
      const d = decodeErrorResult({ abi: ALL_ERRORS as Abi, data: data as `0x${string}` });
      return ERROR_WORDS[d.errorName] ?? d.errorName;
    } catch {
      // not one of ours
    }
  }
  const msg = e?.message ?? "Something went wrong.";
  return msg.length > 220 ? `${msg.slice(0, 220)}…` : msg;
}
