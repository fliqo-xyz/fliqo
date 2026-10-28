"use client";

import { useMemo } from "react";
import { useLocalStore } from "@/components/wallet/useLocalStore";
import { KEYS } from "@/config/storage";
import { cleanWatch, MAX_TOKENS, type Rule, type Watch } from "@/lib/watch";

/* Everything Fliqo keeps in this browser, in one place. Nothing here leaves the device unless you sync it on chain. */

export { KEYS };

/** The watchlist (tokens + alert thresholds), validated on every read. */
export function useWatch() {
  const [raw, write] = useLocalStore<unknown>(KEYS.watchlist, { tokens: [], rules: {} });
  const watch = useMemo(() => cleanWatch(raw), [raw]);
  const set = (f: (w: Watch) => Watch) => write((prev: unknown) => cleanWatch(f(cleanWatch(prev))));
  const has = (a: string) => watch.tokens.includes(a.toLowerCase());
  const toggle = (a: string) =>
    set((w) => {
      const t = a.toLowerCase();
      if (w.tokens.includes(t)) {
        const rules = { ...w.rules };
        delete rules[t];
        return { tokens: w.tokens.filter((x) => x !== t), rules };
      }
      return w.tokens.length >= MAX_TOKENS ? w : { tokens: [...w.tokens, t], rules: w.rules };
    });
  const setRule = (a: string, r: Rule) => set((w) => ({ ...w, rules: { ...w.rules, [a.toLowerCase()]: r } }));
  const replace = (w: Watch) => set(() => w);
  return { watch, has, toggle, setRule, replace };
}

/** Slippage tolerance in basis points for the swap route preview (default 1%). */
export function useSlippage() {
  const [raw, write] = useLocalStore<unknown>(KEYS.slippage, 100);
  const bps = typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= 5000 ? raw : 100;
  return [bps, (v: number) => write(Math.max(1, Math.min(5000, Math.round(v))))] as const;
}
