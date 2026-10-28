import { ldJson } from "@/lib/seo";

/** Structured data for search engines, rendered on the server. */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={ldJson(data)} />;
}
