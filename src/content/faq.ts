import { BRAND, CHAIN, LAUNCHPAD, TOKEN } from "@/config/brand";
import { watchLive } from "@/config/contracts";

/* Questions answered on the how-it-works and token pages (the same text feeds the FAQPage structured data). */

export function faq(): { q: string; a: string }[] {
  return [
    {
      q: `What is ${BRAND.name}?`,
      a: `${BRAND.name} is a trading intelligence site for ${CHAIN.name}. It lists tokens and pools with live numbers, puts two markets side by side, reads a token contract's configuration and previews a swap route (output, fee, price impact, minimum received) before you trade.`,
    },
    {
      q: `Does ${BRAND.name} trade for me or hold funds?`,
      a: `No. Quotes are eth_call simulations against the DEX quoter contracts and, for tokens still on a Pons curve, against the curve's own buy function. Nothing is signed or sent. The Swap button opens Pons or the pool's page, and you sign there in your own wallet. ${BRAND.name} has no deposit address and never asks for a key.`,
    },
    {
      q: "Does a clean set of checks mean a token is fine to buy?",
      a: "No. The checks say what the contract code and the pools show at one block: owner, proxy, functions that mint, pause, block addresses or switch trading, liquidity depth and recent flow. An owner can change behaviour later, and finding nothing is not a guarantee. They are facts to read, never a verdict, and nothing here is financial advice.",
    },
    {
      q: "Where do the numbers come from?",
      a: `Pool lists, prices, volumes, candles and swaps come from GeckoTerminal's public API for ${CHAIN.name}. Contract facts, quotes, balances and transfers are read from the chain itself. Every number names its source next to it; a number nobody published shows as "—".`,
    },
    {
      q: "Which quotes are real?",
      a: "Uniswap v2 (router), v3 (QuoterV2, single pool and two hops through WETH or USDG) and v4 (Quoter, for pools in the lists) on chain 4663, plus buys on a Pons bonding curve. Sells on a Pons curve need a token approval, so they are not simulated; the page says so and links to Pons.",
    },
    {
      q: "How do alerts work?",
      a: "You set thresholds per token (price above or below, 24h move, liquidity under). The open tab checks them every two minutes and, after you allow it, shows a browser notification. Email or push alerts while the tab is closed are planned, not built.",
    },
    {
      q: "What does the on-chain watchlist do?",
      a: watchLive()
        ? "FliqoWatchBook keeps one public record per wallet: up to 50 token addresses and your thresholds, with a version number. Save from one device, load on another. Each save costs only the network fee."
        : "FliqoWatchBook will keep one public record per wallet (up to 50 tokens and your thresholds, versioned) so the same list opens on any device. It is not deployed yet; until then the list stays in your browser and can be moved with a file export.",
    },
    {
      q: `What is ${BRAND.symbol}?`,
      a: TOKEN.isLive
        ? `${BRAND.symbol} is the community token of ${BRAND.name}, launched on ${LAUNCHPAD.name}. It carries no promised value, no yield and no claim on anything. Planned utility (analytics credits, premium monitoring, alerts, API) is planned, not live.`
        : `${BRAND.symbol} is the community token of ${BRAND.name}. It has not launched yet; it will launch on ${LAUNCHPAD.name} and its address will be published here first. It carries no promised value. Planned utility (analytics credits, premium monitoring, alerts, API) is planned, not live.`,
    },
  ];
}
