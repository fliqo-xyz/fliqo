import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next writes agent instruction files at the repo root unless this is off.
  // The public repository carries no Markdown but its README.
  agentRules: false,
  // Put metadata in <head> for every client, so titles, canonicals and share
  // cards are in the first HTML any crawler or link previewer reads.
  htmlLimitedBots: /.*/,
  // Lets a second build (local end-to-end tests) live next to the production one.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
