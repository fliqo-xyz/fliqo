"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { shortAddress } from "@/config/brand";
import { ASSETS } from "@/config/assets";
import { useMarket } from "@/components/providers/MarketProvider";
import type { TokenAnswer } from "@/components/coin/CoinView";
import { CardHead, Change, Loading, NOT_ADVICE, Problem, Src } from "@/components/ui/kit";
import { metricRows, rebase, type Point, type Row, type Side } from "@/lib/compare";
import { NATIVE, SOURCE_NAME, isPoolAddress, type Candle, type PoolRow } from "@/lib/market";
import { marketChecks } from "@/lib/tokencheck";
import { useJson } from "@/lib/useJson";
import { int, pct, price, usdShort } from "@/lib/format";

type Mode = "tokens" | "pools";
type PoolAnswer = { pool: PoolRow | null; candles: Candle[]; at: number; stale: boolean };
const TFS = ["15m", "1h", "4h", "1d"] as const;

function fmt(r: Row, v: number | null) {
  if (v === null) return "—";
  if (r.key === "price") return price(v);
  if (r.kind === "usd") return usdShort(v);
  if (r.kind === "pct") return pct(v, 1);
  if (r.kind === "ratio") return v.toFixed(2);
  return int(v);
}

function Overlay({ points, a, b }: { points: Point[]; a: string; b: string }) {
  const W = 760;
  const H = 300;
  const P = { l: 8, r: 56, t: 14, b: 22 };
  if (points.length < 2) return <p className="fq-note p-8">Not enough shared candles to draw both lines yet.</p>;
  const vals = points.flatMap((p) => [p.a, p.b]).filter((v): v is number => v !== null);
  const lo = Math.min(0, ...vals);
  const hi = Math.max(0, ...vals);
  const span = hi - lo || 1;
  const x = (i: number) => P.l + (i / (points.length - 1)) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - (v - lo) / span) * (H - P.t - P.b);
  const path = (k: "a" | "b") =>
    points
      .map((p, i) => (p[k] === null ? null : `${i === 0 || points[i - 1][k] === null ? "M" : "L"}${x(i).toFixed(1)} ${y(p[k]!).toFixed(1)}`))
      .filter(Boolean)
      .join(" ");
  const ticks = [lo, lo + span / 2, hi];
  const last = points[points.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${a} ${pct(last.a, 1)} and ${b} ${pct(last.b, 1)} since the first shared candle`}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeDasharray="2 4" />
          <text x={W - P.r + 6} y={y(t) + 4} fontSize="11" fill="var(--muted)">
            {pct(t, 1)}
          </text>
        </g>
      ))}
      <line x1={P.l} x2={W - P.r} y1={y(0)} y2={y(0)} stroke="var(--line-2)" />
      <path d={path("b")} fill="none" stroke="var(--steel)" strokeWidth="1.6" />
      <path d={path("a")} fill="none" stroke="var(--lime)" strokeWidth="1.8" />
    </svg>
  );
}

function useSide(mode: Mode, addr: string, tf: string) {
  const { byAddress } = useMarket();
  const isToken = mode === "tokens" && /^0x[0-9a-f]{40}$/.test(addr);
  const token = useJson<TokenAnswer>(isToken ? `/api/token/${addr}` : null, 120_000);
  // The market board already holds the busiest tokens (price, liquidity, main pool): used when the token's own
  // pool index is not available (the public API is busy) so the page still compares real numbers.
  const row = isToken ? byAddress.get(addr) ?? null : null;
  const poolAddr = mode === "pools" ? (isPoolAddress(addr) ? addr : null) : token.data?.pools[0]?.address ?? row?.pool ?? null;
  const pool = useJson<PoolAnswer>(poolAddr ? `/api/pool/${poolAddr}?tf=${tf}` : null, 60_000);
  const p = pool.data?.pool ?? (mode === "tokens" ? token.data?.pools[0] ?? null : null);
  const pools = mode === "tokens" ? token.data?.pools ?? [] : p ? [p] : [];
  const side: Side | null = !p && row
    ? { priceUsd: row.priceUsd, change24h: row.change24h, marketCapUsd: row.marketCapUsd, fdvUsd: row.fdvUsd, liquidityUsd: row.liquidityUsd, volume24h: row.volume24h }
    : p
    ? {
        priceUsd: p.priceUsd,
        change1h: p.change1h,
        change24h: p.change24h,
        marketCapUsd: p.marketCapUsd,
        fdvUsd: p.fdvUsd,
        liquidityUsd: pools.reduce((s, x) => s + (x.liquidityUsd ?? 0), 0),
        volume24h: pools.reduce((s, x) => s + (x.volume24h ?? 0), 0),
        txns24h: pools.reduce((s, x) => s + (x.txns24h ?? 0), 0),
        buys24h: pools.reduce((s, x) => s + (x.buys24h ?? 0), 0),
        sells24h: pools.reduce((s, x) => s + (x.sells24h ?? 0), 0),
      }
    : null;
  const checks = token.data ? [...token.data.checks, ...marketChecks(pools)] : null;
  const label = mode === "tokens" ? (token.data?.facts?.symbol ? `${token.data.facts.symbol}` : p ? `${p.base.symbol}` : row ? `${row.symbol}` : shortAddress(addr || "0x", 4, 4)) : p ? p.name : shortAddress(addr || "0x", 4, 4);
  return { side, candles: pool.data?.candles ?? [], label, pool: p, checks, loading: token.loading || pool.loading, error: token.error ?? pool.error, at: pool.data?.at ?? null };
}

function Picker({ which, mode, value, onChange }: { which: "A" | "B"; mode: Mode; value: string; onChange: (v: string) => void }) {
  const { data } = useMarket();
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setText(value);
  }
  const options = mode === "tokens" ? (data?.tokens ?? []).filter((t) => t.address !== NATIVE).slice(0, 60) : [];
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <span className="fq-label">{which === "A" ? "Market A · lime" : "Market B · steel"}</span>
      <form
        className="fq-search"
        onSubmit={(e) => {
          e.preventDefault();
          onChange(text.trim().toLowerCase());
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={mode === "tokens" ? "Token contract address" : "Pool address or v4 pool id"} aria-label={`Market ${which}`} spellCheck={false} data-testid={`pick-${which}`} />
        <button type="submit" className="text-[12px] text-lime">
          Set
        </button>
      </form>
      {options.length ? (
        <select className="fq-input" value={options.some((o) => o.address === value) ? value : ""} onChange={(e) => e.target.value && onChange(e.target.value)} aria-label={`Pick market ${which} from the list`}>
          <option value="">or pick from the market list…</option>
          {options.map((o) => (
            <option key={o.address} value={o.address}>
              ${o.symbol} · {usdShort(o.marketCapUsd ?? o.fdvUsd)}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}

export function CompareView() {
  const { data: market } = useMarket();
  const [mode, setMode] = useState<Mode>("tokens");
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [tf, setTf] = useState<(typeof TFS)[number]>("1h");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    /* eslint-disable react-hooks/set-state-in-effect */
    setMode(q.get("mode") === "pools" ? "pools" : "tokens");
    setA((q.get("a") ?? "").toLowerCase());
    setB((q.get("b") ?? "").toLowerCase());
    setReady(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // Defaults: the two largest listed tokens (or their main pools) so the page never opens empty.
  useEffect(() => {
    if (!ready || !market) return;
    const top = market.tokens.filter((t) => t.address !== NATIVE && t.kind === "token").sort((x, y) => (y.marketCapUsd ?? y.fdvUsd ?? 0) - (x.marketCapUsd ?? x.fdvUsd ?? 0));
    const ids = top.map((t) => (mode === "tokens" ? t.address : t.pool)).filter((x): x is string => Boolean(x));
    /* eslint-disable react-hooks/set-state-in-effect */
    if (!a) setA(ids.find((x) => x !== b) ?? "");
    if (!b) setB(ids.find((x) => x !== (a || ids[0])) ?? "");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [ready, market, mode, a, b]);

  useEffect(() => {
    if (!ready) return;
    const q = new URLSearchParams();
    if (mode === "pools") q.set("mode", "pools");
    if (a) q.set("a", a);
    if (b) q.set("b", b);
    window.history.replaceState(null, "", `/compare${q.toString() ? `?${q}` : ""}`);
  }, [ready, mode, a, b]);

  const A = useSide(mode, a, tf);
  const B = useSide(mode, b, tf);
  const points = useMemo(() => rebase(A.candles, B.candles), [A.candles, B.candles]);
  const rows = A.side && B.side ? metricRows(A.side, B.side) : [];
  const count = (c: ReturnType<typeof useSide>["checks"], lvl: string) => (c ? c.filter((x) => x.level === lvl).length : null);

  return (
    <div className="fq-wrap pt-14">
      <section className="fq-card relative overflow-hidden p-10 max-[680px]:p-6" aria-labelledby="cmp-title">
        <img src={ASSETS.flip} alt="" width={420} height={260} className="pointer-events-none absolute top-6 right-6 hidden w-[360px] opacity-80 lg:block" />
        <p className="fq-kicker">Flip the view</p>
        <h1 id="cmp-title" className="mt-4 text-[48px] leading-[1.05] font-light tracking-tight text-fg max-[680px]:text-[34px]">
          Two markets.
          <span className="block text-muted">One honest picture.</span>
        </h1>
        <p className="fq-note mt-5 max-w-[620px] text-[16px]">Put two tokens or two pools next to each other: price, depth, activity, contract checks and both price lines rebased to the same start. Larger is marked as larger, never as better.</p>
        <div className="fq-toggle mt-6" role="group" aria-label="Compare">
          {(["tokens", "pools"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => {
                setMode(m);
                setA("");
                setB("");
              }}
            >
              {m}
            </button>
          ))}
        </div>
      </section>

      <section className="fq-card mt-6 p-8 max-[680px]:p-5" aria-label="Pick two markets">
        <div className="flex flex-col gap-6 md:flex-row">
          <Picker which="A" mode={mode} value={a} onChange={setA} />
          <Picker which="B" mode={mode} value={b} onChange={setB} />
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="fq-card min-w-0" aria-label="Both price lines">
          <CardHead title={<>Price lines <span className="text-[12px] font-normal text-muted">% change from the first shared candle</span></>}>
            {TFS.map((t) => (
              <button key={t} type="button" className="fq-chip" aria-pressed={tf === t} onClick={() => setTf(t)}>
                {t}
              </button>
            ))}
          </CardHead>
          <div className="flex flex-wrap gap-4 px-8 pt-4 text-[13px] max-[680px]:px-4">
            <span className="flex items-center gap-2">
              <i className="inline-block h-0.5 w-5 bg-lime" /> {A.label} <Change v={points.at(-1)?.a} />
            </span>
            <span className="flex items-center gap-2">
              <i className="inline-block h-0.5 w-5 bg-[var(--steel)]" /> {B.label} <Change v={points.at(-1)?.b} />
            </span>
          </div>
          <div className="p-2" data-testid="overlay">
            {A.loading && B.loading && !points.length ? <Loading label="Loading both series…" /> : <Overlay points={points} a={A.label} b={B.label} />}
          </div>
          <p className="border-t border-line px-8 py-4 max-[680px]:px-4">
            <Src>Candles: {SOURCE_NAME} (USD), main pool of each side. Past moves say nothing about the next one.</Src>
          </p>
        </section>

        <section className="fq-card" aria-label="Side by side">
          <CardHead title="Side by side" tag={SOURCE_NAME} />
          {A.error || B.error ? (
            <div className="px-8">
              <Problem>{A.error ?? B.error}</Problem>
            </div>
          ) : null}
          <div className="fq-scroll">
            <table className="fq-table" data-testid="metric-table">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th className="num text-lime">A</th>
                  <th className="num">B</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td className="text-muted">{r.label}</td>
                    <td className={`num ${r.larger === "a" ? "text-fg" : "text-muted"}`}>{fmt(r, r.a)}</td>
                    <td className={`num ${r.larger === "b" ? "text-fg" : "text-muted"}`}>{fmt(r, r.b)}</td>
                  </tr>
                ))}
                {mode === "tokens" ? (
                  <tr>
                    <td className="text-muted">Checks to look at</td>
                    <td className="num down">{count(A.checks, "flag") ?? "—"}</td>
                    <td className="num down">{count(B.checks, "flag") ?? "—"}</td>
                  </tr>
                ) : null}
                {!rows.length ? (
                  <tr>
                    <td colSpan={3} className="text-muted">
                      {A.loading || B.loading ? "Reading both markets…" : "Pick two markets above."}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2 border-t border-line px-8 py-4 max-[680px]:px-4">
            {mode === "tokens" && /^0x[0-9a-f]{40}$/.test(a) ? (
              <Link href={`/coin/${a}`} className="fq-btn quiet h-9 text-[13px]">
                Review A
              </Link>
            ) : null}
            {mode === "tokens" && /^0x[0-9a-f]{40}$/.test(b) ? (
              <Link href={`/coin/${b}`} className="fq-btn quiet h-9 text-[13px]">
                Review B
              </Link>
            ) : null}
            <button
              type="button"
              className="fq-btn quiet h-9 text-[13px]"
              onClick={() => {
                setA(b);
                setB(a);
              }}
            >
              Swap sides
            </button>
          </div>
        </section>
      </div>
      <p className="fq-note mt-6">{NOT_ADVICE}</p>
    </div>
  );
}
