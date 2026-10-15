/**
 * Wall tiles as isometric sprites. Walls on the far edges of the office (their
 * -row or -col neighbour is VOID or off the grid) are thin, tall wallpapered
 * boxes standing on the inner edge of their tile, the room's shell, with a
 * window punched into some of them. Every other wall is a glass partition: a
 * thin framed pane along the wall's run, so the room behind stays visible,
 * the usual cutaway for an isometric interior. A walkable gap in either kind
 * of wall line gets a door frame (`getDoorFrameSprite`), drawn on the gap
 * tile itself since there is no wall tile there to carry it.
 */

import { ART_SCALE } from '../../../core/src/assets/constants.ts';
import {
  DOOR_FRAME_COLOR,
  GLASS_FRAME_COLOR,
  GLASS_PANE_COLOR,
  GLASS_SHEEN_COLOR,
  ROOM_INK_COLOR,
  WALL_GLASS_HEIGHT_PX,
} from '../constants.js';
import { ISO_TILE_H, ISO_TILE_W, WALL_HEIGHT_PX } from './iso.js';
import type { SpriteData, TileType as TileTypeVal } from './types.js';
import { TileType } from './types.js';

const CAP_SHADE = 1.15;
/** Width of the ink line along the cap's outer (front) edge, in world units:
 *  half a unit so it traces as a single ART_SCALE art pixel, not two. */
const CAP_INK_WIDTH_UNITS = 1 / ART_SCALE;

const LEFT_FACE_SHADE = 0.92;
const RIGHT_FACE_SHADE = 0.74;
const SKIRTING_SHADE = 0.6;
const SKIRTING_PX = 3;
const TILE = ISO_TILE_W / 2;
/** A back wall is this many world units thick, standing on the inner edge of
 *  its tile so wall-mounted items keep hanging on the same outer face. */
const WALL_THICKNESS = 4;
/** Glass pane half-thickness and frame sizes, in world units. */
const PANE_HALF = 1;
const FRAME_BASE = 3;
const FRAME_TOP = 2;
const MULLION = 1;
/** A punched window on a solid back wall: pane bounds along the face (world
 *  units into a 16-wide tile face) and height band, with a 1-unit painted
 *  trim around it. Every 3rd eligible back-wall tile gets one, so a long run
 *  reads as a fenestrated wall rather than a blank slab. */
const WINDOW_MARGIN = 3;
const WINDOW_SILL_PX = 16;
const WINDOW_HEAD_PX = 42;
const WINDOW_TRIM_PX = 1;
const WINDOW_PERIOD = 3;
/** A door frame's post width and its centered depth into the tile, both in
 *  world units, and the lintel band's height at the top of the opening. */
const DOOR_POST_WIDTH = 2;
const DOOR_FRAME_DEPTH = 2;
const DOOR_LINTEL_PX = 10;
/** Longest gap in a wall line still read as a door: matches
 *  `ctoOffice.ts`'s `MAX_DOOR_WIDTH`, the doorway a human queues outside. */
const MAX_DOOR_WIDTH = 2;

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

/** Whether the tile just beyond (col, row) is off the grid or VOID: the room
 *  has no wall there to butt up against, so a back wall faces that way. */
function openBeyond(tileMap: TileTypeVal[][], col: number, row: number): boolean {
  return (
    row < 0 ||
    col < 0 ||
    row >= tileMap.length ||
    col >= tileMap[0].length ||
    tileMap[row][col] === TileType.VOID
  );
}

export function isBackWall(tileMap: TileTypeVal[][], col: number, row: number): boolean {
  return openBeyond(tileMap, col, row - 1) || openBeyond(tileMap, col - 1, row);
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
 *  (gx, gy ∈ [0, 16]) and keep the hit nearest the viewer. Sampled at
 *  ART_SCALE art pixels per world unit, so the output is twice the resolution
 *  of the world grid it's drawn at. */
function traceSprite(boxes: readonly Box[], height: number): SpriteData {
  const w = ISO_TILE_W * ART_SCALE;
  const h = (ISO_TILE_H + height) * ART_SCALE;
  const sprite: SpriteData = [];
  for (let y = 0; y < h; y++) {
    const row: string[] = [];
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / ART_SCALE - TILE;
      const v = (y + 0.5) / ART_SCALE - height;
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
        if (tExit === b.z1) color = b.paint('top', Math.min(tx, ty) - tExit, tExit);
        else if (tx <= ty) color = b.paint('right', gy0 + tExit - b.y0, tExit);
        else color = b.paint('left', gx0 + tExit - b.x0, tExit);
      }
      row.push(color);
    }
    sprite.push(row);
  }
  return sprite;
}

