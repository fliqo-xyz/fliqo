import { pct } from "@/lib/format";

/* Small shared pieces in the site's look: card heads, signed changes, source notes, planned tags. */

export function CardHead({ title, tag, children, as: Tag = "h2", id }: { title: React.ReactNode; tag?: React.ReactNode; children?: React.ReactNode; as?: "h2" | "h3"; id?: string }) {
  return (
    <div className="fq-card-head">
      <Tag id={id}>
        {title}
        {tag ? <span className="fq-tag">{tag}</span> : null}
      </Tag>
      {children ? <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">{children}</div> : null}
    </div>
  );
}

export function Change({ v, className = "" }: { v: number | null | undefined; className?: string }) {
  if (v == null || !Number.isFinite(v)) return <span className={`text-muted ${className}`}>—</span>;
  return <span className={`${v > 0 ? "up" : v < 0 ? "down" : "text-muted"} ${className}`}>{pct(v, 1).replace("-", "−")}</span>;
}

/** Where a number came from, always next to it. */
export function Src({ children }: { children: React.ReactNode }) {
  return <span className="fq-src">{children}</span>;
}

export function Planned({ children = "Planned" }: { children?: React.ReactNode }) {
  return <span className="fq-tag">{children}</span>;
}

export function Loading({ label }: { label: string }) {
  return (
    <p className="fq-note flex items-center gap-2 py-6" role="status">
      <span className="fq-live-dot" aria-hidden="true" />
      {label}
    </p>
  );
}

export function Problem({ children }: { children: React.ReactNode }) {
  return (
    <p className="py-4 text-[13px] text-down" role="alert">
      {children}
    </p>
  );
}

export function Spark({ values, w = 80, h = 24 }: { values: number[]; w?: number; h?: number }) {
  if (values.length < 2) return <span className="text-muted">—</span>;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const d = values.map((v, i) => `${i ? "L" : "M"}${((i / (values.length - 1)) * w).toFixed(1)} ${(h - ((v - lo) / span) * (h - 2) - 1).toFixed(1)}`).join(" ");
  const up = values[values.length - 1] >= values[0];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={d} fill="none" stroke={up ? "var(--up)" : "var(--down)"} strokeWidth="1.5" />
    </svg>
  );
}

export const NOT_ADVICE = "Not financial advice. Numbers come from public sources and the chain; they can be late or wrong, and a check is a fact, never a verdict.";
