import { BRAND, ETH_USD_FEED, USDG, WETH, isAddress } from "@/config/brand";
import { CONTRACTS } from "@/config/contracts";

/*
 * Rules for the read-only JSON-RPC relay, kept apart from the route so they
 * can be tested. Every request is priced in units; each network has a budget,
 * and the site as a whole has one more (always charged, see src/lib/charge.ts).
 * Log queries are not relayed at all: the site reads its own contract through
 * paged view functions, so no eth_getLogs filter shape needs to be served.
 */

export const MAX_CALLS = 20;
export const MAX_GAS = 2_000_000;

const GAS_CAP_HEX = `0x${MAX_GAS.toString(16)}`;
const CALL_KEYS = new Set(["from", "to", "gas", "gasPrice", "maxFeePerGas", "maxPriorityFeePerGas", "value", "data", "input", "nonce", "type", "chainId"]);
const BLOCK_TAG = /^(latest|pending|safe|finalized|0x[0-9a-fA-F]{1,16})$/;

/**
 * Normalises a call object before it is checked and forwarded. The node reads `input` as well as
 * `data`, so `input` is folded into `data` (refused when the two disagree) and every size check sees
 * the bytes that will run; a call without `gas` gets the relay cap instead of the node's much higher
 * default. Mutates `tx`; running it twice is harmless.
 */
function shapeTx(tx: Record<string, unknown>): string | null {
  // The node decodes field names case-insensitively ("TO" would override "to"), so only these exact names pass.
  for (const k of Object.keys(tx)) if (!CALL_KEYS.has(k)) return `Unsupported call field: ${k.slice(0, 32)}`;
  if (tx.input !== undefined) {
    if (tx.data !== undefined && tx.data !== tx.input) return "data and input disagree.";
    tx.data = tx.input;
    delete tx.input;
  }
  if (tx.data !== undefined && (typeof tx.data !== "string" || !/^0x[0-9a-fA-F]*$/.test(tx.data))) return "Call data must be hex.";
  if (tx.gas === undefined) tx.gas = GAS_CAP_HEX;
  return null;
}
export const MAX_BODY = 32_768;
export const BUDGET = { units: 600, windowSec: 600, siteUnits: 20_000 };

export const COST: Record<string, number> = {
  eth_call: 2,
  eth_getTransactionReceipt: 1,
  eth_getTransactionByHash: 1,
  eth_blockNumber: 1,
  eth_getBalance: 1,
  eth_chainId: 1,
  eth_gasPrice: 1,
  eth_getBlockByNumber: 1,
  eth_getTransactionCount: 1,
  eth_maxPriorityFeePerGas: 1,
  eth_getCode: 1,
  eth_estimateGas: 3,
};

/** Call data limit in hex characters (the largest site read, a paged journal view, is far below this). */
export const MAX_CALL_DATA = 20_000;
const dataLimit = (to: unknown) => (typeof to === "string" ? MAX_CALL_DATA : 0);

/**
 * Contracts the browser reads through the relay: USDG, WETH, the ETH / USD feed, the token once launched and
 * the FliqoWatchBook once deployed. Transactions, receipts, nonces and balances are answered for any address or hash
 * (the wallet checks its own transactions). */
export function readTargets() {
  const list: string[] = [USDG.address, WETH, ETH_USD_FEED];
  if (isAddress(BRAND.ca)) list.push(BRAND.ca);
  for (const a of [CONTRACTS.watch]) if (isAddress(a)) list.push(a);
  return new Set(list.map((a) => a.toLowerCase()));
}

/** Addresses a batch reads (eth_call and eth_estimateGas targets), lowercased. */
export function namedAddresses(body: Call | Call[]): string[] {
  const calls = Array.isArray(body) ? body : [body];
  const out = new Set<string>();
  for (const c of calls) {
    if (!c || !Array.isArray(c.params)) continue;
    const first = c.params[0] as { to?: unknown; address?: unknown } | undefined;
    if (!first || typeof first !== "object") continue;
    if ((c.method === "eth_call" || c.method === "eth_estimateGas") && typeof first.to === "string") out.add(first.to.toLowerCase());
  }
  return [...out].filter((a) => /^0x[0-9a-f]{40}$/.test(a));
}

export type Call = { jsonrpc?: string; id?: unknown; method: string; params?: unknown[] };

