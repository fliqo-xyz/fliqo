import { PoolsView } from "@/components/pools/PoolsView";
import { JsonLd } from "@/components/JsonLd";
import { breadcrumbLd, pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  path: "/pools",
  title: "Robinhood Chain liquidity overview | Fliqo",
  description: "Where the liquidity on Robinhood Chain sits: totals per DEX, what pools are paired with, and the deepest pools, from public pool lists with every source shown.",
});

export default function PoolsPage() {
  return (
    <>
      <JsonLd data={breadcrumbLd([{ name: "Pools", path: "/pools" }])} />
      <PoolsView />
    </>
  );
}
