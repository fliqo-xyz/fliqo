import type { MetadataRoute } from "next";
import { BRAND } from "@/config/brand";

// Every indexable page. Wallet and browser-only screens (/watchlist, /portfolio), per-token pages (generated on
// request for any address) and the owner page stay out.
export const ROUTES = ["", "/compare", "/pools", "/how", "/token"];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return ROUTES.map((r) => ({ url: `${BRAND.url}${r}`, lastModified: now, changeFrequency: r === "" ? "daily" : "weekly", priority: r === "" ? 1 : 0.6 }));
}
