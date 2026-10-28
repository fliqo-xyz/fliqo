import "server-only";
import { NextResponse } from "next/server";
import { charge, type BudgetName } from "@/lib/charge";
import { clientIp } from "@/lib/netkey";
import { getStore } from "@/lib/server/store";

/* Shared pieces of the public read routes: per-network + site-wide budgets and JSON answers proxies never cache. */

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

/** Charges the named budget (per network AND site-wide, always). Returns a 429 answer to send, or null to go on. */
export async function overBudget(request: Request, name: BudgetName): Promise<NextResponse | null> {
  const refused = await charge(getStore(), clientIp(request), name);
  return refused ? json({ error: refused }, 429) : null;
}

/** A 20-byte hex address, lowercased, or null. */
export function cleanAddress(v: string | null | undefined): string | null {
  const a = String(v ?? "").trim().toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(a) ? a : null;
}
