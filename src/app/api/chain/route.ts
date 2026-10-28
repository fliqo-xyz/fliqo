import { NextResponse } from "next/server";
import { readSnapshot, type ChainSnapshot } from "@/lib/server/snapshot";

export const dynamic = "force-dynamic";
export type { ChainSnapshot };

/*
 * Live facts for the whole site (see src/lib/server/snapshot.ts). Cached for a few seconds and refreshed by
 * one request at a time, at most once per TTL even while reads keep failing, so an upstream outage is not
 * multiplied by the number of visitors.
 */

let cache: { at: number; value: ChainSnapshot } | null = null;
const TTL = 8_000;
let inflight: Promise<void> | null = null;
let lastTry = 0;

export async function GET() {
  if ((!cache || Date.now() - cache.at > TTL) && Date.now() - lastTry > TTL) {
    lastTry = Date.now();
    inflight ??= readSnapshot()
      .then((value) => {
        // A failed read does not replace a good one that is still recent.
        if (value.block !== null || !cache || Date.now() - cache.at > 120_000) cache = { at: Date.now(), value };
      })
      .catch(() => {})
      .finally(() => {
        inflight = null;
      });
  }
  if (inflight) await inflight;
  if (!cache) return NextResponse.json({ error: "Chain data is not available yet." }, { status: 503, headers: { "cache-control": "no-store" } });
  return NextResponse.json(cache.value, { headers: { "cache-control": "no-store" } });
}
