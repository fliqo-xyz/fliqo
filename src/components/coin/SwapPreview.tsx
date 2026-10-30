"use client";

import { useEffect, useMemo, useState } from "react";
import { LAUNCHPAD, chartUrl } from "@/config/brand";
import { useChain } from "@/components/providers/ChainProvider";
import { Loading, Problem, Src } from "@/components/ui/kit";
import { SellCheckLine } from "@/components/coin/SellCheck";
import { NATIVE, type PoolRow } from "@/lib/market";
import { costPct, minReceived, type RouteQuote } from "@/lib/routes";
import { useSlippage } from "@/lib/stores";
import { useJson } from "@/lib/useJson";
import { amount as fmtAmount, pct } from "@/lib/format";
import { feePct, parseUnits, toNumber } from "@/lib/swap";

type CurveQuote = { curve: string; graduated: boolean; feeBps: number | null; amountOut: string | null; midOut: string | null; block: number };
type QuoteAnswer = {
  block: number;
  amountIn: string;
  routes: RouteQuote[];
  tokens: { in: { decimals: number | null; symbol: string | null }; out: { decimals: number | null; symbol: string | null } };
  pons: CurveQuote | null;
  sellOnCurve: boolean;
  at: number;
};

const SLIPS = [50, 100, 300];

