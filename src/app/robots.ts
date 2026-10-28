import type { MetadataRoute } from "next";
import { BRAND } from "@/config/brand";

export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", allow: "/", disallow: ["/api/"] }], sitemap: `${BRAND.url}/sitemap.xml` };
}
