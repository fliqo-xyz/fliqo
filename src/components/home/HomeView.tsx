"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { BRAND, shortAddress } from "@/config/brand";
import { ASSETS } from "@/config/assets";
import { useOpenToken } from "@/components/shell/Shell";
import { useChain } from "@/components/providers/ChainProvider";
import { useMarket } from "@/components/providers/MarketProvider";
import { CardHead, Change, Loading, NOT_ADVICE, Problem, Src } from "@/components/ui/kit";
import { Tok } from "@/components/ui/Tok";
import { StarIcon } from "@/components/site/Icons";
import { NATIVE, SOURCE_NAME, type TokenRow } from "@/lib/market";
import type { TapeItem } from "@/lib/server/market";
import { useWatch } from "@/lib/stores";
import { useJson } from "@/lib/useJson";
import { ago, amount, usdShort } from "@/lib/format";

const POINTS = [
  { t: "Any token", d: "paste a contract address: checks, pools and a swap route preview" },
  { t: "Flip the view", d: "two tokens or two pools side by side, on one chart" },
  { t: "No custody", d: "Fliqo reads and quotes; your own wallet makes the swap" },
];

function Hero() {
  const { value, setValue, error, submit } = useOpenToken();
  return (
    <section className="fq-card fq-hero" aria-labelledby="hero-title">
      <div className="fq-hero-art" style={{ backgroundImage: `url(${ASSETS.heroGrid})` }} aria-hidden="true" />
      <p className="fq-kicker relative text-fg">Trading intelligence · {BRAND.chainName}</p>
      <h1 id="hero-title">
        {BRAND.slogan}
        <span>{BRAND.tagline}</span>
      </h1>
      <p className="lead">Find a token, read what its contract allows, line it up against another market and see the exact route, fee and price impact before you sign anything in your own wallet.</p>
      <form className="fq-ca-box" onSubmit={submit} role="search">
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Paste any token contract address" aria-label="Token contract address" spellCheck={false} data-testid="hero-ca" />
        <button type="submit" className="fq-btn arrow">
          Open token
        </button>
      </form>
      {error ? (
        <p className="relative mt-3 text-[13px] text-down" role="alert">
          {error}
        </p>
      ) : null}
      <dl className="fq-hero-points">
        {POINTS.map((p) => (
          <div key={p.t}>
            <dt>{p.t}</dt>
            <dd>{p.d}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function sideTag(side: "buy" | "sell") {
  return <span className={`fq-tag ${side === "buy" ? "lime" : "ember"}`}>● {side}</span>;
}

function LiveSwaps({ items, error }: { items: TapeItem[] | null; error: string | null }) {
  const router = useRouter();
  const rows = (items ?? []).slice(0, 6);
  const buys = rows.filter((r) => r.side === "buy").length;
  const vol = rows.reduce((s, r) => s + (r.volumeUsd ?? 0), 0);
  return (
    <section className="fq-card mt-20" aria-labelledby="swaps-title">
      <CardHead id="swaps-title" title={<><span className="fq-live-dot" aria-hidden="true" />Live swaps</>} tag={SOURCE_NAME}>
        <span>
          <b className="text-fg">{rows.length}</b> latest · {buys} buys / {rows.length - buys} sells
        </span>
        <span>
          size <b className="text-fg">{usdShort(rows.length ? vol : null)}</b>
        </span>
      </CardHead>
      {items === null && !error ? <div className="fq-card-body"><Loading label="Reading the busiest pools…" /></div> : null}
      {error && !items ? <div className="fq-card-body"><Problem>{error}</Problem></div> : null}
      {items && !rows.length ? <p className="fq-note px-8 py-6">No swaps read yet: the public data source is busy. Retrying every 45 seconds.</p> : null}
      {rows.length ? (
        <div className="fq-scroll">
          <table className="fq-table" data-testid="live-swaps">
            <thead>
              <tr>
                <th>Coin</th>
                <th>Wallet</th>
                <th>Side</th>
                <th className="num">Size</th>
                <th className="num fq-hide-680">Amount</th>
                <th className="fq-hide-960">Pool</th>
                <th className="num">When</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={`${t.tx}-${t.fromToken}`} className="click fresh" onClick={() => router.push(`/coin/${t.base.address}`)}>
                  <td>
                    <Link href={`/coin/${t.base.address}`} className="fq-tag text-fg">
                      ${t.base.symbol}
                    </Link>
                  </td>
                  <td className="text-muted">{shortAddress(t.wallet, 4, 4)}</td>
                  <td>{sideTag(t.side)}</td>
                  <td className="num">{usdShort(t.volumeUsd)}</td>
                  <td className="num fq-hide-680">{amount(t.side === "buy" ? t.toAmount : t.fromAmount)}</td>
                  <td className="fq-hide-960 text-muted">{t.poolName}</td>
                  <td className="num text-[12px] text-muted">{ago(t.time)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

type Filter = "all" | "pons" | "uniswap" | "stock" | "watch";
type Sort = "mc" | "move" | "liq" | "vol" | "new";
const FILTERS: { k: Filter; label: string }[] = [
  { k: "all", label: "All" },
  { k: "pons", label: "Pons" },
  { k: "uniswap", label: "Uniswap" },
  { k: "stock", label: "Stock pairs" },
  { k: "watch", label: "Watchlist" },
];

function MarketCard({ t, starred, onStar }: { t: TokenRow; starred: boolean; onStar: () => void }) {
  const thin = (t.liquidityUsd ?? 0) < 5_000;
  const cap = t.marketCapUsd ?? t.fdvUsd;
  return (
    <article className="fq-mcard" data-testid="market-card">
      <div className="flex items-start gap-3">
        <Tok t={t} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <Link href={`/coin/${t.address}`} className="truncate text-[16px] font-medium text-fg hover:underline">
              ${t.symbol}
            </Link>
            <Change v={t.change24h} className="text-[13px]" />
          </div>
          <p className="mt-1 truncate border-t border-line pt-1 text-[12px] text-muted">
            {t.venueLabel ?? "—"}
            {t.pair ? ` · ${t.pair} pair` : ""}
          </p>
        </div>
      </div>
      <div className="big">
        {usdShort(cap)}
        <small>{t.marketCapUsd !== null ? "MC" : "FDV"}</small>
      </div>
      <div className="flex items-center justify-between gap-2 text-[12px] text-muted">
        <span>{usdShort(t.liquidityUsd)} liq</span>
        <span>{usdShort(t.volume24h)} vol 24h</span>
      </div>
      <div className="mt-auto flex gap-2">
        {thin ? (
          <Link href={`/coin/${t.address}`} className="fq-side review flex-1 text-muted">
            too thin · review only
          </Link>
        ) : (
          <>
            <Link href={`/coin/${t.address}`} className="fq-side review flex-1">
              Review
            </Link>
            <Link href={`/compare?a=${t.address}`} className="fq-side flip flex-1">
              Compare
            </Link>
          </>
        )}
        <button type="button" onClick={onStar} aria-pressed={starred} aria-label={starred ? `Remove $${t.symbol} from the watchlist` : `Add $${t.symbol} to the watchlist`} className={`fq-side review px-3 ${starred ? "text-lime" : ""}`}>
          <StarIcon size={14} />
        </button>
      </div>
    </article>
  );
}

function Markets() {
  const { data, error, loading } = useMarket();
  const { facts } = useChain();
  const { has, toggle, watch } = useWatch();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("mc");
  const [limit, setLimit] = useState(48);
  const tokens = useMemo(() => {
    // ETH, WETH and USDG are the hubs every pool trades against; the grid lists the tokens traded against them.
    let list = (data?.tokens ?? []).filter((t) => t.address !== NATIVE && t.kind !== "crypto");
    const s = q.trim().toLowerCase();
    if (s) list = list.filter((t) => t.symbol.toLowerCase().includes(s) || t.name.toLowerCase().includes(s) || t.address.includes(s));
    if (filter === "pons") list = list.filter((t) => /pons/i.test(t.venueLabel ?? ""));
    if (filter === "uniswap") list = list.filter((t) => /uniswap/i.test(t.venueLabel ?? ""));
    if (filter === "stock") list = list.filter((t) => t.kind === "stock" || /^(NVDA|TSLA|AAPL|QQQ|SPY|AMZN|MSFT|META|GOOGL|TTWO|AMD|COIN|HOOD)$/.test(t.pair ?? ""));
    if (filter === "watch") list = list.filter((t) => watch.tokens.includes(t.address));
    const key: Record<Sort, (t: TokenRow) => number> = {
      mc: (t) => t.marketCapUsd ?? t.fdvUsd ?? -1,
      move: (t) => Math.abs(t.change24h ?? 0),
      liq: (t) => t.liquidityUsd ?? -1,
      vol: (t) => t.volume24h ?? -1,
      new: (t) => t.createdAt ?? 0,
    };
    return [...list].sort((a, b) => key[sort](b) - key[sort](a));
  }, [data, q, filter, sort, watch.tokens]);

  return (
    <section className="fq-section" aria-labelledby="markets-title">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="fq-kicker">Markets · live</p>
          <h2 id="markets-title" className="fq-h2 mt-2">
            Every token with real liquidity. <span>Read from the pools every minute.</span>
          </h2>
        </div>
        <span className="fq-pill lime">
          <span className="fq-live-dot" aria-hidden="true" />
          Live · ETH {facts?.ethUsd ? usdShort(facts.ethUsd) : "—"}
        </span>
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <label className="fq-search min-w-[220px] flex-1">
          <span className="sr-only">Search</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, ticker or contract" data-testid="market-search" />
        </label>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter">
          {FILTERS.map((f) => (
            <button key={f.k} type="button" className="fq-chip" aria-pressed={filter === f.k} onClick={() => setFilter(f.k)}>
              {f.label}
            </button>
          ))}
        </div>
        <select className="fq-input h-[40px] rounded-full px-4" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort by">
          <option value="mc">Market cap</option>
          <option value="move">Biggest 24h move</option>
          <option value="liq">Liquidity</option>
          <option value="vol">Volume 24h</option>
          <option value="new">Newest</option>
        </select>
      </div>
      <p className="mt-3">
        <Src>
          Source: {SOURCE_NAME} pool lists for Robinhood Chain{data ? ` · updated ${ago(data.at)}${data.stale ? " · delayed" : ""}` : ""}. Market cap falls back to fully diluted value (FDV) when no circulating figure is published.
        </Src>
      </p>
      {loading && !data ? <Loading label="Reading the market lists…" /> : null}
      {error && !data ? <Problem>{error}</Problem> : null}
      {data && !tokens.length ? <p className="fq-note py-8">Nothing matches. {filter === "watch" ? "Star a token to add it to your watchlist." : "Try another filter or paste a contract address above."}</p> : null}
      <div className="fq-mgrid mt-6">
        {tokens.slice(0, limit).map((t) => (
          <MarketCard key={t.address} t={t} starred={has(t.address)} onStar={() => toggle(t.address)} />
        ))}
      </div>
      {tokens.length > limit ? (
        <div className="mt-6 text-center">
          <button type="button" className="fq-btn quiet" onClick={() => setLimit((n) => n + 48)}>
            Show more ({tokens.length - limit})
          </button>
        </div>
      ) : null}
    </section>
  );
}

function Movers({ items }: { items: TapeItem[] | null }) {
  const { data } = useMarket();
  const [dir, setDir] = useState<"up" | "down">("up");
  const list = (dir === "up" ? data?.gainers : data?.losers) ?? [];
  const big = [...(items ?? [])].sort((a, b) => (b.volumeUsd ?? 0) - (a.volumeUsd ?? 0)).slice(0, 5);
  return (
    <section id="movers" className="fq-section scroll-mt-28" aria-label="Movers">
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="fq-card min-w-0">
          <CardHead title="Movers" tag="24h">
            <button type="button" className="fq-chip" aria-pressed={dir === "up"} onClick={() => setDir("up")}>
              Gainers
            </button>
            <button type="button" className="fq-chip" aria-pressed={dir === "down"} onClick={() => setDir("down")}>
              Losers
            </button>
          </CardHead>
          {list.length ? (
            <ol>
              {list.map((t, i) => (
                <li key={t.address} className="flex flex-wrap items-center gap-3 border-b border-line px-8 py-3 last:border-0 max-[680px]:px-4">
                  <span className="grid h-6 w-6 place-items-center rounded-full border border-[var(--lime-line)] text-[12px] text-lime">{i + 1}</span>
                  <Link href={`/coin/${t.address}`} className="text-fg hover:underline">
                    ${t.symbol}
                  </Link>
                  <span className="truncate text-[12px] text-muted">{t.venueLabel}</span>
                  <span className="ml-auto text-[14px]">
                    <Change v={t.change24h} />
                  </span>
                  <span className="text-[12px] text-muted">{usdShort(t.liquidityUsd)} liq</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="fq-note px-8 py-6">No movers above $25K liquidity right now.</p>
          )}
        </div>
        <div className="fq-card min-w-0">
          <CardHead title="Biggest swaps" tag="latest">
            <span>busiest pools</span>
          </CardHead>
          {big.length ? (
            <ol>
              {big.map((t, i) => (
                <li key={`${t.tx}-${i}`} className="flex flex-wrap items-center gap-3 border-b border-line px-8 py-3 last:border-0 max-[680px]:px-4">
                  <span className="grid h-6 w-6 place-items-center rounded-full border border-[var(--lime-line)] text-[12px] text-lime">{i + 1}</span>
                  <Link href={`/coin/${t.base.address}`} className="fq-tag text-fg">
                    ${t.base.symbol}
                  </Link>
                  <span className="text-[13px] text-muted">{shortAddress(t.wallet, 4, 4)}</span>
                  <span className={t.side === "buy" ? "up text-[13px]" : "down text-[13px]"}>{t.side}</span>
                  <span className="ml-auto text-[13px] text-fg">{usdShort(t.volumeUsd)}</span>
                  <span className="text-[12px] text-muted">{ago(t.time)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="fq-note px-8 py-6">Waiting for swaps…</p>
          )}
        </div>
      </div>
      <div className="fq-card mt-20">
        <CardHead title="Tape" tag={SOURCE_NAME}>
          <span>every swap of the busiest pools, live</span>
        </CardHead>
        <ul data-testid="tape">
          {(items ?? []).slice(0, 10).map((t, i) => (
            <li key={`${t.tx}-${i}`} className="flex flex-wrap items-center gap-3 border-b border-line px-8 py-3 last:border-0 max-[680px]:px-4">
              <Link href={`/coin/${t.base.address}`} className="fq-tag text-fg">
                ${t.base.symbol}
              </Link>
              <span className="text-[14px] text-muted">
                {shortAddress(t.wallet, 4, 4)} <span className="text-text-2">{t.side === "buy" ? "bought" : "sold"}</span>{" "}
                <span className={t.side === "buy" ? "up" : "down"}>{amount(t.side === "buy" ? t.toAmount : t.fromAmount)}</span> <span className="text-text-2">for {usdShort(t.volumeUsd)}</span>
              </span>
              <span className="ml-auto text-[12px] text-muted">{ago(t.time)}</span>
            </li>
          ))}
          {!items?.length ? <li className="fq-note px-8 py-6">Waiting for swaps…</li> : null}
        </ul>
      </div>
      <p className="fq-note mt-6">
        {NOT_ADVICE} Swaps and sizes: {SOURCE_NAME} trades of the busiest pools on {BRAND.chainName}.
      </p>
    </section>
  );
}

export function HomeView() {
  const { data, error } = useJson<{ items: TapeItem[] }>("/api/tape", 45_000);
  return (
    <div className="fq-wrap pt-14">
      <Hero />
      <LiveSwaps items={data?.items ?? null} error={error} />
      <Markets />
      <Movers items={data?.items ?? null} />
    </div>
  );
}
