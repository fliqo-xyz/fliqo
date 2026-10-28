"use client";

import { useMemo, useState } from "react";
import { useLocalStore } from "@/components/wallet/useLocalStore";
import { useWalletModal } from "@/components/wallet/WalletButton";
import { useWallet } from "@/components/wallet/WalletProvider";
import { CHAIN, explorerAddress, explorerTx } from "@/config/brand";
import { storageKey } from "@/config/storage";
import { explain, waitForReceipt } from "@/lib/client";

type Art = { creation: string; sha256: string };
type Progress = { book?: string; bookTx?: string; bookBlock?: number };

/** Owner tool: deploys FliqoWatchBook from the connected wallet. */
export function DeployPanel({ book }: { book: Art }) {
  const { address, onRobinhoodChain, sendTransaction, switchNetwork } = useWallet();
  const { open } = useWalletModal();
  const [p, setP] = useLocalStore<Progress>(storageKey("deploy", String(CHAIN.id)), {});
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const say = (s: string) => setLog((l) => [`${new Date().toLocaleTimeString()} ${s}`, ...l]);

  const snippet = useMemo(() => `const DEPLOYED = {\n  watch: "${p.book ?? ""}",\n  watchBlock: ${p.bookBlock ?? 0},\n};`, [p]);

  async function deploy() {
    setBusy(true);
    try {
      const data = book.creation as `0x${string}`;
      say(`FliqoWatchBook: confirm in the wallet (${(data.length - 2) / 2} bytes)`);
      const hash = await sendTransaction({ data });
      say(`FliqoWatchBook: sent ${hash}`);
      const r = await waitForReceipt(hash, 300_000);
      if (!r.ok || !r.contractAddress) throw new Error("FliqoWatchBook deployment reverted");
      say(`FliqoWatchBook: deployed at ${r.contractAddress} (block ${r.blockNumber})`);
      setP({ book: r.contractAddress, bookTx: hash, bookBlock: r.blockNumber });
    } catch (e) {
      say(`failed: ${explain(e)}`);
    } finally {
      setBusy(false);
    }
  }

  if (!address)
    return (
      <button type="button" className="fq-btn w-fit" onClick={open}>
        Connect the deployer wallet
      </button>
    );
  if (!onRobinhoodChain)
    return (
      <button type="button" className="fq-btn w-fit" onClick={switchNetwork}>
        Switch to {CHAIN.name}
      </button>
    );

  return (
    <div className="flex flex-col gap-4" data-testid="deploy-panel">
      <section className="fq-card p-5 flex flex-col gap-3">
        <h2 className="text-[17px] font-bold">1 · FliqoWatchBook (no arguments, no token)</h2>
        <p className="m-0 font-mono text-[12px] text-muted">Build sha256 {book.sha256.slice(0, 16)}…</p>
        {p.book ? (
          <p className="m-0 text-[14px]">
            Deployed at{" "}
            <a href={explorerAddress(p.book)} target="_blank" rel="noreferrer" className="font-mono text-lime underline">
              {p.book}
            </a>{" "}
            (block {p.bookBlock},{" "}
            <a className="text-lime underline" href={explorerTx(p.bookTx ?? "")} target="_blank" rel="noreferrer">
              tx
            </a>
            )
          </p>
        ) : (
          <button type="button" className="fq-btn w-fit" disabled={busy} data-testid="deploy-book" onClick={deploy}>
            {busy ? "Deploying…" : "Deploy FliqoWatchBook"}
          </button>
        )}
      </section>

      <section className="fq-card p-5 flex flex-col gap-3">
        <h2 className="text-[17px] font-bold">2 · Paste into src/config/contracts.ts</h2>
        <pre className="overflow-x-auto bg-sunk p-3 rounded-[10px] font-mono text-[12.5px]" data-testid="deploy-snippet">
          {snippet}
        </pre>
        <p className="m-0 text-[13px] text-muted">
          Then run <code>npm run verify-deployment -- --book {p.book ?? "0x…"} --book-tx {p.bookTx ?? "0x…"}</code>, verify the source on the explorer (Standard JSON input from contracts/), and remove this page.
        </p>
      </section>

      {log.length ? (
        <ul className="flex flex-col gap-1 font-mono text-[12px] text-muted" data-testid="deploy-log">
          {log.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
