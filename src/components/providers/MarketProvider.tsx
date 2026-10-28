"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { TokenRow } from "@/lib/market";
import type { MarketBoard } from "@/lib/server/market";

/* Polls the site's market board (/api/market) for every page: token rows, new and trending pools, movers. */

type Ctx = { data: MarketBoard | null; byAddress: Map<string, TokenRow>; error: string | null; loading: boolean; at: number | null; refresh: () => void };
const MarketCtx = createContext<Ctx>({ data: null, byAddress: new Map(), error: null, loading: true, at: null, refresh: () => {} });

export const POLL_MS = 60_000;

export function MarketProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<MarketBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const busy = useRef(false);

  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const r = await fetch("/api/market", { cache: "no-store" });
      const body = (await r.json().catch(() => null)) as (MarketBoard & { error?: string }) | null;
      if (!r.ok || !body || body.error) throw new Error(body?.error ?? `HTTP ${r.status}`);
      setData(body);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Market data is not available.");
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, POLL_MS);
    return () => window.clearInterval(t);
  }, [load]);

  const value = useMemo(() => ({ data, byAddress: new Map((data?.tokens ?? []).map((t) => [t.address, t])), error, loading, at: data?.at ?? null, refresh: load }), [data, error, loading, load]);
  return <MarketCtx.Provider value={value}>{children}</MarketCtx.Provider>;
}

export const useMarket = () => useContext(MarketCtx);
