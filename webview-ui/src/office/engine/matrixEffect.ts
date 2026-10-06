import type { Graphics } from 'pixi.js';

import {
  MATRIX_COLUMN_STAGGER_RANGE,
  MATRIX_FLICKER_FPS,
  MATRIX_FLICKER_VISIBILITY_THRESHOLD,
  MATRIX_HEAD_COLOR,
  MATRIX_SPRITE_COLS,
  MATRIX_SPRITE_ROWS,
  MATRIX_TRAIL_DIM_THRESHOLD,
  MATRIX_TRAIL_EMPTY_ALPHA,
  MATRIX_TRAIL_LENGTH,
  MATRIX_TRAIL_MID_THRESHOLD,
  MATRIX_TRAIL_OVERLAY_ALPHA,
  matrixGreenBright,
  matrixGreenDim,
  matrixGreenMid,
} from '../../constants.js';
import type { Character, SpriteData } from '../types.js';
import { MATRIX_EFFECT_DURATION } from '../types.js';
import { hexToPixiColor, rgbaToPixiColor } from './pixiColor.js';

/** Hash-based flicker: ~70% visible for shimmer effect */
function flickerVisible(col: number, row: number, time: number): boolean {
  const t = Math.floor(time * MATRIX_FLICKER_FPS);
  const hash = (col * 7 + row * 13 + t * 31) & 0xff;
  return hash < MATRIX_FLICKER_VISIBILITY_THRESHOLD;
}

const HEAD_COLOR = hexToPixiColor(MATRIX_HEAD_COLOR);

function trailColor(trailPos: number, alpha: number): { color: number; alpha: number } {
  if (trailPos < MATRIX_TRAIL_MID_THRESHOLD) return rgbaToPixiColor(matrixGreenBright(alpha));
  if (trailPos < MATRIX_TRAIL_DIM_THRESHOLD) return rgbaToPixiColor(matrixGreenMid(alpha));
  return rgbaToPixiColor(matrixGreenDim(alpha));
}

/**
 * Draw a character's Matrix-style digital rain spawn/despawn effect into a
 * (pre-cleared) Graphics object. Per-pixel: each column sweeps top-to-bottom
 * with a bright head and a fading green trail, drawn as individual filled
 * rects so the per-pixel color math (trail fade, flicker, head/trail/base
 * zones) stays identical regardless of render target.
 */
export function drawMatrixEffect(
  gfx: Graphics,
  ch: Character,
  spriteData: SpriteData,
  drawX: number,
  drawY: number,
  zoom: number,
): void {
  const progress = ch.matrixEffectTimer / MATRIX_EFFECT_DURATION;
  const isSpawn = ch.matrixEffect === 'spawn';
  const time = ch.matrixEffectTimer;
  const totalSweep = MATRIX_SPRITE_ROWS + MATRIX_TRAIL_LENGTH;

  for (let col = 0; col < MATRIX_SPRITE_COLS; col++) {
    const stagger = (ch.matrixEffectSeeds[col] ?? 0) * MATRIX_COLUMN_STAGGER_RANGE;
    const colProgress = Math.max(
      0,
      Math.min(1, (progress - stagger) / (1 - MATRIX_COLUMN_STAGGER_RANGE)),
    );
    const headRow = colProgress * totalSweep;

    for (let row = 0; row < MATRIX_SPRITE_ROWS; row++) {
      const pixel = spriteData[row]?.[col];
      const hasPixel = pixel && pixel !== '';
      const distFromHead = headRow - row;
      const px = drawX + col * zoom;
      const py = drawY + row * zoom;

      if (isSpawn) {
        if (distFromHead < 0) {
          continue;
        } else if (distFromHead < 1) {
          gfx.rect(px, py, zoom, zoom).fill(HEAD_COLOR);
        } else if (distFromHead < MATRIX_TRAIL_LENGTH) {
          const trailPos = distFromHead / MATRIX_TRAIL_LENGTH;
          if (hasPixel) {
            gfx.rect(px, py, zoom, zoom).fill(hexToPixiColor(pixel));
            const greenAlpha = (1 - trailPos) * MATRIX_TRAIL_OVERLAY_ALPHA;
            if (flickerVisible(col, row, time)) {
              gfx.rect(px, py, zoom, zoom).fill(rgbaToPixiColor(matrixGreenBright(greenAlpha)));
            }
          } else if (flickerVisible(col, row, time)) {
            const alpha = (1 - trailPos) * MATRIX_TRAIL_EMPTY_ALPHA;
            gfx.rect(px, py, zoom, zoom).fill(trailColor(trailPos, alpha));
          }
        } else if (hasPixel) {
          gfx.rect(px, py, zoom, zoom).fill(hexToPixiColor(pixel));
        }
      } else {
        if (distFromHead < 0) {
          if (hasPixel) {
            gfx.rect(px, py, zoom, zoom).fill(hexToPixiColor(pixel));
          }
        } else if (distFromHead < 1) {
          gfx.rect(px, py, zoom, zoom).fill(HEAD_COLOR);
        } else if (distFromHead < MATRIX_TRAIL_LENGTH && flickerVisible(col, row, time)) {
          const trailPos = distFromHead / MATRIX_TRAIL_LENGTH;
          const alpha = (1 - trailPos) * MATRIX_TRAIL_EMPTY_ALPHA;
          gfx.rect(px, py, zoom, zoom).fill(trailColor(trailPos, alpha));
        }
      }
    }
  }
}