/** A thin wallpapered box standing on the inner edge of the tile: a `topOpen`
 *  wall runs along the row (thin in the row direction), a `leftOpen` wall
 *  runs along the column, and a corner tile is the post where they meet. The ink line sits
 *  on the visible face's own top band, not the cap: the cap has real world
 *  depth, so a ray-traced thin box's far corner projects past its tile's
 *  edge into the next tile's sprite, and two independently-rendered tiles'
 *  overlapping cap ink never lines up pixel-for-pixel. A flat, undecorated
 *  cap plus a face whose ink only depends on height tiles seamlessly: every
 *  tile agrees on the same height-only rule regardless of which one a given
 *  screen pixel's ray happens to resolve to. `window` punches a pane into
 *  the face (skipped on a corner post tile, which has no plain face). */
function solidWall(
  baseHex: string,
  topOpen: boolean,
  leftOpen: boolean,
  window: boolean,
): SpriteData {
  const cap = shadeHex(baseHex, CAP_SHADE);
  const left = shadeHex(baseHex, LEFT_FACE_SHADE);
  const right = shadeHex(baseHex, RIGHT_FACE_SHADE);
  const skirting = shadeHex(baseHex, SKIRTING_SHADE);
  const windowGlass = (along: number, z: number): string => {
    const stripe = (along + z * 0.6) % 14;
    return stripe < 2 ? GLASS_SHEEN_COLOR : GLASS_PANE_COLOR;
  };
  const face = (f: 'left' | 'right', along: number, z: number): string => {
    if (z > WALL_HEIGHT_PX - CAP_INK_WIDTH_UNITS) return ROOM_INK_COLOR;
    if (z < SKIRTING_PX) return skirting;
    if (window) {
      const paneLo = WINDOW_MARGIN;
      const paneHi = TILE - WINDOW_MARGIN;
      if (along > paneLo && along < paneHi && z > WINDOW_SILL_PX && z < WINDOW_HEAD_PX) {
        return windowGlass(along, z);
      }
      if (
        along > paneLo - WINDOW_TRIM_PX &&
        along < paneHi + WINDOW_TRIM_PX &&
        z > WINDOW_SILL_PX - WINDOW_TRIM_PX &&
        z < WINDOW_HEAD_PX + WINDOW_TRIM_PX
      ) {
        return cap;
      }
    }
    return f === 'right' ? right : left;
  };
  const paint: Box['paint'] = (f, along, z) => (f === 'top' ? cap : face(f, along, z));
  // Both walls stand on the tile's inner edges, so where they meet only the
  // square post on the inner corner faces the room. Anything outside it
  // would poke out past the other wall's back.
  const boxes: Box[] = [
    {
      x0: leftOpen ? TILE - WALL_THICKNESS : 0,
      y0: topOpen ? TILE - WALL_THICKNESS : 0,
      z0: 0,
      x1: TILE,
      y1: TILE,
      z1: WALL_HEIGHT_PX,
      paint,
    },
  ];
  return traceSprite(boxes, WALL_HEIGHT_PX);
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
  const topOpen = openBeyond(tileMap, col, row - 1);
  const leftOpen = openBeyond(tileMap, col - 1, row);
  if (topOpen || leftOpen) {
    // A corner post (both open) has no plain face to punch a window into.
    const corner = topOpen && leftOpen;
    const isWindow = !corner && (topOpen ? col % WINDOW_PERIOD === 1 : row % WINDOW_PERIOD === 1);
    const key = `solid:${topOpen ? 1 : 0}${leftOpen ? 1 : 0}${isWindow ? 1 : 0}:${baseHex}`;
    let sprite = cache.get(key);
    if (!sprite) cache.set(key, (sprite = solidWall(baseHex, topOpen, leftOpen, isWindow)));
    return { sprite, height: WALL_HEIGHT_PX };
  }
  const alongCols = isWall(tileMap, col - 1, row) || isWall(tileMap, col + 1, row);
  const alongRows = isWall(tileMap, col, row - 1) || isWall(tileMap, col, row + 1);
  const key = `glass:${alongCols ? 1 : 0}${alongRows ? 1 : 0}`;
  let sprite = cache.get(key);
  if (!sprite) cache.set(key, (sprite = glassWall(alongCols, alongRows)));
  return { sprite, height: WALL_GLASS_HEIGHT_PX };
}

