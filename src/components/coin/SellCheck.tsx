"use client";

import { CardHead, Loading, Problem, Src } from "@/components/ui/kit";
import type { SellCheck, SellCheckLeg, SellStatus } from "@/lib/sellcheck";
import { useJson } from "@/lib/useJson";
import { ago, amount as fmtAmount, int } from "@/lib/format";

/* Sell check: a simulated small buy and sell back on the token's main pool (server route /api/sellcheck). */

const LABEL: Record<SellStatus, { text: string; tone: string }> = {
  sells: { text: "Sell went through", tone: "lime" },
  "sell-reverts": { text: "Sell reverted", tone: "ember" },
  "buy-reverts": { text: "Buy reverted", tone: "warn" },
  "not-simulated": { text: "Could not simulate", tone: "" },
};

const bps = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${(v / 100).toFixed(v > 0 && v < 10 ? 2 : 1)}%`);

/** The sell check answer for one token (null url = skip, e.g. ETH or the hubs). Shared by the card and the preview. */
export function useSellCheck(token: string | null) {
  return useJson<SellCheck>(token ? `/api/sellcheck/${token}` : null, 300_000);
}

function taxCell(leg: SellCheckLeg | null) {
  if (!leg) return "not run";
  if (!leg.ok) return <span className="down">reverted</span>;
  return leg.taxBps === null ? "not measured" : bps(leg.taxBps);
}

export function SellCheckCard({ token, symbol }: { token: string | null; symbol: string }) {
  const { data, error, loading } = useSellCheck(token);
  if (!token) return null;
  const label = data ? LABEL[data.status] : null;
  const quoteAmount = data?.buy && data.quote?.decimals != null ? Number(data.buy.sent) / 10 ** data.quote.decimals : null;
  return (
    <section className="fq-card" aria-labelledby="sell-check-title" id="sell-check" data-testid="sell-check">
      <CardHead id="sell-check-title" title="Sell check" tag="simulated">
        {label ? <span className={`fq-tag ${label.tone}`} data-testid="sell-check-status">{label.text}</span> : null}
        {data ? <span>read {ago(data.at)}</span> : null}
      </CardHead>
      <div className="fq-card-body">
        {loading && !data ? <Loading label="Simulating a small buy and sell…" /> : null}
        {error && !data ? <Problem>{error}</Problem> : null}
        {data ? (
          <>
            <p className="text-[14px] text-fg" data-testid="sell-check-summary">
              {data.summary}
            </p>
            {data.pool ? (
              <dl className="mt-4 grid gap-x-8 sm:grid-cols-2">
                <div className="fq-kv">
                  <dt>Pool</dt>
                  <dd>
                    {data.pool.name} · {data.pool.venueLabel}
                  </dd>
                </div>
                <div className="fq-kv">
                  <dt>Size</dt>
                  <dd>
                    {data.sellFromOverride ? `about $${data.sizeUsd} of $${symbol} (given balance)` : quoteAmount !== null ? `${fmtAmount(quoteAmount)} ${data.quote?.symbol} (about $${data.sizeUsd})` : "—"}
                  </dd>
                </div>
                <div className="fq-kv">
                  <dt>Buy tax</dt>
                  <dd>{data.sellFromOverride ? "buy reverted" : taxCell(data.buy)}</dd>
                </div>
                <div className="fq-kv">
                  <dt>Sell tax</dt>
                  <dd>{taxCell(data.sell)}</dd>
                </div>
                <div className="fq-kv">
                  <dt title="Buy and sell back: pool fees, price impact and any taxes together">Round trip cost</dt>
                  <dd>{bps(data.roundTripBps)}</dd>
                </div>
                <div className="fq-kv">
                  <dt>Gas (buy / sell)</dt>
                  <dd>
                    {data.buy?.ok ? int(data.buy.gas) : "—"} / {data.sell?.ok ? int(data.sell.gas) : "—"}
                  </dd>
                </div>
              </dl>
            ) : null}
            <p className="mt-3">
              <Src>
                One eth_call at block {data.block ?? "—"} runs a helper contract placed by a state override (never deployed): it buys about ${data.sizeUsd ?? 5} worth, then sells
                what it received. Taxes are measured on token balances, apart from pool fees. Nothing is sent or signed. A token owner can change fees or block sells later, so a sell
                that goes through today is not a promise for tomorrow.
              </Src>
            </p>
          </>
        ) : null}
      </div>
    </section>
  );
}

/** One line for the swap preview, linking to the card. */
export function SellCheckLine({ token }: { token: string | null }) {
  const { data } = useSellCheck(token);
  if (!token || !data) return null;
  const label = LABEL[data.status];
  const taxes = data.status === "sells" ? ` · buy tax ${data.sellFromOverride ? "—" : bps(data.buy?.taxBps)} · sell tax ${bps(data.sell?.taxBps)}` : "";
  return (
    <p className="mt-3 text-[13px]" data-testid="swap-sell-check">
      <a href="#sell-check" className="hover:underline">
        <span className="text-muted">Sell check:</span> <span className={label.tone === "ember" ? "down" : label.tone === "lime" ? "up" : "text-warn"}>{label.text}</span>
        <span className="text-muted">{taxes}</span>
      </a>
    </p>
  );
}
