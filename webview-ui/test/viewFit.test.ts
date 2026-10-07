/**
 * The office fits the viewport exactly: the zoom makes the non-VOID part of
 * the layout touch the canvas on its tighter axis, so nothing is cropped and
 * nothing needs scrolling. Only a canvas too small for 1x scrolls, and then
 * never past the office edge.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import { ZOOM_MIN } from '../src/constants.js';
import type { ViewBounds } from '../src/office/projection.js';
import {
  centeredPan,
  clampPan,
  contentBounds,
  fitZoom,
  mapOffset,
} from '../src/office/projection.js';
import { TILE_SIZE, TileType } from '../src/office/types.js';

/** A 21×22 grid whose top 10 rows and last column/row are VOID, like the
 *  bundled default office. */
function officeLayout(): { cols: number; rows: number; tiles: number[] } {
  const cols = 21;
  const rows = 22;
  const tiles: number[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const solid = row >= 10 && row <= 20 && col <= 19;
      tiles.push(solid ? TileType.FLOOR_1 : TileType.VOID);
    }
  }
  return { cols, rows, tiles };
}

function visibleRect(
  layout: { cols: number; rows: number },
  bounds: ViewBounds,
  zoom: number,
  pan: { x: number; y: number },
  width: number,
  height: number,
): { left: number; top: number; right: number; bottom: number } {
  const { offsetX, offsetY } = mapOffset(
    width,
    height,
    layout.cols,
    layout.rows,
    zoom,
    pan.x,
    pan.y,
  );
  const tilePx = TILE_SIZE * zoom;
  return {
    left: offsetX + bounds.minCol * tilePx,
    top: offsetY + bounds.minRow * tilePx,
    right: offsetX + bounds.maxCol * tilePx,
    bottom: offsetY + bounds.maxRow * tilePx,
  };
}

test('content bounds skip VOID tiles and keep the top wall face row', () => {
  assert.deepEqual(contentBounds(officeLayout()), {
    minCol: 0,
    minRow: 9,
    maxCol: 20,
    maxRow: 21,
  });
});

test('a 1080p screen shows the whole office, touching top and bottom, centered', () => {
  const layout = officeLayout();
  const bounds = contentBounds(layout);
  const width = 1920;
  const height = 1080;
  const zoom = fitZoom(bounds, width, height);
  const rect = visibleRect(
    layout,
    bounds,
    zoom,
    centeredPan(layout, bounds, zoom, width, height),
    width,
    height,
  );
  assert.ok(Math.abs(rect.top) <= 1 && Math.abs(rect.bottom - height) <= 1);
  assert.ok(rect.left >= 0 && rect.right <= width);
  assert.ok(Math.abs(rect.left - (width - rect.right)) <= 1);
});

test('a fitted office cannot be scrolled', () => {
  const layout = officeLayout();
  const bounds = contentBounds(layout);
  const width = 1920;
  const height = 1080;
  const zoom = fitZoom(bounds, width, height);
  const centered = centeredPan(layout, bounds, zoom, width, height);
  for (const pan of [
    { x: 1e6, y: 1e6 },
    { x: -1e6, y: -1e6 },
  ]) {
    assert.deepEqual(clampPan(pan, layout, bounds, zoom, width, height), centered);
  }
});

test('a panel too small for 1x scrolls but never past the office edge', () => {
  const layout = officeLayout();
  const bounds = contentBounds(layout);
  const width = 200;
  const height = 400;
  const zoom = fitZoom(bounds, width, height);
  assert.equal(zoom, ZOOM_MIN);
  for (const pan of [
    { x: 1e6, y: 0 },
    { x: -1e6, y: 0 },
  ]) {
    const rect = visibleRect(
      layout,
      bounds,
      zoom,
      clampPan(pan, layout, bounds, zoom, width, height),
      width,
      height,
    );
    assert.ok(rect.left <= 0 && rect.right >= width, `pan ${JSON.stringify(pan)} exposes an edge`);
  }
});
