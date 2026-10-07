/**
 * Isometric projection. The simulation stays on the top-down grid (world
 * units: TILE_SIZE px per tile along +col = x and +row = y); only drawing and
 * hit-testing go through this 2:1 projection, where a tile is a 32×16 diamond
 * and z is height in screen px:
 *
 *   isoX = x - y,   isoY = (x + y) / 2 - z
 *
 * The generated art (scripts/iso-art) is built on the same numbers.
 */

import type { SpriteData } from './types.js';
import { TILE_SIZE } from './types.js';

export const ISO_TILE_W = TILE_SIZE * 2;
export const ISO_TILE_H = TILE_SIZE;
/** Height of a back wall. Front and interior walls are cut down so they never
 *  hide the room behind them. */
export const WALL_HEIGHT_PX = 40;
export const WALL_CUT_HEIGHT_PX = 6;

export interface Point {
  x: number;
  y: number;
}

export function worldToIso(x: number, y: number, z = 0): Point {
  return { x: x - y, y: (x + y) / 2 - z };
}

/** Inverse of {@link worldToIso} on the floor plane (z = 0). */
export function isoToWorld(ix: number, iy: number): Point {
  return { x: iy + ix / 2, y: iy - ix / 2 };
}

/** Iso position of a tile corner (col, row). */
export function tileCorner(col: number, row: number): Point {
  return worldToIso(col * TILE_SIZE, row * TILE_SIZE);
}

/** Top-left of a sprite drawn under the furniture anchor contract: an image
 *  `(fw + fh) * 16` wide whose footprint diamond touches its left, right and
 *  bottom edges. Sprites of any other width (legacy flat art) are centered on
 *  the footprint instead, standing on its front corner. */
export function footprintSpriteOrigin(
  col: number,
  row: number,
  footprintW: number,
  footprintH: number,
  spriteW: number,
  spriteH: number,
): Point {
  const top = tileCorner(col, row);
  const bottomY = top.y + (footprintW + footprintH) * (ISO_TILE_H / 2);
  if (spriteW === (footprintW + footprintH) * TILE_SIZE) {
    return { x: top.x - footprintH * TILE_SIZE, y: bottomY - spriteH };
  }
  const centerX = top.x + ((footprintW - footprintH) * TILE_SIZE) / 2;
  return { x: Math.round(centerX - spriteW / 2), y: bottomY - spriteH };
}

const diamondCache = new WeakMap<SpriteData, SpriteData>();

/** Project a square top-down tile sprite (floor, carpet junction) onto a
 *  32×16 diamond with nearest sampling. */
export function projectToDiamond(sprite: SpriteData): SpriteData {
  const cached = diamondCache.get(sprite);
  if (cached) return cached;
  const size = sprite.length;
  const w = size * 2;
  const out: SpriteData = [];
  for (let y = 0; y < size; y++) {
    const row: string[] = [];
    for (let x = 0; x < w; x++) {
      const u = x + 0.5 - size;
      const v = y + 0.5;
      const sx = Math.floor(v + u / 2);
      const sy = Math.floor(v - u / 2);
      row.push(sx >= 0 && sy >= 0 && sx < size && sy < size ? sprite[sy][sx] : '');
    }
    out.push(row);
  }
  diamondCache.set(sprite, out);
  return out;
}
