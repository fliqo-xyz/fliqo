import { initials } from "@/lib/glyph";
import type { TokenRef } from "@/lib/market";

/* A token's logo (local file) or, without one, its initial in a ring. */
export function Tok({ t, size = 32 }: { t: Pick<TokenRef, "address" | "symbol" | "logo">; size?: number }) {
  return (
    <span className="tok" style={{ width: size, height: size, fontSize: Math.max(10, size * 0.36) }} title={t.symbol}>
      {t.logo ? (
        <img src={t.logo} alt="" width={size} height={size} loading="lazy" />
      ) : (
        <span aria-hidden="true">{initials(t.symbol)}</span>
      )}
    </span>
  );
}

export function PairIcon({ a, b, size = 32 }: { a: Pick<TokenRef, "address" | "symbol" | "logo">; b: Pick<TokenRef, "address" | "symbol" | "logo">; size?: number }) {
  return (
    <span className="inline-flex -space-x-2" aria-hidden="true">
      <Tok t={a} size={size} />
      <Tok t={b} size={size} />
    </span>
  );
}
