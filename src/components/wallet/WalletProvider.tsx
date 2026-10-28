"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { CHAIN as chain } from "@/config/brand";
import { WALLETCONNECT_PROJECT_ID } from "@/config/wallets";
import { useLocalStore } from "@/components/wallet/useLocalStore";
import { walletConnectProvider } from "@/components/wallet/walletconnect";
import { formatEth, rpc } from "@/lib/rpc";
import { storageKey } from "@/config/storage";

/**
 * Wallet connection over EIP-6963 browser wallets and WalletConnect.
 * Connecting shares an address and reports which network the wallet is
 * pointed at. Transactions (anchoring a scan report) are only requested when
 * the user asks for them and are signed in the wallet; no key ever reaches this site.
 */

export const ROBINHOOD_CHAIN_ID = chain.id;
export const WALLETCONNECT_RDNS = "walletconnect";
const CHAIN_ID_HEX = `0x${chain.id.toString(16)}`;

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (
    event: string,
    handler: (...args: unknown[]) => void,
  ) => void;
};

export type DiscoveredWallet = {
  uuid: string;
  rdns: string;
  name: string;
  icon: string;
  provider: Eip1193Provider;
  /** Set when the wallet can never reach Robinhood Chain. */
  unsupported: string | null;
};

/**
 * Wallets that announce EVM support but only speak a fixed list of networks.
 * They refuse both the switch and the add, so they stay listed but disabled.
 */
const UNSUPPORTED_WALLETS: Record<string, string> = {
  "app.phantom": `Phantom cannot add ${chain.name}`,
};

type WalletState = {
  wallets: DiscoveredWallet[];
  address: string | null;
  walletName: string | null;
  chainId: number | null;
  onRobinhoodChain: boolean;
  /** ETH balance on Robinhood Chain, read from the RPC; null while unknown. */
  balance: string | null;
  connecting: boolean;
  switching: boolean;
  error: string | null;
  /** Resolves true once an account is shared, whatever the network. */
  connect: (wallet: DiscoveredWallet) => Promise<boolean>;
  switchNetwork: () => Promise<void>;
  /** Sends a transaction from the connected account and resolves its hash. No `to` = contract deployment. */
  sendTransaction: (tx: { to?: string; data: string; value?: bigint }) => Promise<string>;
  /** personal_sign of a plain-text message by the connected account. */
  signMessage: (message: string) => Promise<string>;
  /** eth_signTypedData_v4 by the connected account (EIP-712 payload as an object). */
  signTypedData: (typedData: unknown) => Promise<string>;
  /** Re-reads the ETH balance now instead of waiting for the next poll. */
  refreshBalance: () => void;
  disconnect: () => void;
  clearError: () => void;
};

const WalletContext = createContext<WalletState | null>(null);

const STORAGE_KEY = storageKey("wallet");

type Remembered = { address: string; name: string; rdns: string } | null;

function errorCode(cause: unknown) {
  return (cause as { code?: number } | null)?.code;
}

/** Wallet errors are terse and inconsistent; say what actually happened. */
function describe(cause: unknown, fallback: string) {
  const code = errorCode(cause);
  if (code === 4001) return "The request was declined in the wallet.";
  if (code === -32002)
    return "The wallet already has a request open. Finish or dismiss it in the extension first.";
  if (cause instanceof Error && cause.message) return cause.message;
  return fallback;
}

