import type { Store } from "@/lib/server/store";
import { spend } from "@/lib/ratelimit";
import { BUDGET } from "@/lib/relay";

/*
 * Budgets for every route that reads Robinhood Chain on a visitor's behalf. Each charges the caller's network AND a
 * site-wide bucket on every request, whatever the proxy setup (lead decision 27 Oct 2026: the site-wide cap is never
 * skipped, also when TRUST_PROXY_HEADERS is on), so rotating addresses cannot exhaust the RPC quota.
 */

/** Relay: per-network units, then the site-wide units. Returns the refusal message or null. */
export async function chargeRelay(store: Store | null, ip: string, units: number): Promise<string | null> {
  if (!(await spend(store, "rpc", ip, units, BUDGET.units, BUDGET.windowSec, { aggregate: true }))) return "Too many chain reads from your network. Slow down a little.";
  if (!(await spend(store, "rpc-site", "all", units, BUDGET.siteUnits, BUDGET.windowSec))) return "The relay is busy. Try again shortly.";
  return null;
}

/** Per-route budgets: requests per network and site-wide per window (seconds). */
export const BUDGETS = {
  /** Token facts and risk checks (eth_calls against a user-chosen address). */
  token: { perNetwork: 30, site: 600, windowSec: 600 },
  /** Quotes (quoter simulations touching user-chosen tokens). */
  quote: { perNetwork: 40, site: 900, windowSec: 600 },
  /** Wallet reads: balances and approvals of one address over the listed tokens. */
  wallet: { perNetwork: 20, site: 400, windowSec: 600 },
  /** Market lists and pool details (cached upstream, cheap). */
  market: { perNetwork: 120, site: 4000, windowSec: 600 },
} as const;
export type BudgetName = keyof typeof BUDGETS;

const WORDS: Record<BudgetName, string> = {
  token: "token lookups",
  quote: "quotes",
  wallet: "wallet reads",
  market: "market requests",
};

/** Charges `name` for one request from `ip`. Returns the refusal message or null. */
export async function charge(store: Store | null, ip: string, name: BudgetName): Promise<string | null> {
  const b = BUDGETS[name];
  if (!(await spend(store, name, ip, 1, b.perNetwork, b.windowSec, { aggregate: true }))) return `Too many ${WORDS[name]} from your network. Try again in a few minutes.`;
  if (!(await spend(store, `${name}-site`, "all", 1, b.site, b.windowSec))) return `${WORDS[name][0].toUpperCase()}${WORDS[name].slice(1)} are busy right now. Try again shortly.`;
  return null;
}
