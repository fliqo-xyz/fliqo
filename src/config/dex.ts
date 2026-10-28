/*
 * DEX facts for Robinhood Chain. Uniswap addresses are the ones Uniswap publishes for chain 4663 (its sdk-core
 * address book) and were each checked on chain on 24 Oct 2026 (quotes, pool state and position reads answered).
 * Pool lists and market numbers come from GeckoTerminal's public API (no key); everything that can be read from
 * chain (pool state, quotes, positions, snapshots) is read from chain.
 */

export const UNISWAP = {
  v2Factory: "0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f",
  v2Router: "0x89E5Db8b5aa49aa85AC63F691524311AeB649eBA",
  v3Factory: "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA",
  v3QuoterV2: "0x33e885Ed0ec9bf04ecFb19341582AadcB4c8A9E7",
  v3Positions: "0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3",
  v4PoolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
  v4StateView: "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b",
  v4Quoter: "0x8dc178efb8111BB0973dD9D722EbEFF267C98F94",
  v4Positions: "0x58daec3116aae6D93017bAAea7749052E8a04fA7",
  /** Universal Router: the `to` of real Uniswap swaps on chain 4663 (its poolManager() is v4PoolManager), 27 Oct 2026. */
  universalRouter: "0x8876789976decbfcbbbe364623c63652db8c0904",
  /** Canonical Permit2 (code present on chain 4663, 27 Oct 2026). */
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
} as const;

/** Spenders whose token approvals the Wallet page reads (plain ERC-20 allowance, plus Permit2 -> Universal Router). */
export const KNOWN_SPENDERS = [
  { address: UNISWAP.permit2, label: "Permit2 (Uniswap)" },
  { address: UNISWAP.universalRouter, label: "Uniswap Universal Router" },
  { address: UNISWAP.v2Router, label: "Uniswap v2 Router" },
] as const;

/**
 * Robinhood's token beacon. An official Robinhood Stock Token is a beacon proxy whose runtime code embeds this
 * address and whose name() ends in "Robinhood Token"; a ticker alone proves nothing (many tokens borrow tickers).
 */
export const STOCK_BEACON = "0xe10b6f6b275de231345c20d14ab812db62151b00";

/** Uniswap v3 fee tiers in hundredths of a basis point, with the tick spacing each one uses. */
export const V3_FEES = [100, 500, 3000, 10000] as const;

/** Network id of Robinhood Chain on GeckoTerminal. */
export const GT_NETWORK = "robinhood";

/** How the site reads a pool's state from chain. */
export type PoolKind = 2 | 3 | 4;

/** Short labels for venue ids as GeckoTerminal names them. Unknown ids fall back to a cleaned-up id. */
const VENUE_LABELS: Record<string, string> = {
  "uniswap-v2-robinhood": "Uniswap v2",
  "uniswap-v3-robinhood": "Uniswap v3",
  "uniswap-v4-robinhood": "Uniswap v4",
  "pancakeswap-v2-robinhood": "PancakeSwap v2",
  "pancakeswap-v3-robinhood": "PancakeSwap v3",
  "sushiswap-v2-robinhood": "SushiSwap v2",
  "sushiswap-v3-robinhood": "SushiSwap v3",
  "aero-slipstream-robinhood": "Aero Slipstream",
  "ramses-v3-robinhood": "Ramses v3",
  "pons-v2-dex": "Pons v2",
  "pons-dot-family": "Pons v1",
  "curve-robinhood": "Curve",
  "bankr-robinhood": "Bankr",
  "virtuals-robinhood": "Virtuals",
  "clanker-robinhood": "Clanker",
  "mint-club-robinhood": "Mint Club",
  "swaphood-finance-v2": "SwapHood v2",
  "swaphood-finance-v3": "SwapHood v3",
  robinswap: "RobinSwap",
  hoodit: "Hoodit",
  "easya-kickstart-robinhood": "EasyA Kickstart",
};

export function venueLabel(id: string): string {
  if (VENUE_LABELS[id]) return VENUE_LABELS[id];
  const clean = id.replace(/-robinhood$/, "").replace(/-/g, " ");
  return clean.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 28);
}

/** Short venue tag for small badges ("UNI V3"). */
export function venueTag(id: string): string {
  const l = venueLabel(id);
  return l
    .replace(/^Uniswap/, "Uni")
    .replace(/^PancakeSwap/, "Cake")
    .replace(/^SushiSwap/, "Sushi")
    .toUpperCase()
    .slice(0, 14);
}

/**
 * Which state reads apply to a pool. A 32-byte id is a Uniswap v4 pool (read through the StateView lens);
 * a 20-byte address is a v2-style pair or a v3-style pool, told apart by the venue id (and, when the venue is
 * unknown, by which read answers).
 */
export function poolKindOf(address: string, venue: string): PoolKind | null {
  if (/^0x[0-9a-fA-F]{64}$/.test(address)) return venue.startsWith("uniswap-v4") || venue.startsWith("pons-v2") || venue === "clanker-robinhood" || venue === "bankr-robinhood" ? 4 : null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return null;
  if (/-v2(-|$)/.test(venue) && !venue.startsWith("pons")) return 2;
  if (/-v3(-|$)|slipstream/.test(venue)) return 3;
  return null;
}

