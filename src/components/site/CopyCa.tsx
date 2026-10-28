"use client";

import { useState } from "react";
import { BRAND, TOKEN, explorerToken, isAddress, shortAddress } from "@/config/brand";
import { CheckIcon, CopyIcon } from "@/components/site/Icons";

/* Contract address of $FLIQO from BRAND.ca. Until it is a real address every copy button says "At launch". */

function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!isAddress(BRAND.ca)) return;
    try {
      await navigator.clipboard.writeText(BRAND.ca);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard refused; the address stays visible.
    }
  };
  return { copied, copy };
}

/** Header pill: "$FLIQO · 0x12…abcd" (copies); "$FLIQO · At launch" until the address is published. */
export function CaPill() {
  const { copied, copy } = useCopy();
  const live = TOKEN.isLive;
  return (
    <button
      type="button"
      onClick={copy}
      disabled={!live}
      data-testid="ca-pill"
      className="fq-pill lime"
      aria-label={live ? `${BRAND.symbol} ${shortAddress(BRAND.ca, 4, 4)}: copy the contract address` : `${BRAND.symbol} At launch: the contract address is published at launch`}
      title={live ? BRAND.ca : "The contract address is published at launch"}
    >
      <span className="fq-live-dot" aria-hidden="true" />
      <span>{BRAND.symbol}</span>
      <span className="text-muted">· {live ? (copied ? "Copied" : shortAddress(BRAND.ca, 4, 4)) : "At launch"}</span>
      {live ? copied ? <CheckIcon size={12} /> : <CopyIcon size={12} /> : null}
    </button>
  );
}

/** "Official $FLIQO token  0x…  Copy" row (hero, footer). */
export function CaRow({ compact = false }: { compact?: boolean }) {
  const { copied, copy } = useCopy();
  const live = TOKEN.isLive;
  return (
    <div className={`grid max-w-full grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[auto_1fr_auto] ${compact ? "" : "rounded-lg border border-line bg-sunk px-3 py-2"}`} data-testid="ca-line">
      <span className="col-start-1 row-start-1 text-sm font-semibold whitespace-nowrap sm:text-[15px]">Official {BRAND.symbol} token</span>
      {live ? (
        <a className="col-span-2 row-start-2 min-w-0 font-mono text-[12px] break-all hover:underline sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:text-[13px]" href={explorerToken(BRAND.ca)} target="_blank" rel="noreferrer">
          {BRAND.ca}
        </a>
      ) : (
        <span className="col-span-2 row-start-2 min-w-0 text-[13px] text-muted sm:col-span-1 sm:col-start-2 sm:row-start-1">Contract address coming soon</span>
      )}
      <button type="button" onClick={copy} disabled={!live} data-testid="ca-copy-line" className="btn-quiet col-start-2 row-start-1 min-h-10 px-3 text-[13px] sm:col-start-3">
        {live ? (copied ? "Copied" : "Copy") : "At launch"}
      </button>
    </div>
  );
}

/** Large block for the token page. */
export function CaBlock() {
  const { copied, copy } = useCopy();
  const live = TOKEN.isLive;
  return (
    <div className="flex flex-wrap items-center justify-between gap-4" data-testid="ca-block">
      <div className="min-w-0">
        <p className="fq-label">Contract address · {BRAND.chainName}</p>
        {live ? (
          <a href={explorerToken(BRAND.ca)} target="_blank" rel="noreferrer" className="mt-2 block font-mono text-[13px] break-all hover:underline md:text-[14px]">
            {BRAND.ca}
          </a>
        ) : (
          <p className="mt-2 text-[15px] font-semibold">Contract address coming soon</p>
        )}
      </div>
      <button type="button" className="fq-btn" onClick={copy} disabled={!live} data-testid="ca-copy">
        {live ? copied ? <CheckIcon size={14} /> : <CopyIcon size={14} /> : null}
        {live ? (copied ? "Copied" : "Copy CA") : "At launch"}
      </button>
    </div>
  );
}
