"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { BRAND, TOKEN, buyUrl, explorerAddress, explorerToken, hasGithub, isAddress, shortAddress } from "@/config/brand";
import { ASSETS } from "@/config/assets";
import { CONTRACTS, watchLive } from "@/config/contracts";
import { CaPill } from "@/components/site/CopyCa";
import { GithubIcon, SearchIcon } from "@/components/site/Icons";
import { Ticker } from "@/components/shell/Ticker";
import { NavWallet } from "@/components/wallet/WalletButton";

export const NAV = [
  { href: "/", label: "Markets" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/pools", label: "Pools" },
  { href: "/how", label: "How it works" },
] as const;

const isActive = (path: string, href: string) => (href === "/" ? path === "/" || path.startsWith("/coin") : path.startsWith(href));

/** Paste box shared by the header and the hero: a 0x address opens that token's page. */
export function useOpenToken() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const v = value.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(v)) {
      setError("Paste a token contract address: 0x followed by 40 hex characters.");
      return;
    }
    setError(null);
    router.push(`/coin/${v.toLowerCase()}`);
  };
  return { value, setValue, error, submit };
}

function HeaderSearch() {
  const { value, setValue, error, submit } = useOpenToken();
  return (
    <form onSubmit={submit} className="fq-search fq-hide-1360 w-[180px]" role="search" title={error ?? "Paste a token contract address"}>
      <SearchIcon size={13} />
      <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Paste a contract address" aria-label="Open a token by contract address" spellCheck={false} />
    </form>
  );
}

function ViewToggle() {
  const path = usePathname() ?? "/";
  const flip = path.startsWith("/compare");
  return (
    <div className="fq-toggle" role="group" aria-label="View">
      <Link href="/" aria-current={!flip ? "true" : undefined} title="One market at a time">
        Single
      </Link>
      <Link href="/compare" aria-current={flip ? "true" : undefined} title="Flip the View: two markets side by side" data-testid="toggle-flip">
        Flip
      </Link>
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname() ?? "/";
  return (
    <>
      <header className="fq-header">
        <div className="fq-header-row">
          <Link href="/" className="flex shrink-0 items-center gap-2" aria-label={`${BRAND.name} home`}>
            <img src={ASSETS.wordmark} alt={BRAND.name} width={81} height={30} className="h-[30px] w-auto" />
          </Link>
          <nav className="fq-nav fq-hide-960" aria-label="Main">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} aria-current={isActive(path, n.href) ? "page" : undefined}>
                {n.label}
              </Link>
            ))}
            <Link href="/#movers" className="fq-nav-live">
              <span className="fq-live-dot" aria-hidden="true" />
              Movers
            </Link>
          </nav>
          <div className="ml-auto flex min-w-0 items-center gap-3">
            <span className="fq-hide-680">
              <ViewToggle />
            </span>
            <span className="fq-hide-1240">
              <CaPill />
            </span>
            <HeaderSearch />
            {hasGithub ? (
              <a href={BRAND.github} target="_blank" rel="noreferrer" aria-label={`${BRAND.name} source code on GitHub`} title="Source code on GitHub" className="fq-hide-680 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line text-muted transition-colors hover:text-fg">
                <GithubIcon size={18} />
              </a>
            ) : null}
            <NavWallet label="Connect wallet" className="fq-btn arrow" />
          </div>
        </div>
        <nav className="fq-scroll border-t border-line min-[961px]:hidden" aria-label="Main (compact)">
          <div className="flex w-max items-center gap-1 px-3 py-2">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} aria-current={isActive(path, n.href) ? "page" : undefined} className={`rounded-full px-3 py-1.5 text-[13px] ${isActive(path, n.href) ? "bg-panel-2 text-fg" : "text-muted"}`}>
                {n.label}
              </Link>
            ))}
            <Link href="/compare" aria-current={path.startsWith("/compare") ? "page" : undefined} className={`rounded-full px-3 py-1.5 text-[13px] ${path.startsWith("/compare") ? "bg-panel-2 text-fg" : "text-muted"}`}>
              Compare
            </Link>
            <Link href="/token" className="rounded-full px-3 py-1.5 text-[13px] text-muted">
              {BRAND.symbol}
            </Link>
          </div>
        </nav>
        <Ticker />
      </header>
      <main id="main">{children}</main>
      <Footer />
    </>
  );
}

function Footer() {
  return (
    <footer className="fq-footer">
      <div className="fq-wrap">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
          <div className="flex items-center gap-3">
            <img src={ASSETS.mark} alt="" width={28} height={28} className="h-7 w-7" />
            <span className="text-[13px] text-muted">trading intelligence for {BRAND.chainName} · {BRAND.symbol} launches on Pons</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted">
            {TOKEN.isLive ? (
              <a href={explorerToken(BRAND.ca)} target="_blank" rel="noreferrer" className="hover:text-text-2">
                {BRAND.symbol} {shortAddress(BRAND.ca, 6, 4)}
              </a>
            ) : (
              <a href={buyUrl()} target="_blank" rel="noreferrer" className="hover:text-text-2">
                {BRAND.symbol} · At launch
              </a>
            )}
            {watchLive() ? (
              <a href={explorerAddress(CONTRACTS.watch)} target="_blank" rel="noreferrer" className="hover:text-text-2">
                watchbook {shortAddress(CONTRACTS.watch, 6, 4)}
              </a>
            ) : (
              <span>watchbook · not deployed yet</span>
            )}
            <span>Not financial advice. Check before you trade.</span>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-muted">
          {[...NAV, { href: "/compare", label: "Compare" }, { href: "/token", label: BRAND.symbol }].map((n) => (
            <Link key={n.href} href={n.href} className="hover:text-text-2">
              {n.label}
            </Link>
          ))}
          <a href={BRAND.x} target="_blank" rel="noreferrer" className="hover:text-text-2">
            X {BRAND.xHandle}
          </a>
          {hasGithub ? (
            <a href={BRAND.github} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-text-2">
              <GithubIcon size={14} />
              GitHub
            </a>
          ) : null}
          {isAddress(BRAND.ca) ? null : <span className="text-dim">Contract address: published at launch</span>}
        </div>
      </div>
    </footer>
  );
}
