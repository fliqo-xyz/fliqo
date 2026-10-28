import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { BRAND } from "@/config/brand";
import { JsonLd } from "@/components/JsonLd";
import { Shell } from "@/components/shell/Shell";
import { ChainProvider } from "@/components/providers/ChainProvider";
import { MarketProvider } from "@/components/providers/MarketProvider";
import { WalletModalProvider } from "@/components/wallet/WalletButton";
import { WalletProvider } from "@/components/wallet/WalletProvider";
import { HOME_DESCRIPTION, HOME_TITLE, siteLd } from "@/lib/seo";

const inter = Inter({ subsets: ["latin"], weight: ["300", "400", "500", "600"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(BRAND.url),
  title: { default: HOME_TITLE, template: `%s | ${BRAND.name}` },
  description: HOME_DESCRIPTION,
  applicationName: BRAND.name,
  alternates: { canonical: "/" },
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: BRAND.name, statusBarStyle: "black-translucent" },
  openGraph: { type: "website", url: BRAND.url, siteName: BRAND.name, title: HOME_TITLE, description: HOME_DESCRIPTION, locale: "en_US" },
  twitter: { card: "summary_large_image", site: BRAND.xHandle, creator: BRAND.xHandle, title: HOME_TITLE, description: HOME_DESCRIPTION },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0c0f",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.variable}>
      <head>
        <JsonLd data={siteLd} />
      </head>
      <body>
        <WalletProvider>
          <WalletModalProvider>
            <ChainProvider>
              <MarketProvider>
                <Shell>{children}</Shell>
              </MarketProvider>
            </ChainProvider>
          </WalletModalProvider>
        </WalletProvider>
      </body>
    </html>
  );
}
