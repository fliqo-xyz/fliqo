"use client";

import Link from "next/link";
import { shortAddress } from "@/config/brand";
import type { TapeItem } from "@/lib/server/market";
import { useJson } from "@/lib/useJson";
import { usdShort } from "@/lib/format";

/* Header band: recent swaps of the busiest Robinhood Chain pools (GeckoTerminal trades), scrolling. */
export function Ticker() {
  const { data } = useJson<{ items: TapeItem[] }>("/api/tape", 45_000);
  const items = (data?.items ?? []).slice(0, 16);
  return (
    <div className="fq-ticker" aria-label="Recent swaps on Robinhood Chain">
      <div className="fq-ticker-label">
        <span className="fq-live-dot" aria-hidden="true" />
        Live <span className="text-muted">· swaps</span>
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">
        {items.length ? (
          <div className="fq-ticker-track">
            {[...items, ...items].map((t, i) => (
              <Link key={`${t.tx}-${i}`} href={`/coin/${t.base.address}`} className="fq-ticker-item" aria-hidden={i >= items.length ? "true" : undefined} tabIndex={i >= items.length ? -1 : undefined}>
                <span>{shortAddress(t.wallet, 4, 4)}</span>
                <span className={t.side === "buy" ? "up" : "down"}>{t.side === "buy" ? "bought" : "sold"}</span>
                <b>${t.base.symbol}</b>
                <span>· {usdShort(t.volumeUsd)}</span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="fq-ticker-item">Reading recent swaps from GeckoTerminal…</div>
        )}
      </div>
    </div>
  );
}
