/**
 * Floor tile pattern storage and caching.
 *
 * Stores full-color floor material PNGs loaded from assets/floors/ (PixelLab
 * art: see scripts/pixellab/floors.ts). A neutral ColorValue (h=s=b=c=0)
 * returns the material unchanged; any other value shifts it with the shared
 * colorize module's Adjust mode (HSL shift), so a room can still tint a
 * material without flattening its real texture to Photoshop Colorize's
 * single fixed hue. Caches the adjusted SpriteData by (pattern, h, s, b, c).
 */

import { FLOOR_TILE_SIZE } from '../../../core/src/assets/constants.ts';
import type { ColorValue } from '../components/ui/types.js';
import { CANVAS_ERROR_TILE_COLOR, FALLBACK_FLOOR_COLOR } from '../constants.js';
import { clearColorizeCache, getColorizedSprite } from './colorize.js';
import type { SpriteData } from './types.js';

/** Default solid gray tile (FLOOR_TILE_SIZE × FLOOR_TILE_SIZE art px) used when
 *  floor tile PNGs are not loaded */
const DEFAULT_FLOOR_SPRITE: SpriteData = Array.from(
  { length: FLOOR_TILE_SIZE },
  () => Array(FLOOR_TILE_SIZE).fill(FALLBACK_FLOOR_COLOR) as string[],
);

/** Module-level storage for floor tile sprites (set once on load) */
let floorSprites: SpriteData[] = [];

// Re-export WALL_COLOR from constants for backward compatibility
export { WALL_COLOR } from '../constants.js';

/** Set floor tile sprites (called once when extension sends floorTilesLoaded) */
export function setFloorSprites(sprites: SpriteData[]): void {
  floorSprites = sprites;
  clearColorizeCache();
}

/** Get the raw floor material sprite for a pattern index (1-9 -> array index 0-8).
 *  Falls back to the default solid gray tile when floors.png is not loaded. */
function getFloorSprite(patternIndex: number): SpriteData | null {
  const idx = patternIndex - 1;
  if (idx < 0) return null;
  if (idx < floorSprites.length) return floorSprites[idx];
  // No PNG sprites loaded — return default solid tile for any valid pattern index
  if (floorSprites.length === 0 && patternIndex >= 1) return DEFAULT_FLOOR_SPRITE;
  return null;
}

/** Get all floor sprites (for preview rendering, falls back to default solid tile) - unused */
// function getAllFloorSprites(): SpriteData[] {
//   return floorSprites.length > 0 ? floorSprites : [DEFAULT_FLOOR_SPRITE];
// }

/**
 * Get a tinted version of a floor material sprite.
 * A neutral ColorValue returns the material's own color untouched; any other
 * value shifts it with the shared colorize module's Adjust mode (hue/
 * saturation shift, brightness/contrast), never Photoshop Colorize, which
 * would discard the material's own color relationships.
 */
export function getColorizedFloorSprite(patternIndex: number, color: ColorValue): SpriteData {
  const base = getFloorSprite(patternIndex);
  if (!base) {
    const err: SpriteData = Array.from({ length: FLOOR_TILE_SIZE }, () =>
      Array(FLOOR_TILE_SIZE).fill(CANVAS_ERROR_TILE_COLOR),
    );
    return err;
  }
  if (color.h === 0 && color.s === 0 && color.b === 0 && color.c === 0) return base;

  const key = `floor-${patternIndex}-${color.h}-${color.s}-${color.b}-${color.c}`;
  return getColorizedSprite(key, base, { ...color, colorize: false });
}
