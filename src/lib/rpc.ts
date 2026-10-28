import { CHAIN } from "@/config/brand";

// The site's own read-only relay first (some networks intercept the public RPC
// host), then the chain's endpoints directly.
const ENDPOINTS = ["/api/rpc", CHAIN.rpc, CHAIN.fallbackRpc].filter((url, i, all) => all.indexOf(url) === i);
// Index of the endpoint that last answered, so a dead one is not retried first every poll.
let preferred = 0;

/**
 * Minimal JSON-RPC read against Robinhood Chain from the browser. Tries the
 * site relay, then the configured endpoint, then the public fallback.
 */
export async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  let lastError: unknown;
  for (let n = 0; n < ENDPOINTS.length; n++) {
    const index = (preferred + n) % ENDPOINTS.length;
    try {
      const result = await call<T>(ENDPOINTS[index], method, params);
      preferred = index;
      return result;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function call<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`RPC ${response.status}`);
  const body = (await response.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(body.error.message);
  return body.result as T;
}

/** Formats a hex wei amount as ETH with a few significant decimals. */
export function formatEth(hexWei: string, digits = 4) {
  const wei = BigInt(hexWei);
  const whole = wei / 10n ** 18n;
  const fraction = (wei % 10n ** 18n).toString().padStart(18, "0").slice(0, digits);
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole.toString();
}

/** Several reads in one JSON-RPC batch, with the same endpoint fallback. */
export async function rpcBatch<T>(calls: { method: string; params: unknown[] }[]): Promise<T[]> {
  let lastError: unknown;
  for (let n = 0; n < ENDPOINTS.length; n++) {
    const index = (preferred + n) % ENDPOINTS.length;
    try {
      const response = await fetch(ENDPOINTS[index], {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(calls.map((c, id) => ({ jsonrpc: "2.0", id, ...c }))),
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`RPC ${response.status}`);
      const body = (await response.json()) as { id: number; result?: T; error?: { message: string } }[];
      if (!Array.isArray(body)) throw new Error("Batch not supported");
      const sorted = [...body].sort((a, b) => a.id - b.id);
      if (sorted.some((entry) => entry.error)) throw new Error("Batch entry failed");
      preferred = index;
      return sorted.map((entry) => entry.result as T);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