/** Read-only route preview for one token against ETH. Nothing here signs or sends anything. */
export function SwapPreview({ token, checkable = false, symbol, decimals, priceUsd, pons, pool }: { token: string; checkable?: boolean; symbol: string; decimals: number | null; priceUsd: number | null; pons: boolean; pool: PoolRow | null }) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [text, setText] = useState("0.01");
  const [debounced, setDebounced] = useState("0.01");
  const [slip, setSlip] = useSlippage();
  const { facts } = useChain();
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(text), 450);
    return () => window.clearTimeout(t);
  }, [text]);

  const inDecimals = side === "buy" ? 18 : decimals;
  const raw = inDecimals === null ? null : parseUnits(debounced, inDecimals);
  const url = raw && raw > 0n ? `/api/quote?in=${side === "buy" ? NATIVE : token}&out=${side === "buy" ? token : NATIVE}&amount=${raw}` : null;
  const { data, error, loading } = useJson<QuoteAnswer>(url, 30_000);

  const routes = useMemo(() => {
    const list: (RouteQuote & { fee: number | null })[] = (data?.routes ?? []).map((r) => ({ ...r, fee: feePct(r) }));
    if (side === "buy" && data?.pons?.amountOut) list.push({ label: "Pons curve · buy simulation", amountOut: data.pons.amountOut, midOut: data.pons.midOut, legs: [], fee: data.pons.feeBps === null ? null : data.pons.feeBps / 100 });
    return list.sort((a, b) => (BigInt(b.amountOut) > BigInt(a.amountOut) ? 1 : -1));
  }, [data, side]);
  const best = routes[0] ?? null;
  const outDec = data?.tokens.out.decimals ?? (side === "buy" ? decimals : 18);
  const outSym = side === "buy" ? `$${symbol}` : "ETH";
  const cost = best ? costPct(best) : null;
  const impact = cost !== null && best?.fee !== null && best?.fee !== undefined ? Math.max(0, cost - best.fee) : null;
  const min = best ? minReceived(BigInt(best.amountOut), slip) : null;

  const ethUsd = facts?.ethUsd ?? null;
  const quick = side === "buy" ? ["0.005", "0.01", "0.05", "0.1"] : ethUsd && priceUsd ? [0.005, 0.01, 0.05, 0.1].map((e) => String(Number(((e * ethUsd) / priceUsd).toPrecision(3)))) : [];
  const openUrl = pons ? LAUNCHPAD.tokenUrl(token) : chartUrl(pool?.address ?? token);

  return (
    <section className="fq-card p-8 max-[680px]:p-5" aria-labelledby="swap-title" data-testid="swap-preview">
      <div className="flex items-center justify-between gap-3">
        <h2 id="swap-title" className="text-[17px] font-normal text-fg">
          Swap route <span className="text-muted">${symbol}</span>
        </h2>
        <span className="fq-tag">read-only</span>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2" role="group" aria-label="Side">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={side === s}
            onClick={() => {
              setSide(s);
              setText(s === "buy" ? "0.01" : quick[1] ?? "1000");
              setDebounced(s === "buy" ? "0.01" : quick[1] ?? "1000");
            }}
            className={`h-11 rounded-lg border text-[15px] transition-colors ${side === s ? (s === "buy" ? "border-[var(--lime-line)] bg-[var(--lime-soft)] text-lime" : "border-[rgba(250,56,18,0.45)] bg-[var(--ember-soft)] text-[var(--ember-text)]") : "border-transparent bg-panel-2 text-muted hover:text-text-2"}`}
          >
            {s === "buy" ? "Buy" : "Sell"}
          </button>
        ))}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <span className="fq-label">Slippage</span>
        <span className="text-[12px] text-muted">min received moves with it</span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {SLIPS.map((s) => (
          <button key={s} type="button" className="fq-chip justify-center" aria-pressed={slip === s} onClick={() => setSlip(s)}>
            {s / 100}%
          </button>
        ))}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <span className="fq-label">You pay</span>
        <span className="text-[12px] text-muted">{side === "buy" ? "ETH" : `$${symbol}`}</span>
      </div>
      <label className="fq-field mt-2">
        <span className="sr-only">Amount</span>
        <input inputMode="decimal" value={text} onChange={(e) => setText(e.target.value.replace(/[^0-9.]/g, ""))} data-testid="swap-amount" />
        <span>{side === "buy" ? "ETH" : symbol.slice(0, 8)}</span>
      </label>
      {quick.length ? (
        <div className="mt-2 grid grid-cols-4 gap-2">
          {quick.map((q) => (
            <button key={q} type="button" className="fq-chip justify-center" aria-pressed={text === q} onClick={() => setText(q)}>
              {q}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-6" aria-live="polite">
        {!url ? <p className="fq-note">{inDecimals === null ? "Token decimals not read yet." : "Enter an amount above zero."}</p> : null}
        {url && loading && !data ? <Loading label="Asking the quoter contracts…" /> : null}
        {url && error ? <Problem>{error}</Problem> : null}
        {data && !best ? (
          <p className="fq-note">
            No route answered for this size.{" "}
            {side === "sell" && data.sellOnCurve ? "Sell quotes on a Pons curve are not read by the quoters; the sell check on this page simulates a small curve sell. Open Pons for the exact amount." : "The pools may be too thin or not on a quoter Fliqo reads (Uniswap v2/v3/v4, Pons curve buys)."}
          </p>
        ) : null}
        {best ? (
          <dl data-testid="swap-rows">
            <div className="fq-kv">
              <dt>Best route</dt>
              <dd>{best.label}</dd>
            </div>
            <div className="fq-kv">
              <dt>Expected out</dt>
              <dd>
                {fmtAmount(toNumber(best.amountOut, outDec))} {outSym}
              </dd>
            </div>
            <div className="fq-kv">
              <dt>Pool fee</dt>
              <dd>{best.fee === null ? "—" : `${best.fee.toFixed(2)}%`}</dd>
            </div>
            <div className="fq-kv">
              <dt>Price impact</dt>
              <dd className={impact !== null && impact > 3 ? "down" : ""}>{impact === null ? "—" : pct(impact).replace("+", "")}</dd>
            </div>
            <div className="fq-kv">
              <dt>Min received ({slip / 100}%)</dt>
              <dd>
                {min === null ? "—" : fmtAmount(toNumber(min.toString(), outDec))} {outSym}
              </dd>
            </div>
            <div className="fq-kv">
              <dt>Routes compared</dt>
              <dd>{routes.length}</dd>
            </div>
          </dl>
        ) : null}
        <SellCheckLine token={checkable ? token : null} />
        {routes.length > 1 ? (
          <details className="mt-3">
            <summary className="cursor-pointer text-[13px] text-muted">Every route</summary>
            <ul className="mt-2">
              {routes.map((r) => (
                <li key={r.label} className="flex justify-between gap-3 border-b border-line py-2 text-[13px] last:border-0">
                  <span className="text-muted">{r.label}</span>
                  <span className="text-fg">{fmtAmount(toNumber(r.amountOut, outDec))}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        {data ? (
          <p className="mt-3">
            <Src>
              Quoted with eth_call at block {data.pons?.block ?? data.block} (Uniswap quoters{side === "buy" && data.pons ? " + the Pons curve's own buy" : ""}). Price impact = cost beyond the current pool price minus the pool fee{best && /hooked/.test(best.label) ? "; a hooked pool may take its own fee inside the hook, which shows up here as impact" : ""}. Not a promise of fill.
            </Src>
          </p>
        ) : null}
      </div>

      {openUrl ? (
        <a href={openUrl} target="_blank" rel="noreferrer" className={`fq-btn big mt-6 ${side === "buy" ? "lime" : "ember"}`} data-testid="swap-open">
          {pons ? "Swap on Pons" : "Open the pool on DEXTools"} ↗
        </a>
      ) : (
        <button type="button" className="fq-btn big mt-6" disabled>
          No venue link for this token
        </button>
      )}
      <p className="fq-note mt-4">Fliqo only reads and quotes. The swap opens on {pons ? "Pons" : "the venue"} and you sign it in your own wallet. Check the numbers there before you confirm. Not financial advice.</p>
    </section>
  );
}
