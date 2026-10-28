"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { BRAND, chartUrl, explorerAddress, explorerToken, shortAddress } from "@/config/brand";
import { ASSETS } from "@/config/assets";
import { Candles } from "@/components/trade/Candles";
import { SwapPreview } from "@/components/coin/SwapPreview";
import { CardHead, Change, Loading, NOT_ADVICE, Problem, Src } from "@/components/ui/kit";
import { Tok } from "@/components/ui/Tok";
import { StarIcon } from "@/components/site/Icons";
import { useMarket } from "@/components/providers/MarketProvider";
import { SOURCE_NAME, type Candle, type PoolRow, type Trade } from "@/lib/market";
import { marketChecks, type Check, type TokenFacts } from "@/lib/tokencheck";
import { useWatch } from "@/lib/stores";
import { useJson } from "@/lib/useJson";
import { age, ago, amount, int, price, usdShort } from "@/lib/format";

export type TokenAnswer = { address: string; kind: string; native: boolean; facts: TokenFacts | null; pools: PoolRow[]; poolsAt: number; poolsStale: boolean; checks: Check[]; at: number };
type PoolAnswer = { pool: PoolRow | null; trades: Trade[]; candles: Candle[]; at: number; stale: boolean };

const TFS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;

function CheckList({ checks }: { checks: Check[] }) {
  return (
    <ul>
      {checks.map((c) => (
        <li key={c.id} className={`fq-check ${c.level}`} data-testid={`check-${c.id}`}>
          <i aria-hidden="true" />
          <div>
            <p className="text-[14px] text-fg">
              {c.title} <span className="sr-only">({c.level})</span>
            </p>
            <p className="fq-note mt-1">{c.detail}</p>
            <p className="mt-1">
              <Src>Source: {c.source}</Src>
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ChecksCard({ token, pools }: { token: TokenAnswer | null; pools: PoolRow[] }) {
  // When the pool index could not be read (public API busy), market checks wait instead of reporting "no pool".
  const busy = Boolean(token?.poolsStale) && pools.length === 0;
  const all = useMemo(
    () =>
      token
        ? [
            ...token.checks,
            ...(busy
              ? [{ id: "busy", level: "note" as const, title: "Market checks pending", detail: "The pool index for this token could not be read just now (the public data source is busy). Market checks appear on the next read, within two minutes.", source: "GeckoTerminal pools" }]
              : marketChecks(pools)),
          ]
        : [],
    [token, pools, busy],
  );
  const n = { flag: all.filter((c) => c.level === "flag").length, note: all.filter((c) => c.level === "note").length, ok: all.filter((c) => c.level === "ok").length };
  const total = Math.max(1, all.length);
  return (
    <section className="fq-card" aria-labelledby="checks-title">
      <CardHead id="checks-title" title="Token checks" tag="contract + market">
        <span className="up">{n.ok} read</span>
        <span className="text-warn">{n.note} to note</span>
        <span className="down">{n.flag} to look at</span>
      </CardHead>
      <div className="px-8 pt-4 max-[680px]:px-4">
        <div className="flex h-2 overflow-hidden rounded-full bg-sunk" aria-hidden="true">
          <span style={{ width: `${(n.ok / total) * 100}%`, background: "var(--lime)" }} />
          <span style={{ width: `${(n.note / total) * 100}%`, background: "var(--warn)" }} />
          <span style={{ width: `${(n.flag / total) * 100}%`, background: "var(--ember)" }} />
        </div>
      </div>
      <div className="fq-card-body pt-2">
        {!token ? <Loading label="Reading the contract…" /> : <CheckList checks={all} />}
        <p className="fq-note mt-3 border-t border-line pt-3">
          Checks state what the contract code and the pools show at block {token?.facts?.block ?? "—"}. A contract owner can change behaviour later, and finding nothing is not a guarantee. {NOT_ADVICE}
        </p>
        {token?.facts ? (
          <dl className="mt-4 grid gap-x-8 sm:grid-cols-2">
            <div className="fq-kv">
              <dt>Code size</dt>
              <dd>{int(token.facts.codeSize)} bytes</dd>
            </div>
            <div className="fq-kv">
              <dt>owner()</dt>
              <dd>{token.facts.owner === null ? "no owner()" : token.facts.owner === "renounced" ? "zero address" : <a href={explorerAddress(token.facts.owner)} target="_blank" rel="noreferrer" className="underline">{shortAddress(token.facts.owner)}</a>}</dd>
            </div>
            <div className="fq-kv">
              <dt>Total supply</dt>
              <dd>{token.facts.totalSupply && token.facts.decimals !== null ? amount(Number(token.facts.totalSupply) / 10 ** token.facts.decimals) : "—"}</dd>
            </div>
            <div className="fq-kv">
              <dt>Proxy</dt>
              <dd>{token.facts.proxy ? "yes (EIP-1967)" : "no proxy slot set"}</dd>
            </div>
            <div className="fq-kv">
              <dt>Top holders</dt>
              <dd title="Holder lists need an indexer; Fliqo does not guess them.">—</dd>
            </div>
            <div className="fq-kv">
              <dt>Explorer</dt>
              <dd>
                <a href={explorerToken(token.address)} target="_blank" rel="noreferrer" className="underline">
                  Blockscout ↗
                </a>
              </dd>
            </div>
          </dl>
        ) : null}
      </div>
    </section>
  );
}

function ChartCard({ pool }: { pool: PoolRow | null }) {
  const [tf, setTf] = useState<(typeof TFS)[number]>("1h");
  const { data, error, loading } = useJson<PoolAnswer>(pool ? `/api/pool/${pool.address}?tf=${tf}` : null, 60_000);
  const candles = data?.candles ?? [];
  return (
    <section className="fq-card" aria-label="Chart">
      <CardHead title={<>Chart <span className="text-[12px] font-normal text-muted">{SOURCE_NAME} candles · prices in USD</span></>}>
        <span className="fq-pill lime h-7">
          <span className="fq-live-dot" aria-hidden="true" />
          Live
        </span>
      </CardHead>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 sm:px-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Timeframe">
          {TFS.map((t) => (
            <button key={t} type="button" className="fq-chip" aria-pressed={tf === t} onClick={() => setTf(t)}>
              {t}
            </button>
          ))}
        </div>
        <span className="text-[12px] text-muted">{candles.length ? `${candles.length} candles` : ""}</span>
      </div>
      <div className="px-2 pt-2 pb-2">
        {!pool ? <p className="fq-note p-6">No pool to chart yet.</p> : loading && !data ? <Loading label="Loading candles…" /> : error && !data ? <Problem>{error}</Problem> : <Candles candles={candles} ma={false} tf={tf} />}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-8 py-4 text-[13px] text-muted max-[680px]:px-4">
        <span>
          Spot <b className="text-fg">{price(data?.pool?.priceUsd ?? pool?.priceUsd)}</b>
        </span>
        <span>Updated {ago(data?.at)}</span>
        {pool && chartUrl(pool.address) ? (
          <a href={chartUrl(pool.address)!} target="_blank" rel="noreferrer" className="ml-auto hover:text-fg">
            Full chart on DEXTools ↗
          </a>
        ) : null}
      </div>
    </section>
  );
}

function PoolsCard({ pools, busy }: { pools: PoolRow[]; busy: boolean }) {
  return (
    <section className="fq-card" aria-label="Pools">
      <CardHead title="Pools" tag={`${pools.length} listed`}>
        <span>{SOURCE_NAME} index for this token</span>
      </CardHead>
      {pools.length ? (
        <div className="fq-scroll">
          <table className="fq-table">
            <thead>
              <tr>
                <th>Venue</th>
                <th>Pair</th>
                <th className="num">Liquidity</th>
                <th className="num">Vol 24h</th>
                <th className="num fq-hide-680">Swaps 24h</th>
                <th className="num fq-hide-680">Age</th>
                <th className="num">Compare</th>
              </tr>
            </thead>
            <tbody>
              {pools.map((p) => (
                <tr key={p.address}>
                  <td>
                    <span className="fq-tag text-text-2">{p.venueLabel}</span>
                  </td>
                  <td className="text-muted">
                    {p.base.symbol} / {p.quote.symbol}
                    {p.feeLabel ? ` · ${p.feeLabel}` : ""}
                  </td>
                  <td className="num">{usdShort(p.liquidityUsd)}</td>
                  <td className="num">{usdShort(p.volume24h)}</td>
                  <td className="num fq-hide-680">{int(p.txns24h)}</td>
                  <td className="num fq-hide-680 text-muted">{age(p.createdAt)}</td>
                  <td className="num">
                    <Link href={`/compare?mode=pools&a=${p.address}`} className="text-lime hover:underline">
                      Compare
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="fq-note px-8 py-6">{busy ? "The pool index is busy right now; it is read again within two minutes." : "No pool holds this token in the index right now."}</p>
      )}
    </section>
  );
}

function TapeCard({ pool, symbol }: { pool: PoolRow | null; symbol: string }) {
  const { data } = useJson<PoolAnswer>(pool ? `/api/pool/${pool.address}?tf=1h` : null, 45_000);
  const trades = (data?.trades ?? []).slice(0, 8);
  return (
    <section className="fq-card" aria-label={`Tape for ${symbol}`}>
      <CardHead title={`Tape · $${symbol}`} tag={SOURCE_NAME} />
      <ul>
        {trades.map((t) => (
          <li key={`${t.tx}-${t.fromToken}`} className="flex flex-wrap items-center gap-3 border-b border-line px-8 py-3 last:border-0 max-[680px]:px-4">
            <span className="fq-tag text-fg">${symbol}</span>
            <span className="text-[14px] text-muted">
              {shortAddress(t.wallet, 4, 4)} <span className={t.side === "buy" ? "up" : "down"}>{t.side === "buy" ? "bought" : "sold"}</span> <span className="text-text-2">{usdShort(t.volumeUsd)}</span>
            </span>
            <span className="ml-auto text-[12px] text-muted">{ago(t.time)}</span>
          </li>
        ))}
        {!trades.length ? <li className="fq-note px-8 py-6">No recent swaps read for the main pool.</li> : null}
      </ul>
    </section>
  );
}

export function CoinView({ address }: { address: string }) {
  const { data: token, error } = useJson<TokenAnswer>(`/api/token/${address}`, 120_000);
  const { has, toggle } = useWatch();
  const { byAddress } = useMarket();
  const pools = token?.pools ?? [];
  const main = pools[0] ?? null;
  // The market board already knows the busiest tokens: their numbers fill the header while the pool index loads.
  const row = byAddress.get(address) ?? null;
  const symbol = token?.facts?.symbol ?? main?.base.symbol ?? shortAddress(address, 4, 4);
  const name = token?.facts?.name ?? main?.base.name ?? "";
  const liq = pools.reduce((s, p) => s + (p.liquidityUsd ?? 0), 0);
  // A Pons coin (still on its curve or graduated): from its pools, or from the market board while the index loads.
  const pons = pools.some((p) => p.venue.startsWith("pons")) || (!pools.length && /pons/i.test(row?.venueLabel ?? ""));
  const tokenRef = { address, symbol, logo: main?.base.address === address ? main.base.logo : null };

  return (
    <div className="fq-wrap pt-12">
      {error && !token ? (
        <div className="fq-card p-8 text-center">
          <img src={ASSETS.lens} alt="" width={160} height={160} className="mx-auto h-40 w-40" />
          <Problem>{error}</Problem>
        </div>
      ) : null}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-5">
          <section className="fq-card p-8 max-[680px]:p-5" aria-labelledby="coin-title">
            <div className="flex flex-wrap items-center gap-4">
              <Tok t={tokenRef} size={46} />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 id="coin-title" className="text-[26px] font-normal text-fg">
                    ${symbol}
                  </h1>
                  {main ? <span className="fq-tag text-fg">{main.venueLabel}</span> : null}
                  {main ? <span className="fq-tag text-fg">{main.quote.symbol} pair</span> : null}
                </div>
                <p className="mt-1 truncate text-[13px] text-muted">
                  {name ? `${name} · ` : ""}
                  <a href={explorerToken(address)} target="_blank" rel="noreferrer" className="hover:text-fg">
                    {shortAddress(address, 4, 4)}
                  </a>
                </p>
              </div>
              <button type="button" onClick={() => toggle(address)} aria-pressed={has(address)} className={`fq-btn quiet ml-auto ${has(address) ? "text-lime" : ""}`} data-testid="watch-toggle">
                <StarIcon size={14} /> {has(address) ? "Watching" : "Watch"}
              </button>
            </div>
            <dl className="mt-6 grid grid-cols-2 gap-x-10 gap-y-4 sm:grid-cols-4">
              {[
                { k: "Price", v: price(main?.priceUsd ?? row?.priceUsd) },
                { k: "24h", v: <Change v={main?.change24h ?? row?.change24h} /> },
                { k: "Market cap", v: usdShort(main?.marketCapUsd ?? main?.fdvUsd ?? row?.marketCapUsd ?? row?.fdvUsd) },
                { k: "Liquidity", v: usdShort(pools.length ? liq : row?.liquidityUsd) },
              ].map((s) => (
                <div key={s.k}>
                  <dt className="fq-label">{s.k}</dt>
                  <dd className="mt-2 text-[20px] font-light text-fg">{s.v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4">
              <Src>
                Price, change and market cap: {SOURCE_NAME}, most liquid pool{main?.marketCapUsd === null && main?.fdvUsd !== null ? " (FDV shown: no circulating figure)" : ""}. Liquidity: sum over {pools.length} listed pool{pools.length === 1 ? "" : "s"}.
              </Src>
            </p>
          </section>
          <ChartCard pool={main} />
          <ChecksCard token={token} pools={pools} />
          <PoolsCard pools={pools} busy={Boolean(token?.poolsStale) && !pools.length} />
          <TapeCard pool={main} symbol={symbol} />
        </div>
        <aside className="lg:sticky lg:top-[120px]">
          <SwapPreview token={address} symbol={symbol} decimals={token?.facts?.decimals ?? main?.base.decimals ?? null} priceUsd={main?.priceUsd ?? row?.priceUsd ?? null} pons={pons} pool={main} />
          <p className="fq-note mt-4">
            {BRAND.name} never routes or holds funds. The swap itself happens in your wallet on {pons ? "Pons" : "the DEX"}.
          </p>
        </aside>
      </div>
    </div>
  );
}
