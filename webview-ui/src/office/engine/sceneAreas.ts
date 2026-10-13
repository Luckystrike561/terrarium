import type { Container, Graphics } from 'pixi.js';
import { Text } from 'pixi.js';

import {
  AREA_LABEL_ALPHA,
  AREA_LABEL_FALLBACK_COLOR,
  AREA_LABEL_FONT_SIZE_PX,
  AREA_LABEL_MIN_FONT_SIZE_PX,
  AREA_LABEL_SHADOW_ALPHA,
  AREA_LABEL_SHADOW_COLOR,
  AREA_OVERLAY_ALPHA,
  SEAT_AVAILABLE_COLOR,
  SEAT_BUSY_COLOR,
  SEAT_OWN_COLOR,
} from '../../constants.js';
import { worldToIso } from '../iso.js';
import { TILE_SIZE } from '../types.js';
import { hexToNumber, rgbaToPixiColor } from './pixiColor.js';
import { footprintDiamond, polyCoords } from './scenePools.js';
import type { FloorRenderState } from './sceneRenderer.js';

export interface AreaLabelEntry {
  shadow: Text;
  main: Text;
  localCx: number;
  localCy: number;
}

export function rebuildAreaOverlay(
  gfx: Graphics,
  state: FloorRenderState,
  cols: number,
  rows: number,
): void {
  gfx.clear();
  const areaTiles = state.areaTiles;
  const areas = state.areas;
  if (!areaTiles || areaTiles.length === 0 || !areas || areas.length === 0) return;

  const colorMap = new Map<string, string>();
  for (const a of areas) colorMap.set(a.label, a.color);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const label = areaTiles[r * cols + c];
      if (!label) continue;
      const hex = colorMap.get(label);
      if (!hex) continue;
      gfx
        .poly(polyCoords(footprintDiamond(c, r)))
        .fill({ color: hexToNumber(hex), alpha: AREA_OVERLAY_ALPHA });
    }
  }
}

export function rebuildAreaLabels(
  container: Container,
  pool: Map<string, AreaLabelEntry>,
  state: FloorRenderState,
): void {
  for (const { shadow, main } of pool.values()) {
    container.removeChild(shadow);
    container.removeChild(main);
  }
  pool.clear();

  const areaTiles = state.areaTiles;
  const areas = state.areas;
  if (!areaTiles || areaTiles.length === 0 || !areas || areas.length === 0) return;
  const cols = state.layoutCols ?? 0;
  const rows = state.layoutRows ?? 0;

  const colorMap = new Map<string, string>();
  for (const a of areas) colorMap.set(a.label, a.color);

  const centroids = new Map<string, { sumX: number; sumY: number; count: number }>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const label = areaTiles[r * cols + c];
      if (!label) continue;
      const acc = centroids.get(label);
      if (acc) {
        acc.sumX += c;
        acc.sumY += r;
        acc.count += 1;
      } else {
        centroids.set(label, { sumX: c, sumY: r, count: 1 });
      }
    }
  }

  for (const [label, acc] of centroids) {
    const center = worldToIso(
      (acc.sumX / acc.count + 0.5) * TILE_SIZE,
      (acc.sumY / acc.count + 0.5) * TILE_SIZE,
    );
    const localCx = center.x;
    const localCy = center.y;
    const shadow = new Text({
      text: label,
      style: {
        fontFamily: 'FS Pixel Sans',
        fontWeight: 'bold',
        fill: hexToNumber(AREA_LABEL_SHADOW_COLOR),
        align: 'center',
      },
    });
    shadow.anchor.set(0.5, 0.5);
    shadow.alpha = AREA_LABEL_SHADOW_ALPHA;
    shadow.roundPixels = true;

    const main = new Text({
      text: label,
      style: {
        fontFamily: 'FS Pixel Sans',
        fontWeight: 'bold',
        fill: hexToNumber(colorMap.get(label) ?? AREA_LABEL_FALLBACK_COLOR),
        align: 'center',
      },
    });
    main.anchor.set(0.5, 0.5);
    main.alpha = AREA_LABEL_ALPHA;
    main.roundPixels = true;

    container.addChild(shadow, main);
    pool.set(label, { shadow, main, localCx, localCy });
  }
}

export function repositionAreaLabels(
  pool: Map<string, AreaLabelEntry>,
  offsetX: number,
  offsetY: number,
  zoom: number,
): void {
  const fontSize = Math.max(AREA_LABEL_FONT_SIZE_PX * zoom, AREA_LABEL_MIN_FONT_SIZE_PX);
  for (const { shadow, main, localCx, localCy } of pool.values()) {
    shadow.style.fontSize = fontSize;
    main.style.fontSize = fontSize;
    const cx = offsetX + localCx * zoom;
    const cy = offsetY + localCy * zoom;
    shadow.position.set(cx + 1, cy + 1);
    main.position.set(cx, cy);
  }
}

export function updateSeatIndicator(gfx: Graphics, state: FloorRenderState): void {
  gfx.clear();
  const selection = state.selection;
  if (!selection || selection.selectedAgentId === null || !selection.hoveredTile) return;
  const selectedChar = selection.characters.get(selection.selectedAgentId);
  if (!selectedChar) return;

  for (const [uid, seat] of selection.seats) {
    if (seat.seatCol !== selection.hoveredTile.col || seat.seatRow !== selection.hoveredTile.row)
      continue;

    const fill =
      selectedChar.seatId === uid
        ? rgbaToPixiColor(SEAT_OWN_COLOR)
        : !seat.assigned
          ? rgbaToPixiColor(SEAT_AVAILABLE_COLOR)
          : rgbaToPixiColor(SEAT_BUSY_COLOR);
    gfx.poly(polyCoords(footprintDiamond(seat.seatCol, seat.seatRow))).fill(fill);
    break;
  }
}
