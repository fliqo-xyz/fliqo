"use client";

import { useMemo, useRef, useState } from "react";
import type { Candle } from "@/lib/market";
import { price, usdShort } from "@/lib/format";

/* Candlestick chart drawn in SVG from pool candles: volume bars, optional 20-period average, hover read-out. */

const W = 760;
const H = 430;
const PAD = { l: 8, r: 64, t: 12, b: 28 };

export function Candles({ candles, ma, tf }: { candles: Candle[]; ma: boolean; tf: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<SVGSVGElement>(null);
  const geo = useMemo(() => {
    if (candles.length < 2) return null;
    const lo = Math.min(...candles.map((c) => c[3]));
    const hi = Math.max(...candles.map((c) => c[2]));
    const span = hi - lo || hi || 1;
    const vmax = Math.max(...candles.map((c) => c[5])) || 1;
    const innerW = W - PAD.l - PAD.r;
    const priceH = (H - PAD.t - PAD.b) * 0.78;
    const step = innerW / candles.length;
    const y = (p: number) => PAD.t + (1 - (p - (lo - span * 0.04)) / (span * 1.08)) * priceH;
    const volTop = PAD.t + priceH + 6;
    const volH = H - PAD.b - volTop;
    const avg: (number | null)[] = candles.map((_, i) => (i >= 19 ? candles.slice(i - 19, i + 1).reduce((s, c) => s + c[4], 0) / 20 : null));
    const ticks = Array.from({ length: 5 }, (_, i) => lo - span * 0.04 + (span * 1.08 * i) / 4);
    return { lo, hi, y, step, vmax, volTop, volH, avg, ticks };
  }, [candles]);

  if (!geo) return <div className="grid h-[430px] place-items-center rounded-xl bg-sunk text-sm text-muted">No candles for this pool and timeframe yet (or the public data source is busy; it retries every minute).</div>;
  const last = candles[candles.length - 1];
  const h = hover === null ? null : candles[hover];
  const dateFmt = (sec: number) => new Date(sec * 1000).toLocaleString("en-US", tf === "1d" || tf === "1w" ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  const labelEvery = Math.max(1, Math.ceil(candles.length / 6));

  return (
    <div className="relative">
      <svg
        ref={box}
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full touch-pan-y select-none"
        role="img"
        aria-label={`Price chart, ${candles.length} candles, last close ${price(last[4])}`}
        onPointerMove={(e) => {
          const r = box.current?.getBoundingClientRect();
          if (!r) return;
          const x = ((e.clientX - r.left) / r.width) * W - PAD.l;
          const i = Math.floor(x / geo.step);
          setHover(i >= 0 && i < candles.length ? i : null);
        }}
        onPointerLeave={() => setHover(null)}
      >
        {geo.ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={geo.y(t)} y2={geo.y(t)} stroke="var(--line)" strokeDasharray="2 4" />
            <text x={W - PAD.r + 6} y={geo.y(t) + 4} fontSize="11" fill="var(--muted)">
              {price(t).replace("$", "")}
            </text>
          </g>
        ))}
        {candles.map((c, i) => {
          const x = PAD.l + i * geo.step + geo.step / 2;
          const up = c[4] >= c[1];
          const color = up ? "var(--up)" : "var(--down)";
          const bw = Math.max(1.2, geo.step * 0.62);
          const top = geo.y(Math.max(c[1], c[4]));
          const bot = geo.y(Math.min(c[1], c[4]));
          const vh = (c[5] / geo.vmax) * geo.volH;
          return (
            <g key={c[0]}>
              <rect x={x - bw / 2} y={geo.volTop + geo.volH - vh} width={bw} height={vh} fill={color} opacity="0.28" />
              <line x1={x} x2={x} y1={geo.y(c[2])} y2={geo.y(c[3])} stroke={color} strokeWidth="1" />
              <rect x={x - bw / 2} y={top} width={bw} height={Math.max(1, bot - top)} fill={color} />
              {i % labelEvery === 0 ? (
                <text x={x} y={H - 8} fontSize="11" fill="var(--muted)" textAnchor="middle">
                  {dateFmt(c[0])}
                </text>
              ) : null}
            </g>
          );
        })}
        {ma ? (
          <path
            d={geo.avg
              .map((a, i) => (a === null ? null : `${geo.avg[i - 1] == null ? "M" : "L"} ${(PAD.l + i * geo.step + geo.step / 2).toFixed(1)} ${geo.y(a).toFixed(1)}`))
              .filter(Boolean)
              .join(" ")}
            fill="none"
            stroke="#b07a1e"
            strokeWidth="1.5"
          />
        ) : null}
        <line x1={PAD.l} x2={W - PAD.r} y1={geo.y(last[4])} y2={geo.y(last[4])} stroke={last[4] >= last[1] ? "var(--up)" : "var(--down)"} strokeDasharray="3 3" />
        <rect x={W - PAD.r + 2} y={geo.y(last[4]) - 9} width={PAD.r - 4} height={18} rx="3" fill={last[4] >= last[1] ? "var(--up)" : "var(--down)"} />
        <text x={W - PAD.r + 6} y={geo.y(last[4]) + 4} fontSize="11" fill="#0a0c0f" fontWeight="700">
          {price(last[4]).replace("$", "")}
        </text>
        {hover !== null ? <line x1={PAD.l + hover * geo.step + geo.step / 2} x2={PAD.l + hover * geo.step + geo.step / 2} y1={PAD.t} y2={H - PAD.b} stroke="var(--line-strong)" strokeDasharray="2 3" /> : null}
      </svg>
      {h ? (
        <div className="pointer-events-none absolute top-2 left-2 rounded-lg border border-line bg-panel/95 px-2 py-1 text-[11px] tabular-nums shadow-sm">
          {dateFmt(h[0])} · O {price(h[1])} H {price(h[2])} L {price(h[3])} C {price(h[4])} · Vol {usdShort(h[5])}
        </div>
      ) : null}
    </div>
  );
}
