"use client";

import { useCallback, useEffect, useState } from "react";
import { bytesToHex, encodeFunctionData, hexToBytes, type Abi } from "viem";
import { CHAIN, explorerAddress, explorerTx, shortAddress } from "@/config/brand";
import { CONTRACTS, saveGasEstimate, watchLive } from "@/config/contracts";
import { useWalletModal } from "@/components/wallet/WalletButton";
import { useWallet } from "@/components/wallet/WalletProvider";
import { CardHead, Src } from "@/components/ui/kit";
import { ERROR_WORDS, WATCH_ABI } from "@/lib/abi";
import { explain, readMany, waitForReceipt } from "@/lib/client";
import { useWatch } from "@/lib/stores";
import { cleanWatch, decodeSettings, encodeSettings, sameWatch, type Watch } from "@/lib/watch";
import { int } from "@/lib/format";

type OnChain = { version: number; savedAt: number; savedBlock: number; watch: Watch } | null;

/** Reads `owner`'s record from FliqoWatchBook (through the site relay, then the public RPC). */
async function readRecord(owner: string): Promise<OnChain> {
  const [r] = await readMany([{ to: CONTRACTS.watch, abi: WATCH_ABI as Abi, fn: "watchlistOf", args: [owner] }]);
  if (!r) throw new Error("The watchlist contract did not answer.");
  const [version, savedAt, savedBlock, tokens, settings] = r as readonly [number, bigint, bigint, readonly string[], `0x${string}`];
  const list = tokens.map((t) => t.toLowerCase());
  return { version: Number(version), savedAt: Number(savedAt) * 1000, savedBlock: Number(savedBlock), watch: cleanWatch({ tokens: list, rules: decodeSettings(hexToBytes(settings), list) }) };
}

