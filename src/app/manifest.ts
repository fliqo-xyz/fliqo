import type { MetadataRoute } from "next";
import { BRAND } from "@/config/brand";

/* Installable web app: "Add to Home Screen" on phones opens Fliqo full screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${BRAND.name}: ${BRAND.slogan.replace(/\.$/, "")}`,
    short_name: BRAND.name,
    description: BRAND.description,
    start_url: "/",
    display: "standalone",
    background_color: "#0a0c0f",
    theme_color: "#0a0c0f",
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
