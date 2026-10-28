"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { shortAddress } from "@/config/brand";
import { useMarket } from "@/components/providers/MarketProvider";
import { WatchSync } from "@/components/watch/WatchSync";
import { CardHead, Change, Loading, NOT_ADVICE, Problem, Src } from "@/components/ui/kit";
import { useLocalStore } from "@/components/wallet/useLocalStore";
import { KEYS } from "@/config/storage";
import { SOURCE_NAME } from "@/lib/market";
import type { PriceRow } from "@/lib/server/market";
import { useWatch } from "@/lib/stores";
import { useJson } from "@/lib/useJson";
import { EMPTY_RULE, MAX_TOKENS, evaluate, hasRule, type Rule } from "@/lib/watch";
import { ago, price, usdShort } from "@/lib/format";

const FIELDS: { k: keyof Rule; label: string; unit: string }[] = [
  { k: "priceAbove", label: "Price at or above", unit: "USD" },
  { k: "priceBelow", label: "Price at or below", unit: "USD" },
  { k: "move24h", label: "24h move at least", unit: "%" },
  { k: "liqBelow", label: "Liquidity under", unit: "USD" },
];

function RuleEditor({ rule, onSave, onClose }: { rule: Rule; onSave: (r: Rule) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<Record<keyof Rule, string>>({
    priceAbove: rule.priceAbove?.toString() ?? "",
    priceBelow: rule.priceBelow?.toString() ?? "",
    move24h: rule.move24h?.toString() ?? "",
    liqBelow: rule.liqBelow?.toString() ?? "",
  });
  const num = (s: string) => {
    const n = Number(s);
    return s.trim() && Number.isFinite(n) && n > 0 ? n : null;
  };
  return (
    <div className="grid gap-3 bg-sunk px-8 py-5 sm:grid-cols-2 lg:grid-cols-4 max-[680px]:px-4" data-testid="rule-editor">
      {FIELDS.map((f) => (
        <label key={f.k} className="flex flex-col gap-1 text-[12px] text-muted">
          {f.label} ({f.unit})
          <input className="fq-input" inputMode="decimal" value={draft[f.k]} onChange={(e) => setDraft({ ...draft, [f.k]: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="off" data-testid={`rule-${f.k}`} />
        </label>
      ))}
      <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
        <button type="button" className="fq-btn lime h-9" onClick={() => onSave({ priceAbove: num(draft.priceAbove), priceBelow: num(draft.priceBelow), move24h: num(draft.move24h), liqBelow: num(draft.liqBelow) })} data-testid="rule-save">
          Save thresholds
        </button>
        <button type="button" className="fq-btn quiet h-9" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

function useNotify() {
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPerm(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  }, []);
  const ask = async () => {
    if (typeof Notification === "undefined") return;
    setPerm(await Notification.requestPermission());
  };
  return { perm, ask };
}

export function WatchlistView() {
  const { watch, toggle, setRule } = useWatch();
  const { byAddress } = useMarket();
  const [input, setInput] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const { perm, ask } = useNotify();
  const [log, setLog] = useLocalStore<unknown>(KEYS.alertLog, {});
  const tokens = watch.tokens;
  const chunks = useMemo(() => [tokens.slice(0, 30), tokens.slice(30, 50)].filter((c) => c.length), [tokens]);
  const p1 = useJson<{ rows: PriceRow[]; at: number; stale: boolean }>(chunks[0] ? `/api/prices?tokens=${chunks[0].join(",")}` : null, 120_000);
  const p2 = useJson<{ rows: PriceRow[]; at: number; stale: boolean }>(chunks[1] ? `/api/prices?tokens=${chunks[1].join(",")}` : null, 120_000);
  const prices = useMemo(() => new Map([...(p1.data?.rows ?? []), ...(p2.data?.rows ?? [])].map((r) => [r.address, r])), [p1.data, p2.data]);

  const hits = useMemo(() => Object.fromEntries(tokens.map((t) => [t, evaluate(watch.rules[t], prices.get(t))])), [tokens, watch.rules, prices]);

  // Browser alerts: once per token and threshold per hour, only while this tab is open and only after permission.
  useEffect(() => {
    if (perm !== "granted") return;
    const seen = (typeof log === "object" && log !== null ? log : {}) as Record<string, number>;
    const now = Date.now();
    const next = { ...seen };
    let changed = false;
    for (const t of tokens)
      for (const h of hits[t] ?? []) {
        const key = `${t}:${h.kind}`;
        if (now - (seen[key] ?? 0) < 3_600_000) continue;
        next[key] = now;
        changed = true;
        try {
          new Notification(`${byAddress.get(t)?.symbol ? `$${byAddress.get(t)!.symbol}` : shortAddress(t)}: ${h.text}`, { body: "Fliqo watchlist alert (open tab). Not financial advice.", tag: key });
        } catch {
          // Some browsers refuse notifications from page code; the row still shows the hit.
        }
      }
    if (changed) setLog(next);
  }, [hits, perm, tokens, byAddress, log, setLog]);

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const v = input.trim().toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(v)) return setErr("Paste a token contract address (0x + 40 hex).");
    if (tokens.includes(v)) return setErr("That token is already on the list.");
    if (tokens.length >= MAX_TOKENS) return setErr(`The list holds ${MAX_TOKENS} tokens at most.`);
    setErr(null);
    toggle(v);
    setInput("");
  };
  const at = p1.data?.at ?? null;

  return (
    <div className="fq-wrap pt-14">
      <section className="fq-card p-10 max-[680px]:p-6" aria-labelledby="wl-title">
        <p className="fq-kicker">Watchlist &amp; alerts</p>
        <h1 id="wl-title" className="mt-4 text-[48px] leading-[1.05] font-light tracking-tight text-fg max-[680px]:text-[34px]">
          Your list.
          <span className="block text-muted">Your thresholds.</span>
        </h1>
        <p className="fq-note mt-5 max-w-[640px] text-[16px]">Up to {MAX_TOKENS} tokens with your own price, move and liquidity thresholds. The list lives in this browser; alerts run in this tab while it is open. Save it on chain to open the same list on another device.</p>
        <form onSubmit={add} className="fq-ca-box mx-0 mt-8 max-w-[640px]">
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Add a token by contract address" aria-label="Token contract address" spellCheck={false} data-testid="watch-add" />
          <button type="submit" className="fq-btn arrow">
            Add
          </button>
        </form>
        {err ? <p className="mt-3 text-[13px] text-down">{err}</p> : null}
        <div className="mt-6 flex flex-wrap items-center gap-3 text-[13px] text-muted">
          <span>
            {tokens.length} / {MAX_TOKENS} tokens · {tokens.filter((t) => hasRule(watch.rules[t])).length} with thresholds
          </span>
          {perm === "granted" ? (
            <span className="fq-tag lime">browser alerts on</span>
          ) : perm === "unsupported" ? (
            <span className="fq-tag">this browser has no notifications</span>
          ) : perm === "denied" ? (
            <span className="fq-tag ember">notifications blocked in the browser</span>
          ) : (
            <button type="button" className="fq-chip" onClick={ask} data-testid="alerts-enable">
              Turn on browser alerts
            </button>
          )}
        </div>
      </section>

      <section className="fq-card mt-6" aria-label="Watched tokens">
        <CardHead title="Watched tokens" tag={SOURCE_NAME}>
          <span>{at ? `prices ${ago(at)}` : ""}</span>
        </CardHead>
        {!tokens.length ? (
          <p className="fq-note px-8 py-8">
            Nothing here yet. Star a token on the <Link href="/" className="text-lime underline">markets</Link> or paste an address above.
          </p>
        ) : (
          <div className="fq-scroll">
            <table className="fq-table" data-testid="watch-table">
              <thead>
                <tr>
                  <th>Token</th>
                  <th className="num">Price</th>
                  <th className="num">24h</th>
                  <th className="num fq-hide-680">Liquidity</th>
                  <th>Alerts</th>
                  <th className="num">Edit</th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((t) => {
                  const p = prices.get(t);
                  const sym = byAddress.get(t)?.symbol;
                  const r = watch.rules[t];
                  const h = hits[t] ?? [];
                  return [
                    <tr key={t}>
                      <td>
                        <Link href={`/coin/${t}`} className="text-fg hover:underline">
                          {sym ? `$${sym}` : shortAddress(t, 6, 4)}
                        </Link>
                      </td>
                      <td className="num">{price(p?.priceUsd)}</td>
                      <td className="num">
                        <Change v={p?.change24h} />
                      </td>
                      <td className="num fq-hide-680">{usdShort(p?.liquidityUsd)}</td>
                      <td>{h.length ? <span className="fq-tag lime" title={h.map((x) => x.text).join("; ")}>● {h.length} hit</span> : hasRule(r) ? <span className="fq-tag">armed</span> : <span className="text-[12px] text-muted">off</span>}</td>
                      <td className="num">
                        <button type="button" className="text-[13px] text-lime hover:underline" onClick={() => setEditing(editing === t ? null : t)} data-testid="rule-edit">
                          Thresholds
                        </button>
                        <button type="button" className="ml-3 text-[13px] text-muted hover:text-down" onClick={() => toggle(t)} aria-label="Remove from the watchlist">
                          Remove
                        </button>
                      </td>
                    </tr>,
                    editing === t ? (
                      <tr key={`${t}-edit`}>
                        <td colSpan={6} className="p-0">
                          <RuleEditor
                            rule={r ?? EMPTY_RULE}
                            onSave={(nr) => {
                              setRule(t, nr);
                              setEditing(null);
                            }}
                            onClose={() => setEditing(null)}
                          />
                        </td>
                      </tr>
                    ) : null,
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
        {p1.loading && !p1.data && tokens.length ? <div className="px-8"><Loading label="Reading prices…" /></div> : null}
        {p1.error ? <div className="px-8"><Problem>{p1.error}</Problem></div> : null}
        <p className="border-t border-line px-8 py-4 max-[680px]:px-4">
          <Src>Prices, 24h change and liquidity: {SOURCE_NAME} token prices (all pools of the token). A threshold fires only on a known number; &quot;—&quot; never fires. Alerts are checked every two minutes while this tab is open.</Src>
        </p>
      </section>

      <WatchSync />
      <p className="fq-note mt-6">{NOT_ADVICE}</p>
    </div>
  );
}