/** Save / load the watchlist through FliqoWatchBook; practice mode (export / import a file) until it is deployed. */
export function WatchSync() {
  const { watch, replace } = useWatch();
  const { address, onRobinhoodChain, sendTransaction, switchNetwork } = useWallet();
  const { open } = useWalletModal();
  const [chain, setChain] = useState<OnChain | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [tx, setTx] = useState<string | null>(null);
  const live = watchLive();

  const load = useCallback(async () => {
    if (!live || !address) return;
    try {
      setChain(await readRecord(address));
    } catch (e) {
      setMsg(explain(e));
    }
  }, [live, address]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  let settingsBytes: Uint8Array | null = null;
  let tooLarge: string | null = null;
  try {
    settingsBytes = encodeSettings(watch);
  } catch (e) {
    tooLarge = e instanceof Error ? e.message : "Settings too large.";
  }
  const synced = chain ? sameWatch(chain.watch, watch) : false;

  async function save() {
    if (!address || !chain || !settingsBytes) return;
    setBusy(true);
    setMsg(null);
    try {
      // Dry check first: if another device saved since this page read the chain, say so before the wallet opens
      // (the contract would refuse the save anyway with StaleVersion).
      const fresh = await readRecord(address);
      if (fresh && fresh.version !== chain.version) {
        setChain(fresh);
        setMsg(ERROR_WORDS.StaleVersion);
        return;
      }
      const data = encodeFunctionData({ abi: WATCH_ABI as Abi, functionName: "save", args: [chain.version, watch.tokens, bytesToHex(settingsBytes)] });
      setMsg("Confirm the save in your wallet…");
      const hash = await sendTransaction({ to: CONTRACTS.watch, data });
      setTx(hash);
      setMsg("Sent. Waiting for the block…");
      const r = await waitForReceipt(hash);
      setMsg(r.ok ? `Saved as version ${chain.version + 1} in block ${r.blockNumber}.` : "The transaction reverted; nothing was saved.");
      await load();
    } catch (e) {
      setMsg(explain(e));
    } finally {
      setBusy(false);
    }
  }

  function exportFile() {
    const blob = new Blob([JSON.stringify({ kind: "fliqo-watchlist", v: 1, ...watch }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "fliqo-watchlist.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }
  async function importFile(f: File | undefined) {
    if (!f) return;
    if (f.size > 64_000) return setMsg("That file is too large to be a watchlist.");
    try {
      const w = cleanWatch(JSON.parse(await f.text()));
      replace(w);
      setMsg(`Imported ${w.tokens.length} tokens.`);
    } catch {
      setMsg("That file is not a watchlist export.");
    }
  }

  return (
    <section className="fq-card mt-6" aria-labelledby="sync-title" data-testid="watch-sync">
      <CardHead id="sync-title" title="Sync across devices" tag={live ? "FliqoWatchBook" : "practice"}>
        {live ? (
          <a href={explorerAddress(CONTRACTS.watch)} target="_blank" rel="noreferrer" className="hover:text-fg">
            {shortAddress(CONTRACTS.watch)} ↗
          </a>
        ) : (
          <span>contract not deployed yet</span>
        )}
      </CardHead>
      <div className="fq-card-body">
        {!live ? (
          <p className="fq-note">
            The FliqoWatchBook contract is not deployed yet, so nothing is written to {CHAIN.name}. Your list stays in this browser. To move it now, export the file here and import it on the other device.
          </p>
        ) : !address ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="fq-note">Connect a wallet to save this list on chain (one record per wallet, public to anyone) or to load the list you saved from another device.</p>
            <button type="button" className="fq-btn arrow" onClick={open}>
              Connect wallet
            </button>
          </div>
        ) : !onRobinhoodChain ? (
          <button type="button" className="fq-btn" onClick={switchNetwork}>
            Switch to {CHAIN.name}
          </button>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            <dl>
              <div className="fq-kv">
                <dt>On chain</dt>
                <dd data-testid="chain-version">{chain === undefined ? "reading…" : chain && chain.version ? `version ${chain.version} · ${chain.watch.tokens.length} tokens` : "nothing saved yet"}</dd>
              </div>
              <div className="fq-kv">
                <dt>Saved in block</dt>
                <dd>{chain && chain.version ? int(chain.savedBlock) : "—"}</dd>
              </div>
              <div className="fq-kv">
                <dt>This browser</dt>
                <dd>
                  {watch.tokens.length} tokens · {chain ? (synced ? <span className="up">same as chain</span> : <span className="text-warn">differs</span>) : "—"}
                </dd>
              </div>
              <div className="fq-kv">
                <dt>Gas for a save</dt>
                <dd>about {int(saveGasEstimate(watch.tokens.length, settingsBytes?.length ?? 0))} (network fee only)</dd>
              </div>
            </dl>
            <div className="flex flex-col gap-3">
              <button type="button" className="fq-btn lime" disabled={busy || !chain || synced || Boolean(tooLarge)} onClick={save} data-testid="sync-save">
                {busy ? "Saving…" : `Save this list on chain${chain ? ` (version ${chain.version + 1})` : ""}`}
              </button>
              <button type="button" className="fq-btn quiet" disabled={busy || !chain || !chain.version || synced} onClick={() => chain && replace(chain.watch)} data-testid="sync-load">
                Load the on-chain list here
              </button>
              <p className="fq-note">A save names the version it builds on, so an older device cannot overwrite a newer list by accident. Everything saved is public.</p>
            </div>
          </div>
        )}
        {tooLarge ? <p className="mt-3 text-[13px] text-down">{tooLarge}</p> : null}
        <div className="mt-6 flex flex-wrap gap-3 border-t border-line pt-5">
          <button type="button" className="fq-btn quiet h-9 text-[13px]" onClick={exportFile}>
            Export file
          </button>
          <label className="fq-btn quiet h-9 cursor-pointer text-[13px]">
            Import file
            <input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => importFile(e.target.files?.[0])} />
          </label>
        </div>
        {msg ? (
          <p className="mt-3 text-[13px] text-text-2" role="status" data-testid="sync-msg">
            {msg}{" "}
            {tx ? (
              <a href={explorerTx(tx)} target="_blank" rel="noreferrer" className="text-lime underline">
                transaction ↗
              </a>
            ) : null}
          </p>
        ) : null}
        <p className="mt-3">
          <Src>On-chain record: tokens (at most 50) + thresholds (at most 1,536 bytes) per wallet, read back with watchlistOf().</Src>
        </p>
      </div>
    </section>
  );
}
