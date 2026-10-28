"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { explorerAddress, explorerTx, shortAddress } from "@/config/brand";
import { useWalletModal } from "@/components/wallet/WalletButton";
import { useWallet } from "@/components/wallet/WalletProvider";
import { CardHead, Loading, NOT_ADVICE, Problem, Src } from "@/components/ui/kit";
import { Tok } from "@/components/ui/Tok";
import { SOURCE_NAME } from "@/lib/market";
import type { WalletView } from "@/lib/server/wallet";
import type { TransferScan } from "@/lib/server/transfers";
import { useJson } from "@/lib/useJson";
import { amount, int, price, usdShort, ago } from "@/lib/format";
import { toNumber } from "@/lib/swap";

type Activity = { configured: boolean; txs: { hash: string; to: string | null; block: number; time: number; ok: boolean; method: string | null; valueWei: string }[]; error?: string };

export function PortfolioView() {
  const { address } = useWallet();
  const { open } = useWalletModal();
  const [other, setOther] = useState("");
  const [viewing, setViewing] = useState<string | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("address")?.toLowerCase() ?? "";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (/^0x[0-9a-f]{40}$/.test(q)) setViewing(q);
  }, []);
  const owner = viewing ?? address?.toLowerCase() ?? null;
  const wallet = useJson<WalletView>(owner ? `/api/wallet?owner=${owner}` : null, 60_000);
  const transfers = useJson<TransferScan>(owner ? `/api/transfers?owner=${owner}` : null, 90_000);
  const activity = useJson<Activity>(owner ? `/api/activity?owner=${owner}` : null, 90_000);
  const w = wallet.data;

  return (
    <div className="fq-wrap pt-14">
      <section className="fq-card p-10 max-[680px]:p-6" aria-labelledby="pf-title">
        <p className="fq-kicker">Portfolio</p>
        <h1 id="pf-title" className="mt-4 text-[48px] leading-[1.05] font-light tracking-tight text-fg max-[680px]:text-[34px]">
          Your wallet.
          <span className="block text-muted">Balances, transfers, history.</span>
        </h1>
        {!owner ? (
          <>
            <p className="fq-note mt-5 max-w-[620px] text-[16px]">Connect a wallet to read its balances and recent transfers. Connecting only shares your address; nothing is signed or sent.</p>
            <button type="button" className="fq-btn arrow mt-6" onClick={open} data-testid="pf-connect">
              Connect wallet
            </button>
          </>
        ) : (
          <p className="mt-5 flex flex-wrap items-center gap-3 text-[14px] text-muted">
            <a href={explorerAddress(owner)} target="_blank" rel="noreferrer" className="fq-pill">
              {shortAddress(owner, 6, 4)} ↗
            </a>
            {viewing ? (
              <button type="button" className="fq-chip" onClick={() => setViewing(null)}>
                read-only view · back to my wallet
              </button>
            ) : null}
            <span>
              Total <b className="text-fg">{usdShort(w?.totalUsd)}</b>
            </span>
            <span>nonce {w?.nonce.latest ?? "—"}</span>
          </p>
        )}
        <form
          className="mt-6 flex max-w-[560px] gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const v = other.trim().toLowerCase();
            if (/^0x[0-9a-f]{40}$/.test(v)) setViewing(v);
          }}
        >
          <input className="fq-input flex-1 rounded-full px-4" value={other} onChange={(e) => setOther(e.target.value)} placeholder="Or look at any address (read-only)" aria-label="Any address" spellCheck={false} />
          <button type="submit" className="fq-btn quiet">
            View
          </button>
        </form>
      </section>

      {owner ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <section className="fq-card min-w-0" aria-label="Balances">
            <CardHead title="Balances" tag="chain + pool prices">
              <span>{w ? `block ${int(w.block)}` : ""}</span>
            </CardHead>
            {wallet.loading && !w ? <div className="px-8"><Loading label="Reading balances…" /></div> : null}
            {wallet.error ? <div className="px-8"><Problem>{wallet.error}</Problem></div> : null}
            {w ? (
              <div className="fq-scroll">
                <table className="fq-table" data-testid="balances">
                  <thead>
                    <tr>
                      <th>Asset</th>
                      <th className="num">Amount</th>
                      <th className="num">Price</th>
                      <th className="num">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>ETH</td>
                      <td className="num">{amount(w.eth.amount)}</td>
                      <td className="num">{price(w.eth.priceUsd)}</td>
                      <td className="num">{usdShort(w.eth.valueUsd)}</td>
                    </tr>
                    {w.holdings.map((h) => (
                      <tr key={h.address}>
                        <td>
                          <Link href={`/coin/${h.address}`} className="flex items-center gap-2 text-fg hover:underline">
                            <Tok t={h} size={22} /> ${h.symbol}
                          </Link>
                        </td>
                        <td className="num">{amount(h.amount)}</td>
                        <td className="num">{price(h.priceUsd)}</td>
                        <td className="num">{usdShort(h.valueUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            <p className="border-t border-line px-8 py-4 max-[680px]:px-4">
              <Src>Balances: balanceOf() on chain for the {w?.coverage.tokensChecked ?? "—"} tokens on the market lists (others are not shown). Prices: {SOURCE_NAME}.</Src>
            </p>
          </section>

          <section className="fq-card min-w-0" aria-label="Wallet activity">
            <CardHead title="Wallet activity" tag="token transfers">
              <span>{transfers.data ? `last ${int(transfers.data.head - transfers.data.fromBlock)} blocks` : ""}</span>
            </CardHead>
            {transfers.loading && !transfers.data ? <div className="px-8"><Loading label="Reading transfer logs…" /></div> : null}
            {transfers.error ? <div className="px-8"><Problem>{transfers.error}</Problem></div> : null}
            {transfers.data ? (
              transfers.data.items.length ? (
                <ul data-testid="transfers">
                  {transfers.data.items.map((t) => (
                    <li key={`${t.tx}-${t.logIndex}`} className="flex flex-wrap items-center gap-3 border-b border-line px-8 py-3 last:border-0 max-[680px]:px-4">
                      <span className={`fq-tag ${t.dir === "in" ? "lime" : t.dir === "out" ? "ember" : ""}`}>{t.dir}</span>
                      <Link href={`/coin/${t.token}`} className="text-fg hover:underline">
                        {amount(toNumber(t.raw, t.decimals))} {t.symbol ? `$${t.symbol}` : shortAddress(t.token, 4, 4)}
                      </Link>
                      <span className="text-[13px] text-muted">
                        {t.dir === "in" ? "from" : "to"} {shortAddress(t.dir === "in" ? t.from : t.to, 4, 4)}
                      </span>
                      <a href={explorerTx(t.tx)} target="_blank" rel="noreferrer" className="ml-auto text-[12px] text-muted hover:text-fg">
                        block {int(t.block)} ↗
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="fq-note px-8 py-6">No token transfers in the blocks read (about the last {Math.round(((transfers.data.head - transfers.data.fromBlock) * 0.1) / 60)} minutes).</p>
              )
            ) : null}
            <p className="border-t border-line px-8 py-4 max-[680px]:px-4">
              <Src>ERC-20 Transfer logs where this wallet sends or receives, read from {"Robinhood Chain"} in windows of 25,000 blocks. Plain ETH transfers do not leave logs.</Src>
            </p>
          </section>

          <section className="fq-card min-w-0 lg:col-span-2" aria-label="Transactions">
            <CardHead title="Transactions" tag="indexer, optional" />
            {activity.data && !activity.data.configured ? (
              <p className="fq-note px-8 py-6">Full transaction history needs an indexer key on this site, which is not configured yet. The token transfers above are read straight from the chain without it.</p>
            ) : null}
            {activity.data?.configured ? (
              <ul>
                {activity.data.txs.map((t) => (
                  <li key={t.hash} className="flex flex-wrap items-center gap-3 border-b border-line px-8 py-3 last:border-0 max-[680px]:px-4">
                    <span className={`fq-tag ${t.ok ? "lime" : "ember"}`}>{t.ok ? "ok" : "failed"}</span>
                    <span className="text-[14px] text-text-2">{t.method ?? "transfer"}</span>
                    <span className="text-[13px] text-muted">to {t.to ? shortAddress(t.to, 4, 4) : "contract creation"}</span>
                    <a href={explorerTx(t.hash)} target="_blank" rel="noreferrer" className="ml-auto text-[12px] text-muted hover:text-fg">
                      {ago(t.time)} ↗
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </div>
      ) : null}
      <p className="fq-note mt-6">{NOT_ADVICE}</p>
    </div>
  );
}
