import { WatchlistView } from "@/components/watch/WatchlistView";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  path: "/watchlist",
  title: "Watchlist and alerts | Fliqo",
  description: "Keep up to 50 Robinhood Chain tokens with your own price, move and liquidity thresholds, alerts in the open tab, and an optional on-chain copy that syncs across devices.",
  noindex: true,
});

export default function WatchlistPage() {
  return <WatchlistView />;
}