/** A walkable tile inside a short (<= MAX_DOOR_WIDTH) gap of a wall line,
 *  the axis the gap runs along, and whether a wall sits immediately on each
 *  side of this particular tile (so a 2-wide door gets one post per tile and
 *  a shared lintel, and a 1-wide door gets both posts on its only tile). */
function doorwayGeometry(
  tileMap: TileTypeVal[][],
  col: number,
  row: number,
): { alongCols: boolean; capBefore: boolean; capAfter: boolean } | null {
  const t = tileMap[row]?.[col];
  if (t === undefined || t === TileType.WALL || t === TileType.VOID) return null;
  for (const [dc, dr, alongCols] of [
    [1, 0, true],
    [0, 1, false],
  ] as const) {
    let before = 0;
    while (
      before <= MAX_DOOR_WIDTH &&
      !isWall(tileMap, col - dc * (before + 1), row - dr * (before + 1))
    )
      before++;
    let after = 0;
    while (
      after <= MAX_DOOR_WIDTH &&
      !isWall(tileMap, col + dc * (after + 1), row + dr * (after + 1))
    )
      after++;
    if (before + after + 1 <= MAX_DOOR_WIDTH) {
      return {
        alongCols,
        capBefore: isWall(tileMap, col - dc, row - dr),
        capAfter: isWall(tileMap, col + dc, row + dr),
      };
    }
  }
  return null;
}

function doorFrame(alongCols: boolean, capBefore: boolean, capAfter: boolean): SpriteData {
  const lo = TILE / 2 - DOOR_FRAME_DEPTH / 2;
  const hi = TILE / 2 + DOOR_FRAME_DEPTH / 2;
  const doorSide = shadeHex(DOOR_FRAME_COLOR, LEFT_FACE_SHADE);
  const paint: Box['paint'] = (face) => (face === 'top' ? DOOR_FRAME_COLOR : doorSide);
  const boxes: Box[] = [];
  if (alongCols) {
    boxes.push({
      x0: 0,
      y0: lo,
      z0: WALL_HEIGHT_PX - DOOR_LINTEL_PX,
      x1: TILE,
      y1: hi,
      z1: WALL_HEIGHT_PX,
      paint,
    });
    if (capBefore)
      boxes.push({ x0: 0, y0: lo, z0: 0, x1: DOOR_POST_WIDTH, y1: hi, z1: WALL_HEIGHT_PX, paint });
    if (capAfter)
      boxes.push({
        x0: TILE - DOOR_POST_WIDTH,
        y0: lo,
        z0: 0,
        x1: TILE,
        y1: hi,
        z1: WALL_HEIGHT_PX,
        paint,
      });
  } else {
    boxes.push({
      x0: lo,
      y0: 0,
      z0: WALL_HEIGHT_PX - DOOR_LINTEL_PX,
      x1: hi,
      y1: TILE,
      z1: WALL_HEIGHT_PX,
      paint,
    });
    if (capBefore)
      boxes.push({ x0: lo, y0: 0, z0: 0, x1: hi, y1: DOOR_POST_WIDTH, z1: WALL_HEIGHT_PX, paint });
    if (capAfter)
      boxes.push({
        x0: lo,
        y0: TILE - DOOR_POST_WIDTH,
        z0: 0,
        x1: hi,
        y1: TILE,
        z1: WALL_HEIGHT_PX,
        paint,
      });
  }
  return traceSprite(boxes, WALL_HEIGHT_PX);
}

/** The door frame sprite for a walkable doorway tile, or null when (col, row)
 *  is not inside a short gap of a wall line. Drawn on the gap tile itself:
 *  it stays a normal floor tile type, so it stays walkable. */
export function getDoorFrameSprite(
  tileMap: TileTypeVal[][],
  col: number,
  row: number,
): { sprite: SpriteData; height: number } | null {
  const geo = doorwayGeometry(tileMap, col, row);
  if (!geo) return null;
  const key = `door:${geo.alongCols ? 1 : 0}${geo.capBefore ? 1 : 0}${geo.capAfter ? 1 : 0}`;
  let sprite = cache.get(key);
  if (!sprite) cache.set(key, (sprite = doorFrame(geo.alongCols, geo.capBefore, geo.capAfter)));
  return { sprite, height: WALL_HEIGHT_PX };
}
