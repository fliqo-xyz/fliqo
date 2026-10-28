/* Deterministic colours and shapes for tokens and pairs that have no local logo (drawn, never fetched). */

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const HUES = [28, 38, 46, 96, 140, 172, 200, 214, 232, 258, 280, 312, 340, 8];

export function tokenColors(address: string): { a: string; b: string; ink: string } {
  const h = hashStr(address.toLowerCase());
  const hue = HUES[h % HUES.length];
  const sat = 38 + (h >>> 8) % 22;
  return { a: `hsl(${hue} ${sat}% 72%)`, b: `hsl(${(hue + 24) % 360} ${sat - 8}% 46%)`, ink: "#15140f" };
}

export function initials(symbol: string): string {
  const clean = symbol.replace(/[^A-Za-z0-9]/g, "");
  return (clean.slice(0, 1) || "?").toUpperCase();
}
