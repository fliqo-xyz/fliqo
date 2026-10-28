import { CompareView } from "@/components/compare/CompareView";
import { JsonLd } from "@/components/JsonLd";
import { breadcrumbLd, pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  path: "/compare",
  title: "Compare two Robinhood Chain markets | Fliqo",
  description: "Flip the View: put two tokens or two pools side by side, with price, liquidity, volume and contract checks, and both price lines on one chart.",
});

export default function ComparePage() {
  return (
    <>
      <JsonLd data={breadcrumbLd([{ name: "Compare", path: "/compare" }])} />
      <CompareView />
    </>
  );
}