/** Checks a batch and returns its cost in units, or the reason it is refused. */
export function checkBatch(calls: Call[], targets = readTargets()): { units: number } | { error: string } {
  if (calls.length === 0 || calls.length > MAX_CALLS) return { error: `Between 1 and ${MAX_CALLS} calls per request.` };
  let units = 0;
  for (let i = 0; i < calls.length; i++) {
    const c = calls[i];
    if (!c || typeof c.method !== "string" || !Object.hasOwn(COST, c.method)) return { error: `Method not allowed: ${String(c?.method)}` };
    if (c.params !== undefined && !Array.isArray(c.params)) return { error: "params must be an array." };
    const params = c.params ?? [];
    units += COST[c.method];
    if (c.method === "eth_call") {
      if (params.length > 2) return { error: "State overrides are not relayed." };
      const tx = params[0] as { to?: unknown; gas?: unknown; data?: unknown } | undefined;
      if (!tx || typeof tx.to !== "string" || !targets.has(tx.to.toLowerCase())) return { error: "eth_call target not served by this relay." };
      const shaped = shapeTx(tx as Record<string, unknown>);
      if (shaped) return { error: shaped };
      if (params[1] !== undefined && !(typeof params[1] === "string" && BLOCK_TAG.test(params[1]))) return { error: "Unsupported block tag." };
      if (tx.gas !== undefined) {
        const gas = typeof tx.gas === "string" && /^0x[0-9a-fA-F]{1,16}$/.test(tx.gas) ? Number(BigInt(tx.gas)) : Infinity;
        if (gas > MAX_GAS) return { error: "Gas above the relay cap." };
      }
      if (typeof tx.data === "string" && tx.data.length > dataLimit(tx.to)) return { error: "Call data too large." };
    }
    if (c.method === "eth_getBlockByNumber" && params[1] !== false) return { error: "eth_getBlockByNumber is relayed only with full transactions off (false)." };
    if ((c.method === "eth_getTransactionByHash" || c.method === "eth_getTransactionReceipt") && !(params.length === 1 && typeof params[0] === "string" && /^0x[0-9a-fA-F]{64}$/.test(params[0]))) return { error: "Transaction lookups take one 32-byte hash." };
    if ((c.method === "eth_getTransactionCount" || c.method === "eth_getBalance") && !(params.length <= 2 && typeof params[0] === "string" && /^0x[0-9a-fA-F]{40}$/.test(params[0]) && (params[1] === undefined || (typeof params[1] === "string" && BLOCK_TAG.test(params[1]))))) return { error: "Balance and nonce reads take an address and a block tag." };
    if (c.method === "eth_estimateGas") {
      if (params.length > 2) return { error: "State overrides are not relayed." };
      const tx = params[0] as { to?: unknown; gas?: unknown; data?: unknown } | undefined;
      if (!tx || typeof tx !== "object") return { error: "eth_estimateGas needs a transaction." };
      if (typeof tx.to !== "string" || !targets.has(tx.to.toLowerCase())) return { error: "eth_estimateGas target not served by this relay." };
      const shaped = shapeTx(tx as Record<string, unknown>);
      if (shaped) return { error: shaped };
      if (params[1] !== undefined && !(typeof params[1] === "string" && BLOCK_TAG.test(params[1]))) return { error: "Unsupported block tag." };
      if (tx.gas !== undefined) {
        const gas = typeof tx.gas === "string" && /^0x[0-9a-fA-F]{1,16}$/.test(tx.gas) ? Number(BigInt(tx.gas)) : Infinity;
        if (gas > MAX_GAS) return { error: "Gas above the relay cap." };
      }
      if (typeof tx.data === "string" && tx.data.length > dataLimit(tx.to)) return { error: "Call data too large." };
    }
  }
  return { units };
}

export type RpcAnswer = { result: unknown } | { error: { code: number; message: string; data?: string } } | { down: true };

export type RelayDeps = {
  /** Charges the caller's budgets; returns the refusal message, or null when allowed. */
  charge: (units: number) => Promise<string | null>;
  one: (method: string, params: unknown[]) => Promise<RpcAnswer>;
  many: (calls: { method: string; params: unknown[] }[]) => Promise<(unknown | null)[]>;
};

/**
 * The relay's whole decision, without I/O of its own: shape and price first, then the budget, then
 * the target allowlist, and only then the upstream RPC. A refused request never reaches the RPC.
 */
export async function runRelay(body: Call | Call[], deps: RelayDeps): Promise<{ status: number; body: unknown }> {
  const calls = Array.isArray(body) ? body : [body];
  const targets = readTargets();
  // Priced with every named address allowed first, so a refused target still costs budget.
  const priced = checkBatch(calls, new Set([...targets, ...namedAddresses(body)]));
  if ("error" in priced) return { status: 400, body: { error: priced.error } };
  const refused = await deps.charge(priced.units);
  if (refused) return { status: 429, body: { error: refused } };
  const checked = checkBatch(calls, targets);
  if ("error" in checked) return { status: 400, body: { error: checked.error } };
  if (calls.length === 1 && !Array.isArray(body)) {
    const c = calls[0];
    const a = await deps.one(c.method, c.params ?? []);
    if ("down" in a) return { status: 502, body: { error: "The chain could not be reached." } };
    return { status: 200, body: { jsonrpc: "2.0", id: c.id ?? null, ...a } };
  }
  try {
    const results = await deps.many(calls.map((c) => ({ method: c.method, params: c.params ?? [] })));
    const out = calls.map((c, i) =>
      results[i] === null ? { jsonrpc: "2.0", id: c.id ?? null, error: { code: -32000, message: "read failed" } } : { jsonrpc: "2.0", id: c.id ?? null, result: results[i] },
    );
    return { status: 200, body: Array.isArray(body) ? out : out[0] };
  } catch {
    return { status: 502, body: { error: "The chain could not be reached." } };
  }
}
