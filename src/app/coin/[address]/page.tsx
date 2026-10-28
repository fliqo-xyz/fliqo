import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CoinView } from "@/components/coin/CoinView";
import { pageMeta } from "@/lib/seo";

type Props = { params: Promise<{ address: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { address } = await params;
  return pageMeta({
    path: `/coin/${address.toLowerCase()}`,
    title: `Token ${address.slice(0, 6)}…${address.slice(-4)} on Robinhood Chain | Fliqo`,
    description: "Contract checks, pools, a live chart and a swap route preview for one Robinhood Chain token. Read-only; your wallet makes any swap.",
    noindex: true,
  });
}

export default async function CoinPage({ params }: Props) {
  const { address } = await params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) notFound();
  return <CoinView address={address.toLowerCase()} />;
}
