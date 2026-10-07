/**
 * Pixi draws with numeric 0xRRGGBB colors + separate alpha, while the shared
 * constants module (enforced by the no-inline-colors eslint rule) stores CSS
 * hex/rgba strings so both the 2D widget previews and the DOM/CSS layer can
 * consume them unchanged. These converters are the one seam between the two.
 */

/** `#RRGGBB` or `#RRGGBBAA` → `{ color: 0xRRGGBB, alpha: 0-1 }`. */
export function hexToPixiColor(hex: string): { color: number; alpha: number } {
  const color = parseInt(hex.slice(1, 7), 16);
  const alpha = hex.length > 7 ? parseInt(hex.slice(7, 9), 16) / 255 : 1;
  return { color, alpha };
}

/** `#RRGGBB(AA)` → `0xRRGGBB`, alpha channel (if present) is dropped. */
export function hexToNumber(hex: string): number {
  return parseInt(hex.slice(1, 7), 16);
}

/** `rgba(r, g, b, a)` / `rgb(r, g, b)` → `{ color: 0xRRGGBB, alpha: 0-1 }`. */
export function rgbaToPixiColor(css: string): { color: number; alpha: number } {
  const match = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/.exec(
    css,
  );
  if (!match) return { color: 0x000000, alpha: 1 };
  const r = Math.round(parseFloat(match[1]));
  const g = Math.round(parseFloat(match[2]));
  const b = Math.round(parseFloat(match[3]));
  const alpha = match[4] !== undefined ? parseFloat(match[4]) : 1;
  return { color: (r << 16) | (g << 8) | b, alpha };
}
