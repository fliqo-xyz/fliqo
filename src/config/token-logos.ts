import LIST from "@/config/token-logos.generated.json";

/*
 * Token logos kept in public/tokens/<address>.webp (copied by scripts/sync-token-logos.mjs, never loaded from a
 * third party at runtime). A token without a file gets a drawn glyph from its address and symbol.
 */
const SET = new Set<string>((LIST as { addresses: string[] }).addresses);

export function logoFor(address: string): string | null {
  const a = address.toLowerCase();
  return SET.has(a) ? `/tokens/${a}.webp` : null;
}
