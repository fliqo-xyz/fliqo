"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { ChainSnapshot } from "@/lib/server/snapshot";

const Ctx = createContext<{ facts: ChainSnapshot | null; failed: boolean }>({ facts: null, failed: false });

/** Polls the server's live chain snapshot (block, gas, ETH price, token and contract state) for the whole site. */
export function ChainProvider({ children }: { children: React.ReactNode }) {
  const [facts, setFacts] = useState<ChainSnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch("/api/chain", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((v: ChainSnapshot) => {
          if (cancelled) return;
          setFacts(v);
          setFailed(v.block === null);
        })
        .catch(() => !cancelled && setFailed(true));
    load();
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 12_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);
  return <Ctx.Provider value={{ facts, failed }}>{children}</Ctx.Provider>;
}

export const useChain = () => useContext(Ctx);
