"use client";

import { explorerAddress, shortAddress } from "@/config/brand";
import { CardHead, Loading, Problem, Src } from "@/components/ui/kit";
import type { LockAnswer, LockTarget } from "@/lib/locks";
import { useJson } from "@/lib/useJson";
import { ago, amount as fmtAmount } from "@/lib/format";

/* HoodLock lock status of a token's supply and of its v2 LP tokens (server route /api/locks). */

const share = (bps: number | null) => (bps === null ? "—" : `${(bps / 100).toFixed(bps > 0 && bps < 1 ? 4 : 2)}%`);
const date = (sec: number) => new Date(sec * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";

function Target({ t }: { t: LockTarget }) {
  return (
    <div className="border-b border-line py-3 last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[14px] text-fg">
          {t.label}{" "}
          <a href={explorerAddress(t.address)} target="_blank" rel="noreferrer" className="text-[12px] text-muted hover:text-fg">
            {shortAddress(t.address, 4, 4)} ↗
          </a>
        </span>
        <span className="text-[13px] text-muted">
          {t.locks.length ? (
            <>
              <b className="text-fg">{share(t.lockedShareBps)}</b> of supply locked now
            </>
          ) : (
            "no active HoodLock lock"
          )}
        </span>
      </div>
      {t.locks.length ? (
        <ul className="mt-2">
          {t.locks.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-1 text-[13px]">
              <a href={l.proofUrl} target="_blank" rel="noreferrer" className="text-lime hover:underline">
                Lock #{l.id} ↗
              </a>
              <span className="text-fg">{t.decimals !== null ? fmtAmount(Number(l.amount) / 10 ** t.decimals) : l.amount}</span>
              <span className="text-muted">{share(l.shareBps)} of supply</span>
              <span className={l.unlocked ? "text-warn" : "text-muted"}>{l.unlocked ? `unlock time passed (${date(l.unlockTime)}): the owner may withdraw` : `unlocks ${date(l.unlockTime)}`}</span>
              <span className="text-muted">owner {shortAddress(l.owner, 4, 4)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function LockCard({ token, symbol }: { token: string | null; symbol: string }) {
  const { data, error, loading } = useJson<LockAnswer>(token ? `/api/locks/${token}` : null, 600_000);
  if (!token) return null;
  const any = data?.targets.some((t) => t.locks.length) ?? false;
  return (
    <section className="fq-card" aria-labelledby="locks-title" data-testid="lock-status">
      <CardHead id="locks-title" title="Locks" tag="HoodLock">
        {data ? <span>{any ? "active locks found" : "no active lock found"}</span> : null}
        {data ? <span>read {ago(data.at)}</span> : null}
      </CardHead>
      <div className="fq-card-body">
        {loading && !data ? <Loading label="Reading HoodLock locks…" /> : null}
        {error && !data ? <Problem>{error}</Problem> : null}
        {data ? (
          <>
            {data.targets.map((t) => (
              <Target key={t.address} t={t} />
            ))}
            {data.notes.length ? (
              <ul className="mt-3 flex flex-col gap-2">
                {data.notes.map((n) => (
                  <li key={n} className="fq-note">
                    {n}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-3">
              <Src>
                Locks of ${symbol} and of its v2 LP tokens on the HoodLock locker {shortAddress(data.locker, 4, 4)}, at block {data.block}:{" "}
                {data.method === "logs" ? "Locked events filtered by token, each lock re-read with getLock (withdrawn locks left out)" : "every lock id read with getLock (event logs were not available)"}
                {data.complete ? "." : "; the read stopped early, so the list may be incomplete."} Other lockers are not checked, so no lock found here does not mean none exists.
              </Src>
            </p>
          </>
        ) : null}
      </div>
    </section>
  );
}
