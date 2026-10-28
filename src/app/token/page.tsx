import { BRAND, LAUNCHPAD, TOKEN, buyUrl } from "@/config/brand";
import { faq } from "@/content/faq";
import { CaBlock } from "@/components/site/CopyCa";
import { Faq } from "@/components/site/Faq";
import { JsonLd } from "@/components/JsonLd";
import { TokenLive } from "@/components/token/TokenLive";
import { breadcrumbLd, faqLd, pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  path: "/token",
  title: "$FLIQO token | Fliqo",
  description: "The $FLIQO community token: where it launches, its contract address once published, and its planned utility. No promised value; not financial advice.",
});

const UTILITY = ["Analytics credits for deeper token and pool reports", "Premium monitoring and alerts while your tab is closed", "Developer API access to the same checks and previews"];

export default function TokenPage() {
  const items = faq().filter((f) => /token|\$/.test(f.q));
  return (
    <div className="fq-wrap pt-14">
      <JsonLd data={breadcrumbLd([{ name: BRAND.symbol, path: "/token" }])} />
      <JsonLd data={faqLd(items)} />
      <section className="fq-card p-10 max-[680px]:p-6">
        <p className="fq-kicker">Token</p>
        <h1 className="mt-4 text-[56px] leading-[1.05] font-light tracking-tight text-fg max-[680px]:text-[38px]">
          {BRAND.symbol}
          <span className="block text-muted">{TOKEN.isLive ? `Live on ${LAUNCHPAD.name}.` : `Launches on ${LAUNCHPAD.name}.`}</span>
        </h1>
        <p className="fq-note mt-5 max-w-[640px] text-[16px]">
          {BRAND.symbol} is the community token of {BRAND.name}. It carries no promised value, no yield and no claim on anything. Every {BRAND.name} feature on this site works without it.
        </p>
        <div className="mt-8 border-t border-line pt-6">
          <CaBlock />
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <a href={buyUrl()} target="_blank" rel="noreferrer" className="fq-btn lime" data-testid="buy">
            {TOKEN.isLive ? `Buy on ${LAUNCHPAD.name}` : `${LAUNCHPAD.name} · At launch`} ↗
          </a>
          <a href={BRAND.x} target="_blank" rel="noreferrer" className="fq-btn quiet">
            X {BRAND.xHandle}
          </a>
        </div>
        <p className="fq-note mt-4">Only the address shown on this page is ours. We never DM first and never ask for a key or a seed phrase.</p>
      </section>
      <TokenLive />
      <section className="fq-section">
        <p className="fq-kicker">Utility</p>
        <h2 className="fq-h2 mt-2 text-[34px]">
          Planned. <span>Not live.</span>
        </h2>
        <ul className="mt-6 grid gap-4 md:grid-cols-3">
          {UTILITY.map((u) => (
            <li key={u} className="fq-card p-6 text-[15px] text-muted">
              <span className="fq-tag">Planned</span>
              <p className="mt-3">{u}</p>
            </li>
          ))}
        </ul>
      </section>
      <section className="fq-section fq-card p-8 max-[680px]:p-5">
        <Faq items={items} />
      </section>
    </div>
  );
}
