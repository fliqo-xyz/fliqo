// EVM wallets that can add a custom network, and so can reach Robinhood Chain.
// Installed ones are found over EIP-6963 by their rdns; the rest are offered
// with an install link and, where the wallet publishes one, a mobile deep link
// that opens this site inside the wallet's own browser.

export type CatalogWallet = {
  id: string;
  name: string;
  /** EIP-6963 reverse-DNS ids this wallet announces itself with. */
  rdns: string[];
  install: string;
  /** Builds a link that opens `url` in the wallet's in-app browser. */
  deepLink?: (url: string) => string;
};

export const WALLET_CATALOG: CatalogWallet[] = [
  {
    id: "metamask",
    name: "MetaMask",
    rdns: ["io.metamask", "io.metamask.mobile"],
    install: "https://metamask.io/download/",
    deepLink: (url) => `https://metamask.app.link/dapp/${url.replace(/^https?:\/\//, "")}`,
  },
  { id: "rabby", name: "Rabby", rdns: ["io.rabby"], install: "https://rabby.io/" },
  {
    id: "okx",
    name: "OKX Wallet",
    rdns: ["com.okex.wallet"],
    install: "https://web3.okx.com/download",
    deepLink: (url) => `okx://wallet/dapp/url?dappUrl=${encodeURIComponent(url)}`,
  },
  {
    id: "coinbase",
    name: "Coinbase Wallet",
    rdns: ["com.coinbase.wallet"],
    install: "https://www.coinbase.com/wallet/downloads",
    deepLink: (url) => `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(url)}`,
  },
  {
    id: "trust",
    name: "Trust Wallet",
    rdns: ["com.trustwallet.app"],
    install: "https://trustwallet.com/download",
    deepLink: (url) => `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(url)}`,
  },
  { id: "rainbow", name: "Rainbow", rdns: ["me.rainbow"], install: "https://rainbow.me/download" },
  { id: "bitget", name: "Bitget Wallet", rdns: ["com.bitget.web3"], install: "https://web3.bitget.com/en/wallet-download" },
  { id: "zerion", name: "Zerion", rdns: ["io.zerion.wallet"], install: "https://zerion.io/download" },
  { id: "brave", name: "Brave Wallet", rdns: ["com.brave.wallet"], install: "https://brave.com/wallet/" },
];

/** Logo for an announced wallet, when the catalog knows it. */
export function catalogIcon(rdns: string) {
  const entry = WALLET_CATALOG.find((w) => w.rdns.includes(rdns));
  return entry ? `/wallets/${entry.id}.webp` : null;
}

/**
 * WalletConnect project id from cloud.reown.com. Optional: without it the
 * WalletConnect option is shown as not configured and everything else works.
 */
export const WALLETCONNECT_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";
