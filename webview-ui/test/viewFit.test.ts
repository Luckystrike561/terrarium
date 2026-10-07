/**
 * The office fits the viewport exactly: the zoom makes the iso bounding box of
 * the non-VOID tiles (plus the back walls' height) touch the canvas on its
 * tighter axis, so nothing is cropped and nothing needs scrolling. Only a
 * canvas too small for 1x scrolls, and then never past the office edge.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import { ZOOM_MIN } from '../src/constants.js';
import type { LocalRect } from '../src/office/projection.js';
import {
  boundsRect,
  centeredPan,
  clampPan,
  contentBounds,
  fitZoom,
  gridRect,
  mapOffset,
} from '../src/office/projection.js';
import { TileType } from '../src/office/types.js';

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

/** Canvas-space rectangle of `view` for a given pan. */
function onCanvas(
  layout: { cols: number; rows: number },
  view: LocalRect,
  zoom: number,
  pan: { x: number; y: number },
  width: number,
  height: number,
): { left: number; top: number; right: number; bottom: number } {
  const { offsetX, offsetY } = mapOffset(width, height, gridRect(layout), zoom, pan.x, pan.y);
  return {
    left: offsetX + view.minX * zoom,
    top: offsetY + view.minY * zoom,
    right: offsetX + view.maxX * zoom,
    bottom: offsetY + view.maxY * zoom,
  };
}

test('content bounds skip VOID tiles', () => {
  assert.deepEqual(contentBounds(officeLayout()), {
    minCol: 0,
    minRow: 10,
    maxCol: 20,
    maxRow: 21,
  });
});

test('a 1080p screen shows the whole office, touching one axis, centered on the other', () => {
  const layout = officeLayout();
  const view = boundsRect(contentBounds(layout));
  const width = 1920;
  const height = 1080;
  const zoom = fitZoom(view, width, height);
  const rect = onCanvas(
    layout,
    view,
    zoom,
    centeredPan(gridRect(layout), view, zoom, width, height),
    width,
    height,
  );
  const fitsWidth = Math.abs(rect.left) <= 1 && Math.abs(rect.right - width) <= 1;
  const fitsHeight = Math.abs(rect.top) <= 1 && Math.abs(rect.bottom - height) <= 1;
  assert.ok(fitsWidth || fitsHeight, 'touches the canvas on its tighter axis');
  assert.ok(
    rect.left >= -1 && rect.right <= width + 1 && rect.top >= -1 && rect.bottom <= height + 1,
  );
  assert.ok(Math.abs(rect.left - (width - rect.right)) <= 1);
  assert.ok(Math.abs(rect.top - (height - rect.bottom)) <= 1);
});

test('a fitted office cannot be scrolled', () => {
  const layout = officeLayout();
  const grid = gridRect(layout);
  const view = boundsRect(contentBounds(layout));
  const width = 1920;
  const height = 1080;
  const zoom = fitZoom(view, width, height);
  const centered = centeredPan(grid, view, zoom, width, height);
  for (const pan of [
    { x: 1e6, y: 1e6 },
    { x: -1e6, y: -1e6 },
  ]) {
    const clamped = clampPan(pan, grid, view, zoom, width, height);
    assert.ok(Math.abs(clamped.x - centered.x) <= 1 && Math.abs(clamped.y - centered.y) <= 1);
  }
});

test('a panel too small for 1x scrolls but never past the office edge', () => {
  const layout = officeLayout();
  const grid = gridRect(layout);
  const view = boundsRect(contentBounds(layout));
  const width = 200;
  const height = 400;
  const zoom = fitZoom(view, width, height);
  assert.equal(zoom, ZOOM_MIN);
  for (const pan of [
    { x: 1e6, y: 0 },
    { x: -1e6, y: 0 },
  ]) {
    const rect = onCanvas(
      layout,
      view,
      zoom,
      clampPan(pan, grid, view, zoom, width, height),
      width,
      height,
    );
    assert.ok(rect.left <= 0 && rect.right >= width, `pan ${JSON.stringify(pan)} exposes an edge`);
  }
});
