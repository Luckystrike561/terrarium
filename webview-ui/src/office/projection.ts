/**
 * World coordinates → screen coordinates, in one place.
 *
 * The office is drawn by centering the map in the canvas and then applying the
 * pan, both snapped to whole device pixels so sprites stay on the pixel grid.
 * That formula was reproduced in the renderer and in each DOM overlay that
 * floats something above a character; a copy that rounds differently puts the
 * overlay a pixel off the sprite it is labelling, which is invisible in review
 * and obvious on screen.
 *
 * Deliberately free of DOM access — `dpr` is passed in, not read from
 * `window`. Reading the environment belongs at the component boundary; a state
 * or math module that reaches for `window` drags the DOM into every module
 * graph that imports it.
 */

import { ZOOM_MIN } from '../constants.js';
import { TILE_SIZE, TileType } from './types.js';

/** Tile-space rectangle the camera fits to the viewport.
 *  `max*` bounds are exclusive. */
export interface ViewBounds {
  readonly minCol: number;
  readonly minRow: number;
  readonly maxCol: number;
  readonly maxRow: number;
}

interface LayoutGrid {
  readonly cols: number;
  readonly rows: number;
  readonly tiles: readonly number[];
}

const contentBoundsCache = new WeakMap<LayoutGrid, ViewBounds>();

/** Bounding box of the non-VOID tiles: the part of the office worth showing.
 *  Grows one row upward because wall sprites rise a full tile above their own
 *  row, so the top wall's face lives in the row above the first solid tile.
 *  Falls back to the whole grid when every tile is VOID. */
export function contentBounds(layout: LayoutGrid): ViewBounds {
  const cached = contentBoundsCache.get(layout);
  if (cached) return cached;
  let minCol = layout.cols;
  let minRow = layout.rows;
  let maxCol = 0;
  let maxRow = 0;
  for (let row = 0; row < layout.rows; row++) {
    for (let col = 0; col < layout.cols; col++) {
      if (layout.tiles[row * layout.cols + col] === TileType.VOID) continue;
      minCol = Math.min(minCol, col);
      minRow = Math.min(minRow, row);
      maxCol = Math.max(maxCol, col + 1);
      maxRow = Math.max(maxRow, row + 1);
    }
  }
  const bounds =
    maxCol === 0
      ? { minCol: 0, minRow: 0, maxCol: layout.cols, maxRow: layout.rows }
      : { minCol, minRow: Math.max(0, minRow - 1), maxCol, maxRow };
  contentBoundsCache.set(layout, bounds);
  return bounds;
}

/** The whole grid plus the one-tile ghost border the editor expands into. */
export function editBounds(layout: { cols: number; rows: number }): ViewBounds {
  return { minCol: -1, minRow: -1, maxCol: layout.cols + 1, maxRow: layout.rows + 1 };
}

/** Zoom at which `bounds` fits the canvas exactly on its tighter axis, so the
 *  whole office is visible without scrolling. Deliberately NOT an integer:
 *  an integer zoom on a mismatched aspect ratio either crops or leaves wide
 *  margins, and filling the screen is worth uneven sprite pixels. Floored at
 *  ZOOM_MIN so a narrow panel scrolls rather than shrinking sprites below 1x. */
export function fitZoom(bounds: ViewBounds, canvasWidth: number, canvasHeight: number): number {
  const worldW = (bounds.maxCol - bounds.minCol) * TILE_SIZE;
  const worldH = (bounds.maxRow - bounds.minRow) * TILE_SIZE;
  return Math.max(ZOOM_MIN, Math.min(canvasWidth / worldW, canvasHeight / worldH));
}

function clampAxis(
  pan: number,
  canvasSize: number,
  mapTiles: number,
  minTile: number,
  maxTile: number,
  zoom: number,
): number {
  const tilePx = TILE_SIZE * zoom;
  const base = Math.floor((canvasSize - mapTiles * tilePx) / 2);
  const lowest = canvasSize - maxTile * tilePx - base;
  const highest = -minTile * tilePx - base;
  if (lowest > highest) return (lowest + highest) / 2;
  return Math.max(lowest, Math.min(highest, pan));
}

/** Pan that keeps the view inside `bounds`: an axis larger than the canvas
 *  scrolls but never past the office edge, a smaller one is centered. */
export function clampPan(
  pan: { x: number; y: number },
  layout: { cols: number; rows: number },
  bounds: ViewBounds,
  zoom: number,
  canvasWidth: number,
  canvasHeight: number,
): { x: number; y: number } {
  return {
    x: clampAxis(pan.x, canvasWidth, layout.cols, bounds.minCol, bounds.maxCol, zoom),
    y: clampAxis(pan.y, canvasHeight, layout.rows, bounds.minRow, bounds.maxRow, zoom),
  };
}

/** Pan that centers `bounds` in the canvas, clamped like {@link clampPan}. */
export function centeredPan(
  layout: { cols: number; rows: number },
  bounds: ViewBounds,
  zoom: number,
  canvasWidth: number,
  canvasHeight: number,
): { x: number; y: number } {
  const tilePx = TILE_SIZE * zoom;
  const center = {
    x: ((layout.cols - bounds.minCol - bounds.maxCol) * tilePx) / 2,
    y: ((layout.rows - bounds.minRow - bounds.maxRow) * tilePx) / 2,
  };
  return clampPan(center, layout, bounds, zoom, canvasWidth, canvasHeight);
}

/** Device-pixel offset of the map's top-left corner inside the canvas.
 *  This is the renderer's own frame of reference — overlays go through
 *  {@link overlayProjection} instead of calling this directly. */
export function mapOffset(
  canvasWidth: number,
  canvasHeight: number,
  cols: number,
  rows: number,
  zoom: number,
  panX: number,
  panY: number,
): { offsetX: number; offsetY: number } {
  const mapW = cols * TILE_SIZE * zoom;
  const mapH = rows * TILE_SIZE * zoom;
  return {
    offsetX: Math.floor((canvasWidth - mapW) / 2) + Math.round(panX),
    offsetY: Math.floor((canvasHeight - mapH) / 2) + Math.round(panY),
  };
}

/** Projects world points into CSS pixels within the overlay container that
 *  sits on top of the canvas. */
export interface OverlayProjection {
  toScreenX(worldX: number): number;
  toScreenY(worldY: number): number;
  /** Container size in world units — what the viewport currently covers.
   *  Used to cap overlay offsets against the visible area. */
  readonly viewportWorldWidth: number;
  readonly viewportWorldHeight: number;
  /** CSS px → world units, for sizing overlay geometry in world terms. */
  toWorldLength(cssPx: number): number;
}

export function overlayProjection(
  layout: { cols: number; rows: number },
  containerRect: { width: number; height: number },
  zoom: number,
  pan: { x: number; y: number },
  dpr: number,
): OverlayProjection {
  const canvasW = Math.round(containerRect.width * dpr);
  const canvasH = Math.round(containerRect.height * dpr);
  const { offsetX, offsetY } = mapOffset(
    canvasW,
    canvasH,
    layout.cols,
    layout.rows,
    zoom,
    pan.x,
    pan.y,
  );
  return {
    toScreenX: (worldX) => (offsetX + worldX * zoom) / dpr,
    toScreenY: (worldY) => (offsetY + worldY * zoom) / dpr,
    viewportWorldWidth: canvasW / zoom,
    viewportWorldHeight: canvasH / zoom,
    toWorldLength: (cssPx) => (cssPx * dpr) / zoom,
  };
}
