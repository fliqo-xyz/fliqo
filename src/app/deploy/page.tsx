import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { BRAND } from "@/config/brand";
import { DeployPanel } from "@/components/deploy/DeployPanel";
import ART from "@/lib/contracts/artifacts.json";

export const metadata: Metadata = {
  title: "Deploy contracts",
  description: `Owner tool: deploy the ${BRAND.name} contract from your own wallet.`,
  robots: { index: false, follow: false },
};

// Owner tool, local only: on any public host this route is a 404.
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export const dynamic = "force-dynamic";

/** Measured with forge on an anvil chain (see referensi/DEPLOY.txt, kept outside the public repository). */
const DEPLOY_GAS = "917,000";

export default async function DeployPage() {
  const host = (await headers()).get("host") ?? "";
  if (!LOCAL_HOST.test(host)) notFound();
  return (
    <div className="fq-wrap py-14">
      <p className="fq-kicker">Owner tool · localhost only</p>
      <h1 className="mt-3 text-[40px] font-light text-fg">Deploy FliqoWatchBook</h1>
      <p className="fq-note mt-4 max-w-[720px] text-[15px]">
        One transaction, signed in your wallet on Robinhood Chain. No constructor arguments, no owner, no fee and no token needed, so it can go live before the token launches. Progress is kept in this browser. Deployment uses about {DEPLOY_GAS} gas (eth_estimateGas on Robinhood Chain, 29 Oct 2026).
      </p>
      <div className="mt-8 max-w-[900px]">
        <DeployPanel book={{ creation: ART.contracts.FliqoWatchBook.creation, sha256: ART.contracts.FliqoWatchBook.sha256 }} />
      </div>
    </div>
  );
}
