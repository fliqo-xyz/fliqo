import { NextResponse } from "next/server";
import { readCapped } from "@/lib/guard";
import { getStore } from "@/lib/server/store";
import { RpcError, rpc, rpcBatch } from "@/lib/feeds/rpc";
import { chargeRelay } from "@/lib/charge";
import { clientIp } from "@/lib/netkey";
import { MAX_BODY, runRelay, type Call } from "@/lib/relay";

export const dynamic = "force-dynamic";

/*
 * JSON-RPC relay for the browser. Some networks intercept the chain's public RPC host, so the site reads
 * through its own server first: read methods for the contracts the site itself reads (tokens, the price feed,
 * the FliqoWatchBook), transaction and receipt lookups, and gas estimates. It never forwards a signed transaction and
 * relays no log queries. A cost budget per network (IPv6 per /64) and a site-wide ceiling (always charged) keep the
 * RPC quota safe. Rules live in src/lib/relay.ts.
 */
export async function POST(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY) return NextResponse.json({ error: "Request too large." }, { status: 413 });
  const text = await readCapped(request, MAX_BODY).catch(() => "");
  if (text === null) return NextResponse.json({ error: "Request too large." }, { status: 413 });
  let body: Call | Call[];
  try {
    body = JSON.parse(text) as Call | Call[];
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const store = getStore();
  const ip = clientIp(request);
  const out = await runRelay(body, {
    // Per-network and site-wide budgets, both always charged (src/lib/charge.ts).
    charge: (units) => chargeRelay(store, ip, units),
    one: async (method, params) => {
      try {
        return { result: await rpc<unknown>(method, params) };
      } catch (error) {
        if (error instanceof RpcError) return { error: { code: error.revert ? 3 : -32000, message: error.message.slice(0, 300), ...(error.data ? { data: error.data } : {}) } };
        return { down: true };
      }
    },
    many: (calls) => rpcBatch<unknown>(calls),
  });
  return NextResponse.json(out.body, { status: out.status, headers: { "cache-control": "no-store" } });
}
