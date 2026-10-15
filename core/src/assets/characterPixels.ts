/**
 * Slices decoded RGBA pixel data for one character sheet into direction-keyed
 * frame arrays — no PNG library, no Node dependency, so it can run in both
 * the server (fed from pngjs) and the browser (fed from canvas ImageData).
 */

import { rgbaToHex } from './colorUtils.js';
import {
  CHAR_FRAME_H,
  CHAR_FRAME_W,
  CHAR_FRAMES_PER_ROW,
  CHARACTER_DIRECTIONS,
} from './constants.js';
import type { CharacterDirectionSprites } from './types.js';

/**
 * `data` MUST be `width × (CHAR_FRAME_H × CHARACTER_DIRECTIONS.length)` RGBA
 * pixels, `width` a multiple of CHAR_FRAME_W.
 */
export function characterPixelsToFrames(
  data: Uint8Array | Uint8ClampedArray,
  width: number,
): CharacterDirectionSprites {
  const charData: CharacterDirectionSprites = { down: [], up: [], right: [] };

  for (let dirIdx = 0; dirIdx < CHARACTER_DIRECTIONS.length; dirIdx++) {
    const dir = CHARACTER_DIRECTIONS[dirIdx];
    const rowOffsetY = dirIdx * CHAR_FRAME_H;
    const frames: string[][][] = [];

    for (let f = 0; f < CHAR_FRAMES_PER_ROW; f++) {
      const sprite: string[][] = [];
      const frameOffsetX = f * CHAR_FRAME_W;
      for (let y = 0; y < CHAR_FRAME_H; y++) {
        const row: string[] = [];
        for (let x = 0; x < CHAR_FRAME_W; x++) {
          const idx = ((rowOffsetY + y) * width + (frameOffsetX + x)) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          const a = data[idx + 3];
          row.push(rgbaToHex(r, g, b, a));
        }
        sprite.push(row);
      }
      frames.push(sprite);
    }
    charData[dir] = frames;
  }

  return charData;
}
