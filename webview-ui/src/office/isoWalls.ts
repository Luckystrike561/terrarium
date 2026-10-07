/**
 * Wall tiles as isometric boxes. Walls on the far edges of the office (their
 * -row or -col neighbour is VOID or off the grid) stand at full height; every
 * other wall is cut down to a low ledge so it never hides the room behind it,
 * the usual cutaway for an isometric interior.
 */

import { ISO_TILE_H, ISO_TILE_W, WALL_CUT_HEIGHT_PX, WALL_HEIGHT_PX } from './iso.js';
import type { SpriteData, TileType as TileTypeVal } from './types.js';
import { TileType } from './types.js';

const CAP_SHADE = 1.18;
const LEFT_FACE_SHADE = 0.95;
const RIGHT_FACE_SHADE = 0.78;
const BASEBOARD_SHADE = 0.55;
const BASEBOARD_PX = 3;

/** Scale a `#RRGGBB` colour toward black (< 1) or toward white (> 1). */
function shadeHex(hex: string, amount: number): string {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16);
    const out = amount <= 1 ? v * amount : v + (255 - v) * (amount - 1);
    return Math.round(Math.max(0, Math.min(255, out)))
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

export function isBackWall(tileMap: TileTypeVal[][], col: number, row: number): boolean {
  const open = (c: number, r: number) =>
    r < 0 ||
    c < 0 ||
    r >= tileMap.length ||
    c >= tileMap[0].length ||
    tileMap[r][c] === TileType.VOID;
  return open(col, row - 1) || open(col - 1, row);
}

export function wallHeight(tileMap: TileTypeVal[][], col: number, row: number): number {
  return isBackWall(tileMap, col, row) ? WALL_HEIGHT_PX : WALL_CUT_HEIGHT_PX;
}

const cache = new Map<string, SpriteData>();

/** A 32 × (16 + height) sprite: one wall tile as a box, top-left at the tile's
 *  iso corner minus (16, height). */
export function getWallBoxSprite(baseHex: string, height: number): SpriteData {
  const key = `${baseHex}:${height}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const cap = shadeHex(baseHex, CAP_SHADE);
  const left = shadeHex(baseHex, LEFT_FACE_SHADE);
  const right = shadeHex(baseHex, RIGHT_FACE_SHADE);
  const leftBase = shadeHex(baseHex, BASEBOARD_SHADE);
  const rightBase = shadeHex(baseHex, BASEBOARD_SHADE * RIGHT_FACE_SHADE);

  const w = ISO_TILE_W;
  const h = ISO_TILE_H + height;
  const half = ISO_TILE_W / 2;
  const sprite: SpriteData = [];
  for (let y = 0; y < h; y++) {
    const row: string[] = [];
    for (let x = 0; x < w; x++) {
      // Trace the pixel center along the view ray (1, 1, 1) against the box
      // gx, gy ∈ [0, 16], z ∈ [0, height]; the visible point is the exit.
      const u = x + 0.5 - half;
      const v = y + 0.5 - height;
      const gx0 = v + u / 2;
      const gy0 = v - u / 2;
      const tx = half - gx0;
      const ty = half - gy0;
      const tExit = Math.min(tx, ty, height);
      const tEnter = Math.max(-gx0, -gy0, 0);
      if (tEnter > tExit) {
        row.push('');
        continue;
      }
      if (tExit === height) row.push(cap);
      else if (tx <= ty) row.push(tExit < BASEBOARD_PX ? rightBase : right);
      else row.push(tExit < BASEBOARD_PX ? leftBase : left);
    }
    sprite.push(row);
  }
  cache.set(key, sprite);
  return sprite;
}
