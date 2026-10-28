import { CHAIN } from "@/config/brand";
import { cleanAddress, json, overBudget } from "@/lib/server/http";
import { memo } from "@/lib/server/memo";
import { readCappedResponse } from "@/lib/server/capped";

export const dynamic = "force-dynamic";

/*
 * GET /api/activity?owner=0x… — the latest transactions of an address, for the Execution Monitor. The chain's RPC has
 * no "transactions of an address" method, so this needs an indexer: the Blockscout PRO API with the optional
 * BLOCKSCOUT_API_KEY. Without the key the answer says so ({ configured: false }) and the monitor tracks the hashes
 * the visitor pastes or sends from this site.
 */
type Tx = { hash: string; nonce: number; to: string | null; from: string; block: number; time: number; ok: boolean; method: string | null; valueWei: string };

export async function GET(request: Request) {
  const owner = cleanAddress(new URL(request.url).searchParams.get("owner"));
  if (!owner) return json({ error: "owner must be an address." }, 400);
  const key = process.env.BLOCKSCOUT_API_KEY ?? "";
  if (!/^proapi_[A-Za-z0-9_-]{8,200}$/.test(key)) return json({ configured: false, txs: [] });
  const refused = await overBudget(request, "wallet");
  if (refused) return refused;
  try {
    const { value, at } = await memo(`activity:${owner}`, 20_000, async () => {
      const url = `https://api.blockscout.com/v2/api?chain_id=${CHAIN.id}&module=account&action=txlist&address=${owner}&page=1&offset=25&sort=desc&apikey=${encodeURIComponent(key)}`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      try {
        const res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
        const text = await readCappedResponse(res, 1_000_000);
        if (!res.ok || text === null) throw new Error(`indexer ${res.status}`);
        const body = JSON.parse(text) as { result?: unknown };
        const rows = Array.isArray(body.result) ? (body.result as Record<string, unknown>[]) : [];
        const txs: Tx[] = [];
        for (const r of rows.slice(0, 25)) {
          const hash = String(r.hash ?? "").toLowerCase();
          if (!/^0x[0-9a-f]{64}$/.test(hash)) continue;
          const to = String(r.to ?? "").toLowerCase();
          txs.push({
            hash,
            nonce: Number(r.nonce ?? -1),
            from: String(r.from ?? "").toLowerCase().slice(0, 42),
            to: /^0x[0-9a-f]{40}$/.test(to) ? to : null,
            block: Number(r.blockNumber ?? 0),
            time: Number(r.timeStamp ?? 0) * 1000,
            ok: String(r.isError ?? "0") === "0" && String(r.txreceipt_status ?? "1") !== "0",
            method: typeof r.functionName === "string" && r.functionName ? r.functionName.slice(0, 40) : typeof r.methodId === "string" ? r.methodId.slice(0, 10) : null,
            valueWei: /^\d{1,40}$/.test(String(r.value ?? "")) ? String(r.value) : "0",
          });
        }
        return txs;
      } finally {
        clearTimeout(timer);
      }
    });
    return json({ configured: true, txs: value, at });
  } catch (e) {
    return json({ configured: true, txs: [], error: e instanceof Error ? e.message.slice(0, 120) : "Indexer unavailable." }, 503);
  }
}
