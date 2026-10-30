/*
 * Every brand image path in one place. The brand files (mark, wordmark, mark-square, icon, favicon, share card) come
 * from the owner's artwork (30 Oct 2026) via 2026/oktober/30/assets/apply-owner-assets.mjs; the art/ images are still
 * drawn by referensi/tools/make-brand.mjs. To swap an image, replace the file at the same path, or point the path
 * here at a new file; no component hard-codes an image path.
 */
export const ASSETS = {
  /** Transparent mark (header, footer). */
  mark: "/brand/mark.webp",
  /** Word mark: the owner's F mark + "Fliqo", keyed out of the banner, 322x120 (header). */
  wordmark: "/brand/wordmark.webp",
  /** Padded mark on the dark plate (wallet avatar, token avatar). */
  markSquare: "/brand/mark-square.webp",
  /** Square PNG served by Next from src/app/icon.png (structured data needs a PNG logo). */
  logoPng: "/icon.png",
  /** Share card served from src/app/opengraph-image.jpg. */
  og: "/opengraph-image.jpg",
  /** Hero backdrop: perspective grid with a lime glow (home hero card). */
  heroGrid: "/art/hero-grid.webp",
  /** "Flip the View" illustration: two price lines crossing (compare page head, how-it-works). */
  flip: "/art/flip-view.webp",
  /** Token page empty state and the 404 page. */
  lens: "/art/lens.webp",
} as const;
