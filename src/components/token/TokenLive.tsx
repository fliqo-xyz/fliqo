"use client";

import { BRAND, TOKEN } from "@/config/brand";
import { useChain } from "@/components/providers/ChainProvider";
import { Src } from "@/components/ui/kit";
import { amount, int, usdShort } from "@/lib/format";

/* Live chain facts for the token page: block, gas, ETH / USD and, once the address is published, the token itself. */
export function TokenLive() {
  const { facts, failed } = useChain();
  const t = facts?.token;
  const supply = t?.supply && t.decimals !== null ? Number(t.supply) / 10 ** t.decimals : null;
  const rows = [
    { k: "Block", v: facts?.block ? int(facts.block) : "—" },
    { k: "Gas", v: facts?.gasGwei !== null && facts?.gasGwei !== undefined ? `${facts.gasGwei.toFixed(3)} gwei` : "—" },
    { k: "ETH / USD", v: usdShort(facts?.ethUsd) },
    { k: `${BRAND.symbol} supply`, v: TOKEN.isLive ? amount(supply) : "At launch" },
  ];
  return (
    <section className="fq-card mt-6 p-8 max-[680px]:p-5" aria-label="Live chain facts">
      <dl className="grid grid-cols-2 gap-6 md:grid-cols-4">
        {rows.map((r) => (
          <div key={r.k}>
            <dt className="fq-label">{r.k}</dt>
            <dd className="mt-2 text-[20px] font-light text-fg" data-testid={`live-${r.k}`}>
              {r.v}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-4">
        <Src>{failed ? "The chain could not be reached just now; retrying." : "Read from Robinhood Chain every 12 seconds (block, gas, Chainlink ETH / USD, the token contract once published)."}</Src>
      </p>
    </section>
  );
}
