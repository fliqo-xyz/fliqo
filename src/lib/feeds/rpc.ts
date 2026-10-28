import "server-only";
import { CHAIN, serverRpc } from "@/config/brand";
import { readCappedResponse } from "@/lib/server/capped";

/*
 * JSON-RPC reads against Robinhood Chain from the server. The configured
 * endpoint is tried first, then the public fallback. Reads only: nothing here
 * signs or sends a transaction.
 */

const endpoints = () => [serverRpc(), CHAIN.fallbackRpc, CHAIN.spareRpc].filter((url, i, all) => all.indexOf(url) === i);
let preferred = 0;

export class RpcError extends Error {
  constructor(message: string, readonly revert = false, readonly data: string | null = null) {
    super(message);
  }
}

/** Largest upstream answer any server read accepts; the stream is aborted past it. */
export const MAX_RESPONSE_BYTES = 2_000_000;

async function post(url: string, body: unknown) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 7000);
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store", signal: ctrl.signal });
    if (!res.ok || !res.body) throw new RpcError(`RPC ${res.status}`);
    const text = await readCappedResponse(res, MAX_RESPONSE_BYTES);
    if (text === null) {
      ctrl.abort();
      // Final: the same query is just as large on any endpoint.
      throw new RpcError("Upstream response too large.", true);
    }
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

export async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const list = endpoints();
  let last: unknown;
  for (let n = 0; n < list.length; n++) {
    const i = (preferred + n) % list.length;
    try {
      const body = (await post(list[i], { jsonrpc: "2.0", id: 1, method, params })) as {
        result?: T;
        error?: { message: string; code?: number; data?: unknown };
      };
      if (body.error) {
        const data = typeof body.error.data === "string" && /^0x[0-9a-fA-F]*$/.test(body.error.data) ? body.error.data.slice(0, 2_000) : null;
        // A revert is an answer, not an outage: do not try the next endpoint. The same goes for a
        // transaction the node refused (nonce, funds, fee): retrying elsewhere cannot change that.
        if (/revert/i.test(body.error.message) || body.error.code === 3) throw new RpcError(body.error.message, true, data);
        if (method === "eth_sendRawTransaction" || method === "eth_estimateGas") throw new RpcError(body.error.message, true, data);
        throw new RpcError(body.error.message);
      }
      preferred = i;
      return body.result as T;
    } catch (error) {
      if (error instanceof RpcError && error.revert) throw error;
      last = error;
    }
  }
  throw last;
}

export async function rpcBatch<T>(calls: { method: string; params: unknown[] }[]): Promise<(T | null)[]> {
  if (calls.length === 0) return [];
  const list = endpoints();
  let last: unknown;
  for (let n = 0; n < list.length; n++) {
    const i = (preferred + n) % list.length;
    try {
      const body = (await post(
        list[i],
        calls.map((c, id) => ({ jsonrpc: "2.0", id, ...c })),
      )) as { id: number; result?: T; error?: unknown }[];
      if (!Array.isArray(body)) throw new RpcError("batch unsupported");
      preferred = i;
      const out: (T | null)[] = calls.map(() => null);
      for (const entry of body) if (!entry.error && entry.result !== undefined) out[entry.id] = entry.result;
      return out;
    } catch (error) {
      if (error instanceof RpcError && error.revert) throw error;
      last = error;
    }
  }
  throw last;
}

export const ethCall = (to: string, data: string) => rpc<string>("eth_call", [{ to, data }, "latest"]);

/** Splits an ABI result into 32-byte words. */
export function words(hex: string) {
  const body = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out: string[] = [];
  for (let i = 0; i + 64 <= body.length; i += 64) out.push(body.slice(i, i + 64));
  return out;
}

/** Two's-complement signed integer from a 32-byte word. */
export function signed(word: string) {
  const v = BigInt(`0x${word}`);
  return v >= 1n << 255n ? v - (1n << 256n) : v;
}

export const uint = (word: string) => BigInt(`0x${word}`);
export const pad = (n: number | bigint) => BigInt(n).toString(16).padStart(64, "0");

/**
 * A read whose answer may not exceed `maxBytes`: the body is streamed and the request aborted past the
 * limit, so a spammed log range is never buffered whole. Throws `onTooLarge()` in that case.
 */
export async function rpcCapped<T>(method: string, params: unknown[], maxBytes: number, onTooLarge: () => Error): Promise<T> {
  const list = endpoints();
  let last: unknown;
  for (let n = 0; n < list.length; n++) {
    const i = (preferred + n) % list.length;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const res = await fetch(list[i], {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        cache: "no-store",
        signal: ctrl.signal,
      });
      if (!res.body) throw new RpcError(`RPC ${res.status}`);
      if (!res.ok) {
        // Some nodes answer a refused query with HTTP 400 and a JSON-RPC error body: keep its message.
        const t = await readCappedResponse(res, 4_000).catch(() => null);
        let m = `RPC ${res.status}`;
        try {
          m = (JSON.parse(t ?? "") as { error?: { message?: string } }).error?.message ?? m;
        } catch {
          // not JSON
        }
        throw new RpcError(m, /range|limit|results|exceed|spans/i.test(m) && !/plan|personal token|archive/i.test(m));
      }
      const text = await readCappedResponse(res, maxBytes);
      if (text === null) {
        ctrl.abort();
        throw onTooLarge();
      }
      const body = JSON.parse(text) as { result?: T; error?: { message: string } };
      // A refusal about the query (too many logs, span over the node's limit) is final; a refusal that only
      // reflects one provider's plan is not, so the next endpoint is tried.
      if (body.error) throw new RpcError(body.error.message, /range|limit|results|exceed|spans/i.test(body.error.message) && !/plan|personal token|archive/i.test(body.error.message));
      preferred = i;
      return body.result as T;
    } catch (error) {
      // "Too large" and range refusals are answers about this query: do not retry them elsewhere.
      if (error instanceof RpcError ? error.revert : !(error instanceof SyntaxError || (error instanceof Error && (error.name === "AbortError" || error.name === "TypeError")))) throw error;
      last = error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw last;
}
