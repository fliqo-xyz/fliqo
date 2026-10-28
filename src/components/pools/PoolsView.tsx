"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CardHead, Change, Loading, NOT_ADVICE, Problem, Src } from "@/components/ui/kit";
import { SOURCE_NAME, isPoolAddress } from "@/lib/market";
import type { Overview } from "@/lib/server/market";
import { useJson } from "@/lib/useJson";
import { ago, int, usdShort } from "@/lib/format";

function Bars({ rows }: { rows: { label: string; value: number; sub: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="flex flex-col gap-4">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex justify-between gap-3 text-[13px]">
            <span className="text-fg">{r.label}</span>
            <span className="text-muted">
              {usdShort(r.value)} · {r.sub}
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunk">
            <span className="block h-full rounded-full bg-lime" style={{ width: `${Math.max(1, (r.value / max) * 100)}%`, opacity: 0.85 }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function PoolsView() {
  const { data, error, loading } = useJson<Overview>("/api/overview", 120_000);
  const router = useRouter();
  const [pool, setPool] = useState("");
  const [bad, setBad] = useState(false);
  return (
    <div className="fq-wrap pt-12">
      <section className="fq-card grid gap-8 p-10 lg:grid-cols-[minmax(0,1fr)_380px] max-[680px]:p-6" aria-labelledby="pools-title">
        <div>
          <p className="fq-kicker">Where the liquidity sits</p>
          <h1 id="pools-title" className="mt-4 text-[48px] leading-[1.05] font-light tracking-tight text-fg max-[680px]:text-[34px]">
            Pools
            <span className="block text-muted">{data ? usdShort(data.liquidityUsd) : "—"}</span>
          </h1>
          <p className="fq-note mt-5 max-w-[560px] text-[15px]">Liquidity decides how far a trade moves the price. This page adds up every pool the public lists know right now on Robinhood Chain, split by venue and by what each pool is paired with.</p>
        </div>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-6 self-center">
          {[
            { k: "Pools read", v: data ? int(data.pools) : "—" },
            { k: "Volume 24h", v: data ? usdShort(data.volume24h) : "—" },
            { k: "Swaps 24h", v: data ? int(data.txns24h) : "—" },
            { k: "Venues", v: data ? int(data.venues.length) : "—" },
          ].map((s) => (
            <div key={s.k}>
              <dt className="fq-label">{s.k}</dt>
              <dd className="mt-2 text-[22px] font-light text-fg">{s.v}</dd>
            </div>
          ))}
        </dl>
      </section>
      {loading && !data ? <Loading label="Adding up the pool lists…" /> : null}
      {error && !data ? <Problem>{error}</Problem> : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="fq-card" aria-label="Liquidity by venue">
          <CardHead title="Liquidity by venue" tag={SOURCE_NAME}>
            <span>{data ? `${data.venues.length} venues` : ""}</span>
          </CardHead>
          <div className="fq-card-body">
            {data ? <Bars rows={data.venues.slice(0, 8).map((v) => ({ label: v.label, value: v.liquidityUsd, sub: `${v.pools} pools · ${usdShort(v.volume24h)} vol` }))} /> : null}
          </div>
        </section>
        <section className="fq-card" aria-label="Paired with">
          <CardHead title="What pools are paired with" tag={SOURCE_NAME} />
          <div className="fq-card-body">
            {data ? <Bars rows={data.pairedWith.map((p) => ({ label: p.label, value: p.liquidityUsd, sub: `${p.pools} pools` }))} /> : null}
            <form
              className="mt-8 border-t border-line pt-6"
              onSubmit={(e) => {
                e.preventDefault();
                const v = pool.trim().toLowerCase();
                if (!isPoolAddress(v)) return setBad(true);
                setBad(false);
                router.push(`/compare?mode=pools&a=${v}`);
              }}
            >
              <label className="fq-label" htmlFor="pool-open">
                Open a pool
              </label>
              <div className="mt-2 flex gap-2">
                <input id="pool-open" className="fq-input flex-1 rounded-full px-4" value={pool} onChange={(e) => setPool(e.target.value)} placeholder="Pool address or v4 pool id" spellCheck={false} />
                <button type="submit" className="fq-btn arrow">
                  Compare
                </button>
              </div>
              {bad ? <p className="mt-2 text-[13px] text-down">That is not a pool address (0x + 40 hex) or a v4 pool id (0x + 64 hex).</p> : null}
            </form>
          </div>
        </section>
      </div>

      <section className="fq-card mt-6" aria-label="Deepest pools">
        <CardHead title="Deepest pools" tag={SOURCE_NAME}>
          <span>{data ? `updated ${ago(data.at)}${data.stale ? " · delayed" : ""}` : ""}</span>
        </CardHead>
        <div className="fq-scroll">
          <table className="fq-table" data-testid="deep-pools">
            <thead>
              <tr>
                <th>Pool</th>
                <th>Venue</th>
                <th className="num">Liquidity</th>
                <th className="num">Vol 24h</th>
                <th className="num fq-hide-680">24h</th>
                <th className="num">Open</th>
              </tr>
            </thead>
            <tbody>
              {(data?.deepest ?? []).map((p) => (
                <tr key={p.address}>
                  <td className="text-fg">
                    <Link href={`/coin/${p.base.address}`} className="hover:underline">
                      {p.base.symbol} / {p.quote.symbol}
                    </Link>
                    {p.feeLabel ? <span className="ml-2 text-[12px] text-muted">{p.feeLabel}</span> : null}
                  </td>
                  <td>
                    <span className="fq-tag text-text-2">{p.venueLabel}</span>
                  </td>
                  <td className="num">{usdShort(p.liquidityUsd)}</td>
                  <td className="num">{usdShort(p.volume24h)}</td>
                  <td className="num fq-hide-680">
                    <Change v={p.change24h} />
                  </td>
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
      </section>

      <div className="mt-6 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {[
          { t: "Source", d: `Pool lists of ${SOURCE_NAME} for Robinhood Chain: the busiest pools, trending pools and new pools, read on the server and cached for three minutes.` },
          { t: "Coverage", d: "Only pools on those lists are counted. A quiet pool that is on none of them is not in these totals, so the real chain total is higher." },
          { t: "Freshness", d: "Lists refresh every few minutes. When the public API is busy, the last answer is shown and marked as delayed rather than left blank." },
          { t: "What it is not", d: "Liquidity is what sits in a pool now. It is not volume, not a price target and can leave a pool at any time." },
        ].map((c) => (
          <section key={c.t} className="fq-card p-6">
            <h2 className="text-[14px] text-fg">{c.t}</h2>
            <p className="fq-note mt-2">{c.d}</p>
          </section>
        ))}
      </div>
      <p className="mt-6">
        <Src>{NOT_ADVICE}</Src>
      </p>
    </div>
  );
}