async function readChainId(provider: Eip1193Provider) {
  const raw = (await provider.request({ method: "eth_chainId" })) as string;
  return Number.parseInt(raw, 16);
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [wallets, setWallets] = useState<DiscoveredWallet[]>([]);
  const [remembered, remember] = useLocalStore<Remembered>(STORAGE_KEY, null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // EIP-6963: providers announce themselves, so several can coexist without
  // fighting over `window.ethereum`. Keyed by rdns, which stays stable across
  // reloads where the per-page uuid does not.
  useEffect(() => {
    function add(wallet: DiscoveredWallet) {
      setWallets((current) =>
        current.some((entry) => entry.rdns === wallet.rdns)
          ? current
          : [...current, wallet],
      );
    }

    function onAnnounce(event: Event) {
      const detail = (event as CustomEvent).detail as {
        info: { uuid: string; name: string; icon: string; rdns: string };
        provider: Eip1193Provider;
      };
      if (!detail?.info || !detail.provider) return;
      const rdns = detail.info.rdns || detail.info.uuid;
      add({
        uuid: detail.info.uuid,
        rdns,
        name: detail.info.name,
        icon: detail.info.icon,
        provider: detail.provider,
        unsupported: UNSUPPORTED_WALLETS[rdns] ?? null,
      });
    }

    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    // WalletConnect reaches mobile and desktop wallets over a QR code. Its SDK
    // loads on first use, so listing it here costs nothing.
    if (WALLETCONNECT_PROJECT_ID) {
      add({
        uuid: WALLETCONNECT_RDNS,
        rdns: WALLETCONNECT_RDNS,
        name: "WalletConnect",
        icon: "/wallets/walletconnect.webp",
        provider: walletConnectProvider,
        unsupported: null,
      });
    }

    // Older wallets only inject `window.ethereum`. Offer it when nothing
    // announced itself, so those visitors are not told they have no wallet.
    const legacy = window.setTimeout(() => {
      const injected = (window as { ethereum?: Eip1193Provider }).ethereum;
      if (!injected) return;
      setWallets((current) =>
        current.some((entry) => entry.rdns !== WALLETCONNECT_RDNS)
          ? current
          : [
              ...current,
              {
                uuid: "injected",
                rdns: "injected",
                name: "Browser wallet",
                icon: "",
                provider: injected,
                unsupported: null,
              },
            ],
      );
    }, 600);

    return () => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      window.clearTimeout(legacy);
    };
  }, []);

  const active = useMemo(
    () =>
      remembered
        ? (wallets.find((entry) => entry.rdns === remembered.rdns) ?? null)
        : null,
    [remembered, wallets],
  );

  // Drop a session whose wallet never shows up: an entry saved by an older
  // build (keyed by uuid), or an extension that has since been removed.
  useEffect(() => {
    if (!remembered || active) return;
    if (!remembered.rdns) {
      remember(null);
      return;
    }
    const timer = window.setTimeout(() => remember(null), 2000);
    return () => window.clearTimeout(timer);
  }, [remembered, active, remember]);

  // A remembered session is only a hint. On load, ask the wallet whether it
  // still shares that account — it may have been locked or revoked since.
  useEffect(() => {
    if (!active || !remembered) return;
    let cancelled = false;
    const rememberedAddress = remembered.address.toLowerCase();

    active.provider
      .request({ method: "eth_accounts" })
      .then(async (value) => {
        if (cancelled) return;
        const accounts = ((value as string[]) ?? []).map((entry) =>
          entry.toLowerCase(),
        );
        if (!accounts.includes(rememberedAddress)) {
          remember(null);
          setChainId(null);
          return;
        }
        const id = await readChainId(active.provider);
        if (!cancelled) setChainId(id);
      })
      .catch(() => {
        if (!cancelled) setChainId(null);
      });

    const onChainChanged = (...args: unknown[]) => {
      setChainId(Number.parseInt(String(args[0]), 16));
    };
    const onAccountsChanged = (...args: unknown[]) => {
      const accounts = args[0] as string[];
      if (!accounts?.length) {
        remember(null);
        setChainId(null);
      } else if (accounts[0].toLowerCase() !== rememberedAddress) {
        remember({
          address: accounts[0],
          name: active.name,
          rdns: active.rdns,
        });
      }
    };

    active.provider.on?.("chainChanged", onChainChanged);
    active.provider.on?.("accountsChanged", onAccountsChanged);
    return () => {
      cancelled = true;
      active.provider.removeListener?.("chainChanged", onChainChanged);
      active.provider.removeListener?.("accountsChanged", onAccountsChanged);
    };
  }, [active, remembered, remember]);

  const moveToRobinhood = useCallback(async (provider: Eip1193Provider) => {
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: CHAIN_ID_HEX }],
      });
    } catch (switchError) {
      if (errorCode(switchError) === 4001) throw switchError;
      // 4902 is the standard "unknown chain"; some wallets use other codes
      // and still accept the add, so try it for anything but a refusal.
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: CHAIN_ID_HEX,
            chainName: chain.name,
            rpcUrls: [chain.publicRpc],
            blockExplorerUrls: [chain.explorer],
            nativeCurrency: {
              name: "Ether",
              symbol: chain.nativeSymbol,
              decimals: 18,
            },
          },
        ],
      });
    }
    setChainId(await readChainId(provider));
  }, []);

  const connect = useCallback(
    async (wallet: DiscoveredWallet) => {
      if (wallet.unsupported) {
        setError(`${wallet.unsupported}. Use MetaMask, Rabby or another wallet that supports custom networks.`);
        return false;
      }
      setConnecting(true);
      setError(null);
      try {
        const accounts = (await wallet.provider.request({
          method: "eth_requestAccounts",
        })) as string[];
        const account = accounts?.[0];
        if (!account) throw new Error("The wallet did not share an account.");
        remember({ address: account, name: wallet.name, rdns: wallet.rdns });

        const id = await readChainId(wallet.provider);
        setChainId(id);
        // Offer the network right away. Declining it keeps the connection;
        // the header then shows the wrong network and a way to switch.
        if (id !== chain.id) {
          try {
            await moveToRobinhood(wallet.provider);
          } catch {
            // Handled by the wrong-network state, not as a failed connect.
          }
        }
        return true;
      } catch (cause) {
        setError(describe(cause, "Could not connect."));
        return false;
      } finally {
        setConnecting(false);
      }
    },
    [remember, moveToRobinhood],
  );

  const switchNetwork = useCallback(async () => {
    if (!active) return;
    setSwitching(true);
    setError(null);
    try {
      await moveToRobinhood(active.provider);
    } catch (cause) {
      setError(describe(cause, `Could not switch to ${chain.name}.`));
    } finally {
      setSwitching(false);
    }
  }, [active, moveToRobinhood]);

  const sendTransaction = useCallback(
    async (tx: { to?: string; data: string; value?: bigint }) => {
      if (!active || !remembered) throw new Error("Connect a wallet first.");
      if ((await readChainId(active.provider)) !== chain.id) throw new Error(`Switch the wallet to ${chain.name} first.`);
      try {
        return (await active.provider.request({
          method: "eth_sendTransaction",
          params: [
            {
              from: remembered.address,
              ...(tx.to ? { to: tx.to } : {}),
              data: tx.data,
              ...(tx.value ? { value: `0x${tx.value.toString(16)}` } : {}),
            },
          ],
        })) as string;
      } catch (cause) {
        throw new Error(describe(cause, "The wallet did not send the transaction."));
      }
    },
    [active, remembered],
  );

  const signMessage = useCallback(
    async (message: string) => {
      if (!active || !remembered) throw new Error("Connect a wallet first.");
      const data = `0x${Array.from(new TextEncoder().encode(message), (b) => b.toString(16).padStart(2, "0")).join("")}`;
      try {
        return (await active.provider.request({
          method: "personal_sign",
          params: [data, remembered.address],
        })) as string;
      } catch (cause) {
        throw new Error(describe(cause, "The wallet did not sign the message."));
      }
    },
    [active, remembered],
  );

  const signTypedData = useCallback(
    async (typedData: unknown) => {
      if (!active || !remembered) throw new Error("Connect a wallet first.");
      try {
        return (await active.provider.request({
          method: "eth_signTypedData_v4",
          params: [remembered.address, JSON.stringify(typedData)],
        })) as string;
      } catch (cause) {
        throw new Error(describe(cause, "The wallet did not sign."));
      }
    },
    [active, remembered],
  );

  const disconnect = useCallback(() => {
    // Wallets that support it drop the site's permission too, so the next
    // connect asks again instead of reconnecting silently.
    active?.provider
      .request({
        method: "wallet_revokePermissions",
        params: [{ eth_accounts: {} }],
      })
      .catch(() => {});
    setChainId(null);
    setError(null);
    remember(null);
  }, [active, remember]);

  const clearError = useCallback(() => setError(null), []);

  const address = remembered?.address ?? null;
  const walletName = remembered?.name ?? null;

  // Balance comes from the chain's RPC, not the wallet, so it is the
  // Robinhood Chain balance whatever network the wallet is pointed at.
  const [balance, setBalance] = useState<string | null>(null);
  const [balanceTick, setBalanceTick] = useState(0);
  const refreshBalance = useCallback(() => setBalanceTick((n) => n + 1), []);
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    const load = () =>
      rpc<string>("eth_getBalance", [address, "latest"])
        .then((hex) => {
          if (!cancelled) setBalance(formatEth(hex));
        })
        .catch(() => {
          if (!cancelled) setBalance(null);
        });
    load();
    const timer = window.setInterval(load, 20000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      setBalance(null);
    };
  }, [address, chainId, balanceTick]);

  const value = useMemo(
    () => ({
      wallets,
      address,
      walletName,
      chainId,
      onRobinhoodChain: chainId === chain.id,
      balance: address ? balance : null,
      connecting,
      switching,
      error,
      connect,
      switchNetwork,
      sendTransaction,
      signMessage,
      signTypedData,
      refreshBalance,
      disconnect,
      clearError,
    }),
    [
      wallets,
      address,
      walletName,
      chainId,
      balance,
      connecting,
      switching,
      error,
      connect,
      switchNetwork,
      sendTransaction,
      signMessage,
      signTypedData,
      refreshBalance,
      disconnect,
      clearError,
    ],
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) throw new Error("useWallet must be used inside WalletProvider");
  return context;
}
