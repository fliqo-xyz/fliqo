"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { CHAIN as chain, explorerAddress, shortAddress } from "@/config/brand";
import { WALLETCONNECT_RDNS, useWallet, type DiscoveredWallet } from "@/components/wallet/WalletProvider";
import { WALLET_CATALOG, catalogIcon } from "@/config/wallets";
import { ArrowUpRight, CheckIcon, CloseIcon, CopyIcon, FileIcon, LogOutIcon, RefreshIcon, SwapIcon, WalletIcon } from "@/components/site/Icons";

/* One wallet dialog for the whole site; every connect button opens it through this context. */

const ModalContext = createContext<{ open: () => void } | null>(null);

export function WalletModalProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const value = useCallback(() => setOpen(true), []);
  return (
    <ModalContext.Provider value={{ open: value }}>
      {children}
      {open ? <WalletDialog onClose={() => setOpen(false)} /> : null}
    </ModalContext.Provider>
  );
}

export function useWalletModal() {
  const context = useContext(ModalContext);
  if (!context) throw new Error("useWalletModal must be used inside WalletModalProvider");
  return context;
}

const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

function Glyph({ src }: { src: string | null }) {
   
  return src ? <img src={src} alt="" width={28} height={28} /> : <span className="ph grid place-items-center bg-sunk text-muted"><WalletIcon size={14} /></span>;
}

function Group({ n, label, children }: { n: string; label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="fq-wgroup-label">
        {n}. {label}
      </p>
      <div className="fq-wgroup-list">{children}</div>
    </div>
  );
}

