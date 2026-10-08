/**
 * World coordinates → screen coordinates, in one place.
 *
 * The office is drawn in isometric local space (see iso.ts), centered on the
 * grid's bounding box in the canvas and then panned, both snapped to whole
 * device pixels. That formula was reproduced in the renderer and in each DOM
 * overlay that floats something above a character; a copy that rounds
 * differently puts the overlay a pixel off the sprite it is labelling, which
 * is invisible in review and obvious on screen.
 *
 * Deliberately free of DOM access — `dpr` is passed in, not read from
 * `window`. Reading the environment belongs at the component boundary; a state
 * or math module that reaches for `window` drags the DOM into every module
 * graph that imports it.
 */

import { ZOOM_MIN } from '../constants.js';
import type { Point } from './iso.js';
import { tileCorner, WALL_HEIGHT_PX, worldToIso } from './iso.js';
import { TileType } from './types.js';

/** Tile-space rectangle the camera fits to the viewport.
 *  `max*` bounds are exclusive. */
export interface ViewBounds {
  readonly minCol: number;
  readonly minRow: number;
  readonly maxCol: number;
  readonly maxRow: number;
}

/** Rectangle in iso local (unscaled sprite) pixels. */
export interface LocalRect {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

interface LayoutGrid {
  readonly cols: number;
  readonly rows: number;
  readonly tiles: readonly number[];
}

const contentBoundsCache = new WeakMap<LayoutGrid, ViewBounds>();

/** Bounding box of the non-VOID tiles: the part of the office worth showing.
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
      : { minCol, minRow, maxCol, maxRow };
  contentBoundsCache.set(layout, bounds);
  return bounds;
}

/** Screen-space box of a tile rectangle: its iso diamond, raised by a back
 *  wall's height so the walls along the far edges fit. */
export function boundsRect(bounds: ViewBounds): LocalRect {
  const top = tileCorner(bounds.minCol, bounds.minRow);
  const right = tileCorner(bounds.maxCol, bounds.minRow);
  const bottom = tileCorner(bounds.maxCol, bounds.maxRow);
  const left = tileCorner(bounds.minCol, bounds.maxRow);
  return { minX: left.x, minY: top.y - WALL_HEIGHT_PX, maxX: right.x, maxY: bottom.y };
}

/** The rectangle `mapOffset` centers at zero pan. */
export function gridRect(layout: { cols: number; rows: number }): LocalRect {
  return boundsRect({ minCol: 0, minRow: 0, maxCol: layout.cols, maxRow: layout.rows });
}

/** Zoom at which `view` fits the canvas exactly on its tighter axis, so the
 *  whole office is visible without scrolling. Deliberately NOT an integer:
 *  an integer zoom on a mismatched aspect ratio either crops or leaves wide
 *  margins, and filling the screen is worth uneven sprite pixels. Floored at
 *  ZOOM_MIN so a narrow panel scrolls rather than shrinking sprites below 1x. */
export function fitZoom(view: LocalRect, canvasWidth: number, canvasHeight: number): number {
  return Math.max(
    ZOOM_MIN,
    Math.min(canvasWidth / (view.maxX - view.minX), canvasHeight / (view.maxY - view.minY)),
  );
}

function axisBase(canvasSize: number, gridMin: number, gridMax: number, zoom: number): number {
  return Math.floor(canvasSize / 2 - ((gridMin + gridMax) / 2) * zoom);
}

/** Device-pixel position of iso local (0, 0) inside the canvas. This is the
 *  renderer's own frame of reference — overlays go through
 *  {@link overlayProjection} instead of calling this directly. */
export function mapOffset(
  canvasWidth: number,
  canvasHeight: number,
  grid: LocalRect,
  zoom: number,
  panX: number,
  panY: number,
): { offsetX: number; offsetY: number } {
  return {
    offsetX: axisBase(canvasWidth, grid.minX, grid.maxX, zoom) + Math.round(panX),
    offsetY: axisBase(canvasHeight, grid.minY, grid.maxY, zoom) + Math.round(panY),
  };
}

function clampAxis(
  pan: number,
  canvasSize: number,
  base: number,
  viewMin: number,
  viewMax: number,
  zoom: number,
): number {
  const lowest = canvasSize - viewMax * zoom - base;
  const highest = -viewMin * zoom - base;
  if (lowest > highest) return (lowest + highest) / 2;
  return Math.max(lowest, Math.min(highest, pan));
}

/** Pan that keeps the view inside `view`: an axis larger than the canvas
 *  scrolls but never past the office edge, a smaller one is centered. */
export function clampPan(
  pan: Point,
  grid: LocalRect,
  view: LocalRect,
  zoom: number,
  canvasWidth: number,
  canvasHeight: number,
): Point {
  return {
    x: clampAxis(
      pan.x,
      canvasWidth,
      axisBase(canvasWidth, grid.minX, grid.maxX, zoom),
      view.minX,
      view.maxX,
      zoom,
    ),
    y: clampAxis(
      pan.y,
      canvasHeight,
      axisBase(canvasHeight, grid.minY, grid.maxY, zoom),
      view.minY,
      view.maxY,
      zoom,
    ),
  };
}

/** Unclamped pan that puts the iso local point at the canvas center. */
export function panToCenter(
  point: Point,
  grid: LocalRect,
  zoom: number,
  canvasWidth: number,
  canvasHeight: number,
): Point {
  return {
    x: canvasWidth / 2 - point.x * zoom - axisBase(canvasWidth, grid.minX, grid.maxX, zoom),
    y: canvasHeight / 2 - point.y * zoom - axisBase(canvasHeight, grid.minY, grid.maxY, zoom),
  };
}

/** Pan that centers `view` in the canvas, clamped like {@link clampPan}. */
export function centeredPan(
  grid: LocalRect,
  view: LocalRect,
  zoom: number,
  canvasWidth: number,
  canvasHeight: number,
): Point {
  const center = { x: (view.minX + view.maxX) / 2, y: (view.minY + view.maxY) / 2 };
  return clampPan(
    panToCenter(center, grid, zoom, canvasWidth, canvasHeight),
    grid,
    view,
    zoom,
    canvasWidth,
    canvasHeight,
  );
}

/** Projects world points into CSS pixels within the overlay container that
 *  sits on top of the canvas. */
export interface OverlayProjection {
  /** World point (top-down px), raised `rise` sprite px off the floor. */
  project(worldX: number, worldY: number, rise?: number): Point;
  /** Container size in sprite px — what the viewport currently covers. */
  readonly viewportSpriteWidth: number;
  readonly viewportSpriteHeight: number;
  /** CSS px → sprite px, for sizing overlay geometry against the art. */
  toSpriteLength(cssPx: number): number;
  /** Sprite px → CSS px. */
  toCssLength(spritePx: number): number;
}

export function overlayProjection(
  layout: { cols: number; rows: number },
  containerRect: { width: number; height: number },
  zoom: number,
  pan: Point,
  dpr: number,
): OverlayProjection {
  const canvasW = Math.round(containerRect.width * dpr);
  const canvasH = Math.round(containerRect.height * dpr);
  const { offsetX, offsetY } = mapOffset(canvasW, canvasH, gridRect(layout), zoom, pan.x, pan.y);
  return {
    project: (worldX, worldY, rise = 0) => {
      const p = worldToIso(worldX, worldY, rise);
      return { x: (offsetX + p.x * zoom) / dpr, y: (offsetY + p.y * zoom) / dpr };
    },
    viewportSpriteWidth: canvasW / zoom,
    viewportSpriteHeight: canvasH / zoom,
    toSpriteLength: (cssPx) => (cssPx * dpr) / zoom,
    toCssLength: (spritePx) => (spritePx * zoom) / dpr,
  };
}
