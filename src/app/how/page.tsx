import Link from "next/link";
import { BRAND } from "@/config/brand";
import { ASSETS } from "@/config/assets";
import { CONTRACTS, watchLive } from "@/config/contracts";
import { faq } from "@/content/faq";
import { Faq } from "@/components/site/Faq";
import { JsonLd } from "@/components/JsonLd";
import { breadcrumbLd, faqLd, pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  path: "/how",
  title: "How Fliqo works: checks, comparisons and route previews",
  description: "Four steps from a contract address to a swap you sign yourself: read the checks, flip the view, preview the route, then trade in your own wallet. Sources, limits and risks, plainly.",
});

const STEPS = [
  { t: "Find a token", d: "Pick one from the live markets or paste any contract address. The token page loads its pools, its chart and the latest swaps." },
  { t: "Read the checks", d: "Fliqo reads the contract: ERC-20 answers, owner(), proxy slots and functions that mint, pause, block addresses, switch trading or set limits. Then the pools: depth, age and flow." },
  { t: "Flip the view", d: "Put it next to another token or pool. Price, depth, activity and both price lines rebased to the same start, larger marked as larger, never as better." },
  { t: "Preview, then swap yourself", d: "Choose buy or sell, an amount and your slippage. Fliqo asks the quoter contracts for the route. The Swap button opens Pons or the pool page; you sign there." },
];

const RULES = [
  { t: "Sources", d: "Lists, prices, volumes, candles and swaps: GeckoTerminal's public API for Robinhood Chain. Contract facts, quotes, balances and transfers: the chain. The source sits next to every number." },
  { t: "Checks", d: "Facts at one block, shown with what they were read from. They do not judge a token. An owner can change a contract after any read, and a check that finds nothing is not a guarantee." },
  { t: "Quotes", d: "eth_call simulations at one block: Uniswap v2, v3 (one pool or two hops through WETH or USDG) and v4 quoters, and the Pons curve's own buy. Nothing is signed or sent." },
  { t: "Price impact and minimum", d: "Impact is the cost beyond the pool's current price minus the pool fee. Minimum received is the expected output less your slippage tolerance (0.5%, 1% or 3%)." },
  { t: "Alerts", d: "Thresholds per token: price above or below, a 24h move, liquidity under a level. Checked every two minutes in the open tab; a browser notification only after you allow it." },
  { t: "Watchlist on chain", d: "FliqoWatchBook keeps one public, versioned record per wallet: at most 50 tokens and 1,536 bytes of thresholds. No owner, no fee, no token needed; only the network fee." },
  { t: "Fees", d: `${BRAND.name} charges nothing and never touches your funds. The venue you swap on charges its own pool fee, shown in the route preview.` },
  { t: "Unknown means unknown", d: "When no source publishes a number, the page shows a dash. Fliqo does not estimate holders, does not guess a circulating supply and does not fill gaps." },
];

const RISKS = [
  "Small tokens move fast. A thin pool can lose most of its price within minutes, and a quote is only true for the block it was read at.",
  "A contract owner, a proxy admin or a large holder can change what a token does or where its price goes. Checks show what exists, not what someone will do.",
  "Public data can be late or wrong. When the public API is busy, the last answer is shown and marked as delayed.",
  "Nothing on this site is financial advice. Fliqo shows information; every decision and every signature is yours.",
];

const PLANNED = ["Premium analytics", "Monitoring while the tab is closed (push and email alerts)", "Developer API", `${BRAND.symbol} utility: analytics credits, premium monitoring, alerts, API access`];

export default function HowPage() {
  const items = faq();
  return (
    <div className="fq-wrap pt-14">
      <JsonLd data={breadcrumbLd([{ name: "How it works", path: "/how" }])} />
      <JsonLd data={faqLd(items)} />
      <p className="fq-kicker">How it works</p>
      <h1 className="mt-4 text-[56px] leading-[1.05] font-light tracking-tight text-fg max-[680px]:text-[38px]">
        Read first,
        <span className="block text-muted">then trade.</span>
      </h1>
      <p className="mt-6 max-w-[760px] text-[18px] leading-relaxed text-muted">
        {BRAND.name} turns a contract address into something you can understand: what the token&apos;s code allows, where its liquidity sits, how it compares with another market and what a swap would really return. The swap itself always happens in your wallet.
      </p>
      <ol className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s, i) => (
          <li key={s.t} className="fq-card p-8">
            <p className="fq-kicker">Step {String(i + 1).padStart(2, "0")}</p>
            <h2 className="mt-4 text-[17px] text-fg">{s.t}</h2>
            <p className="mt-3 text-[15px] leading-relaxed text-muted">{s.d}</p>
          </li>
        ))}
      </ol>

      <section className="fq-section">
        <p className="fq-kicker">The rules</p>
        <h2 className="fq-h2 mt-2 text-[34px]">
          Same for every token. <span>Written down.</span>
        </h2>
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          {RULES.map((r) => (
            <article key={r.t} className="fq-card p-6">
              <h3 className="text-[15px] text-fg">{r.t}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-muted">{r.d}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="fq-section grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div>
          <p className="fq-kicker">Risks</p>
          <h2 className="fq-h2 mt-2 text-[34px]">Plainly.</h2>
          <ul className="mt-6 flex flex-col gap-4">
            {RISKS.map((r) => (
              <li key={r} className="border-l border-[var(--lime-line)] pl-4 text-[15px] leading-relaxed text-muted">
                {r}
              </li>
            ))}
          </ul>
          <p className="mt-6 text-[14px] text-muted">
            Watchlist contract:{" "}
            {watchLive() ? <span className="text-fg">{CONTRACTS.watch}</span> : <span>not deployed yet (the watchlist runs in your browser meanwhile)</span>}
          </p>
        </div>
        <img src={ASSETS.flip} alt="Two price lines crossing on a dark grid" width={420} height={260} className="w-full rounded-lg border border-line" />
      </section>

      <section className="fq-section">
        <p className="fq-kicker">Planned</p>
        <h2 className="fq-h2 mt-2 text-[34px]">
          Not built yet. <span>Labelled as such.</span>
        </h2>
        <ul className="mt-6 flex flex-wrap gap-3">
          {PLANNED.map((p) => (
            <li key={p} className="flex items-center gap-3 rounded-2xl border border-[var(--line-2)] px-4 py-2 text-[14px] text-fg">
              <span className="fq-tag shrink-0">Planned</span> {p}
            </li>
          ))}
        </ul>
      </section>

      <section className="fq-section fq-card p-8 max-[680px]:p-5" aria-labelledby="faq-title">
        <h2 id="faq-title" className="text-[20px] font-light text-fg">
          Questions
        </h2>
        <div className="mt-4">
          <Faq items={items} />
        </div>
        <p className="mt-6">
          <Link href="/" className="fq-btn arrow">
            Open the markets
          </Link>
        </p>
      </section>
    </div>
  );
}