function WalletDialog({ onClose }: { onClose: () => void }) {
  const { wallets, connect, connecting, error, clearError } = useWallet();
  const [pending, setPending] = useState<string | null>(null);

  const close = useCallback(() => {
    onClose();
    clearError();
  }, [onClose, clearError]);

  useEffect(() => {
    // Late-loading extensions announce on request, so ask again on open.
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [close]);

  const installed = wallets.filter((w) => w.rdns !== WALLETCONNECT_RDNS).sort((a, b) => Number(Boolean(a.unsupported)) - Number(Boolean(b.unsupported)));
  const walletConnect = wallets.find((w) => w.rdns === WALLETCONNECT_RDNS) ?? null;
  const detected = new Set(wallets.map((w) => w.rdns));
  const more = WALLET_CATALOG.filter((c) => !c.rdns.some((r) => detected.has(r)));
  const mobile = isMobile();
  const here = window.location.href;

  async function pick(wallet: DiscoveredWallet) {
    setPending(wallet.rdns);
    const ok = await connect(wallet);
    setPending(null);
    if (ok) onClose();
  }

  // Portalled to <body>: a blurred header would otherwise become the containing block and clip it.
  return createPortal(
    <div className="fq-modal" onClick={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-modal="true" aria-labelledby="wallet-title" className="fq-modal-box" data-testid="wallet-dialog">
        <div className="fq-modal-head">
          <div className="min-w-0">
            <span className="text-xs font-bold text-muted">Wallet signature · no password</span>
            <h2 id="wallet-title">Connect wallet</h2>
            <p>Markets, checks and quotes work without a wallet. Connecting shares your address so Fliqo can read your balances and transfers; anything that writes to the chain opens in your wallet for you to read and sign. Fliqo never holds a key and never swaps for you.</p>
          </div>
          <button type="button" aria-label="Close" onClick={close} className="fq-iconbtn shrink-0">
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="fq-modal-body">
          {installed.length ? (
            <Group n="1" label="Detected in this browser">
              {installed.map((wallet) => (
                <button key={wallet.rdns} type="button" disabled={connecting || Boolean(wallet.unsupported)} onClick={() => pick(wallet)} className="fq-wrow" data-testid={`wallet-${wallet.rdns}`}>
                  <Glyph src={wallet.icon || catalogIcon(wallet.rdns)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{wallet.name}</span>
                    <small>{wallet.unsupported ? `Not supported · ${wallet.unsupported}` : "Ready"}</small>
                  </span>
                  {pending === wallet.rdns ? <span className="go">Check wallet</span> : null}
                </button>
              ))}
            </Group>
          ) : null}

          <Group n={installed.length ? "2" : "1"} label="Phone wallets">
            {walletConnect ? (
              <button type="button" disabled={connecting} onClick={() => pick(walletConnect)} className="fq-wrow" data-testid="wallet-walletconnect">
                <Glyph src="/wallets/walletconnect.webp" />
                <span className="min-w-0 flex-1">
                  WalletConnect
                  <small>Scan a QR code with your phone</small>
                </span>
                {pending === WALLETCONNECT_RDNS ? <span className="go">Opening</span> : null}
              </button>
            ) : (
              <div className="fq-wrow" aria-disabled="true" data-testid="wallet-walletconnect">
                <Glyph src="/wallets/walletconnect.webp" />
                <span className="min-w-0 flex-1">
                  WalletConnect
                  <small>Not configured on this site yet</small>
                </span>
              </div>
            )}
          </Group>

          {more.length ? (
            <Group n={installed.length ? "3" : "2"} label={mobile ? "Open this site inside a wallet app" : `Get a wallet that reaches ${chain.name}`}>
              {more.map((w) => {
                const href = mobile && w.deepLink ? w.deepLink(here) : w.install;
                const label = mobile && w.deepLink ? "Open" : "Install";
                return (
                  <a key={w.id} href={href} target="_blank" rel="noreferrer" className="fq-wrow">
                    <Glyph src={`/wallets/${w.id}.webp`} />
                    <span className="min-w-0 flex-1 truncate">{w.name}</span>
                    <span className="go inline-flex items-center gap-1">
                      {label} <ArrowUpRight size={12} />
                    </span>
                  </a>
                );
              })}
            </Group>
          ) : null}

          {error ? (
            <p role="alert" className="fq-alert m-0">
              {error}
            </p>
          ) : null}
        </div>

        <p className="fq-modal-foot m-0">
          <span className="fq-dot" aria-hidden="true" />
          <span>
            {chain.name} · chain id {chain.id} · added to your wallet on connect
          </span>
        </p>
      </div>
    </div>,
    document.body,
  );
}

/* ---------- navbar / app bar control ---------- */

export function NavWallet({ label = "Connect", className = "btn-jelly min-h-11 px-4 text-[15px]", onlyConnected = false }: { label?: string; className?: string; onlyConnected?: boolean }) {
  const { address } = useWallet();
  const { open } = useWalletModal();
  if (address) return <AccountMenu />;
  if (onlyConnected) return null;
  return (
    <button type="button" onClick={open} className={className} data-testid="nav-connect">
      <span>{label}</span>
    </button>
  );
}

function AccountMenu() {
  const { address, walletName, chainId, balance, onRobinhoodChain, switchNetwork, switching, disconnect, error } = useWallet();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const WIDTH = 290;
    const position = () => {
      const rect = root.current?.getBoundingClientRect();
      if (!rect) return;
      setPlace({ top: rect.bottom + 10, left: Math.max(8, Math.min(rect.right - WIDTH, window.innerWidth - WIDTH - 8)) });
    };
    position();
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!root.current?.contains(target) && !menu.current?.contains(target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", position, true);
      window.removeEventListener("resize", position);
    };
  }, [open]);

  if (!address) return null;
  const wrong = chainId !== null && !onRobinhoodChain;

  return (
    <div ref={root} className="flex min-w-0 items-center">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="fq-acct"
        title={wrong ? `Wallet is on chain ${chainId}, not ${chain.name}` : `Connected on ${chain.name}`}
        data-testid="account-chip"
      >
        <span className={`fq-dot ${wrong ? "bad" : ""}`} data-testid="account-dot" aria-hidden="true" />
        <span>{shortAddress(address, 5, 4)}</span>
      </button>

      {open && place
        ? createPortal(
            <div ref={menu} role="menu" style={{ top: place.top, left: place.left }} className="fq-menu" data-testid="account-menu">
              <div className="flex items-center justify-between gap-2">
                <span className="fq-menu-label">{walletName ?? "Wallet"}</span>
                <span className={`inline-flex items-center gap-1.5 text-[11.5px] ${wrong ? "text-warn" : "text-up"}`} data-testid="account-network">
                  <span className={`fq-dot ${wrong ? "bad" : ""}`} />
                  {chainId === null ? "Reading network" : onRobinhoodChain ? chain.name : `Chain ${chainId}`}
                </span>
              </div>
              <span className="mt-2 block font-mono text-[12.5px] text-muted">{shortAddress(address, 10, 8)}</span>
              <span className="fq-menu-label mt-3 block">Native balance</span>
              <span className="block text-[24px] leading-tight font-light tracking-tight text-fg tabular-nums" data-testid="account-balance">
                {balance === null ? "…" : `${balance} ${chain.nativeSymbol}`}
              </span>
              {wrong ? (
                <button type="button" role="menuitem" disabled={switching} onClick={switchNetwork} className="btn-jelly mt-3 min-h-10 w-full text-sm" data-testid="account-switch">
                  <RefreshIcon size={13} /> {switching ? "Confirm in wallet…" : `Switch to ${chain.name}`}
                </button>
              ) : null}
              {wrong && error ? <p className="mt-2 text-[12px] text-warn">{error}</p> : null}
              <div className="mt-3">
                <Link role="menuitem" href="/" onClick={() => setOpen(false)} className="fq-menu-item" data-testid="account-open-app">
                  <SwapIcon size={13} /> Open app
                </Link>
                <Link role="menuitem" href="/portfolio" onClick={() => setOpen(false)} className="fq-menu-item">
                  <FileIcon size={13} /> My portfolio
                </Link>
                <button
                  type="button"
                  role="menuitem"
                  className="fq-menu-item"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(address);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1800);
                    } catch {
                      // Clipboard refused; the address stays readable above.
                    }
                  }}
                >
                  {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />} {copied ? "Copied" : "Copy address"}
                </button>
                <a role="menuitem" href={explorerAddress(address)} target="_blank" rel="noreferrer" className="fq-menu-item">
                  <ArrowUpRight size={13} /> View on explorer
                </a>
                <button
                  type="button"
                  role="menuitem"
                  className="fq-menu-item bad"
                  onClick={() => {
                    setOpen(false);
                    disconnect();
                  }}
                  data-testid="account-disconnect"
                >
                  <LogOutIcon size={13} /> Disconnect
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
