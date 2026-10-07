/**
 * Wall tiles as isometric sprites. Walls on the far edges of the office (their
 * -row or -col neighbour is VOID or off the grid) are full-height solid boxes.
 * Every other wall is a glass partition: a thin framed pane along the wall's
 * run, so the room behind stays visible, the usual cutaway for an isometric
 * interior.
 */

import {
  GLASS_FRAME_COLOR,
  GLASS_PANE_COLOR,
  GLASS_SHEEN_COLOR,
  WALL_GLASS_HEIGHT_PX,
} from '../constants.js';
import { ISO_TILE_H, ISO_TILE_W, WALL_HEIGHT_PX } from './iso.js';
import type { SpriteData, TileType as TileTypeVal } from './types.js';
import { TileType } from './types.js';

const CAP_SHADE = 1.18;
const LEFT_FACE_SHADE = 0.95;
const RIGHT_FACE_SHADE = 0.78;
const BASEBOARD_SHADE = 0.55;
const BASEBOARD_PX = 3;
const TILE = ISO_TILE_W / 2;
/** Glass pane half-thickness and frame sizes, in world units. */
const PANE_HALF = 1;
const FRAME_BASE = 3;
const FRAME_TOP = 2;
const MULLION = 1;

/** Scale a `#RRGGBB` colour toward black (< 1) or toward white (> 1). */
function shadeHex(hex: string, amount: number): string {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16);
    const out = amount <= 1 ? v * amount : v + (255 - v) * (amount - 1);
    return Math.round(Math.max(0, Math.min(255, out)))
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(1)}${channel(3)}${channel(5)}${hex.slice(7)}`;
}

function isWall(tileMap: TileTypeVal[][], col: number, row: number): boolean {
  return tileMap[row]?.[col] === TileType.WALL;
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

interface Box {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  /** Colour for a hit: face, along-face coordinate, height. */
  paint: (face: 'top' | 'left' | 'right', along: number, z: number) => string;
}

/** Trace each pixel along the view ray (1, 1, 1) against tile-local boxes
 *  (gx, gy ∈ [0, 16]) and keep the hit nearest the viewer. */
function traceSprite(boxes: readonly Box[], height: number): SpriteData {
  const w = ISO_TILE_W;
  const h = ISO_TILE_H + height;
  const sprite: SpriteData = [];
  for (let y = 0; y < h; y++) {
    const row: string[] = [];
    for (let x = 0; x < w; x++) {
      const u = x + 0.5 - TILE;
      const v = y + 0.5 - height;
      const gx0 = v + u / 2;
      const gy0 = v - u / 2;
      let best = -Infinity;
      let color = '';
      for (const b of boxes) {
        const tx = b.x1 - gx0;
        const ty = b.y1 - gy0;
        const tExit = Math.min(tx, ty, b.z1);
        const tEnter = Math.max(b.x0 - gx0, b.y0 - gy0, b.z0);
        if (tEnter > tExit || tExit <= best) continue;
        best = tExit;
        if (tExit === b.z1) color = b.paint('top', 0, tExit);
        else if (tx <= ty) color = b.paint('right', gy0 + tExit - b.y0, tExit);
        else color = b.paint('left', gx0 + tExit - b.x0, tExit);
      }
      row.push(color);
    }
    sprite.push(row);
  }
  return sprite;
}

function solidWall(baseHex: string): SpriteData {
  const cap = shadeHex(baseHex, CAP_SHADE);
  const left = shadeHex(baseHex, LEFT_FACE_SHADE);
  const right = shadeHex(baseHex, RIGHT_FACE_SHADE);
  const leftBase = shadeHex(baseHex, BASEBOARD_SHADE);
  const rightBase = shadeHex(baseHex, BASEBOARD_SHADE * RIGHT_FACE_SHADE);
  return traceSprite(
    [
      {
        x0: 0,
        y0: 0,
        z0: 0,
        x1: TILE,
        y1: TILE,
        z1: WALL_HEIGHT_PX,
        paint: (face, _along, z) => {
          if (face === 'top') return cap;
          if (face === 'right') return z < BASEBOARD_PX ? rightBase : right;
          return z < BASEBOARD_PX ? leftBase : left;
        },
      },
    ],
    WALL_HEIGHT_PX,
  );
}

function glassPaint(length: number): Box['paint'] {
  const frameLeft = shadeHex(GLASS_FRAME_COLOR, 1.25);
  return (face, along, z) => {
    if (face === 'top') return frameLeft;
    const frame = face === 'left' ? frameLeft : GLASS_FRAME_COLOR;
    if (z < FRAME_BASE || z > WALL_GLASS_HEIGHT_PX - FRAME_TOP) return frame;
    if (along < MULLION || along > length - MULLION) return frame;
    // A diagonal sheen stripe across the pane.
    const stripe = (along + z * 0.6) % 14;
    return stripe < 2 ? GLASS_SHEEN_COLOR : GLASS_PANE_COLOR;
  };
}

/** Thin glass panes along the wall's run: along cols when a wall neighbours
 *  it left/right, along rows when one neighbours it above/below, both at a
 *  junction, and a short post when it stands alone. */
function glassWall(runsAlongCols: boolean, runsAlongRows: boolean): SpriteData {
  const lo = TILE / 2 - PANE_HALF;
  const hi = TILE / 2 + PANE_HALF;
  const boxes: Box[] = [];
  if (runsAlongCols || !runsAlongRows) {
    boxes.push({
      x0: 0,
      y0: lo,
      z0: 0,
      x1: TILE,
      y1: hi,
      z1: WALL_GLASS_HEIGHT_PX,
      paint: glassPaint(TILE),
    });
  }
  if (runsAlongRows) {
    boxes.push({
      x0: lo,
      y0: 0,
      z0: 0,
      x1: hi,
      y1: TILE,
      z1: WALL_GLASS_HEIGHT_PX,
      paint: glassPaint(TILE),
    });
  }
  return traceSprite(boxes, WALL_GLASS_HEIGHT_PX);
}

const cache = new Map<string, SpriteData>();

/** The sprite for one wall tile (top-left at the tile's iso corner minus
 *  (16, height)) and its height above the floor. */
export function getWallSprite(
  tileMap: TileTypeVal[][],
  col: number,
  row: number,
  baseHex: string,
): { sprite: SpriteData; height: number } {
  if (isBackWall(tileMap, col, row)) {
    const key = `solid:${baseHex}`;
    let sprite = cache.get(key);
    if (!sprite) cache.set(key, (sprite = solidWall(baseHex)));
    return { sprite, height: WALL_HEIGHT_PX };
  }
  const alongCols = isWall(tileMap, col - 1, row) || isWall(tileMap, col + 1, row);
  const alongRows = isWall(tileMap, col, row - 1) || isWall(tileMap, col, row + 1);
  const key = `glass:${alongCols ? 1 : 0}${alongRows ? 1 : 0}`;
  let sprite = cache.get(key);
  if (!sprite) cache.set(key, (sprite = glassWall(alongCols, alongRows)));
  return { sprite, height: WALL_GLASS_HEIGHT_PX };
}
