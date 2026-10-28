import { PortfolioView } from "@/components/portfolio/PortfolioView";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  path: "/portfolio",
  title: "Portfolio and wallet activity | Fliqo",
  description: "Balances of your Robinhood Chain wallet at live pool prices and its recent token transfers, read from the chain. Read-only.",
  noindex: true,
});

export default function PortfolioPage() {
  return <PortfolioView />;
}
