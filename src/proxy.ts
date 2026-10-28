import { NextResponse, type NextRequest } from "next/server";
import { BRAND, DOMAIN_LIVE } from "@/config/brand";

/*
 * Keeps *.vercel.app from competing with the real domain in search results:
 * the production deployment's vercel.app host redirects to the domain, and
 * preview deployments are marked noindex. Until DOMAIN_LIVE is true the production vercel.app host is
 * served as is (also noindex), because the domain does not resolve yet.
 */
export function proxy(request: NextRequest) {
  const host = (request.headers.get("host") ?? "").toLowerCase();
  // Host fixed to the brand domain; the path is assigned, never parsed as a URL, so "//other.host" stays a path.
  const toBrand = () => {
    const url = new URL(BRAND.url);
    url.pathname = request.nextUrl.pathname;
    url.search = request.nextUrl.search;
    return NextResponse.redirect(url, 308);
  };
  if (host === `www.${BRAND.domain}`) return toBrand();
  if (!host.endsWith(".vercel.app")) return NextResponse.next();
  if (DOMAIN_LIVE && process.env.VERCEL_ENV === "production") return toBrand();
  const response = NextResponse.next();
  response.headers.set("X-Robots-Tag", "noindex");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
