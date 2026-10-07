/**
 * Isometric draw order: whatever stands closer to the viewer (larger col or
 * row) draws later, for boxes of any size, and overlapping footprints fall
 * back to their layer.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import type { SortBox } from '../src/office/engine/isoSort.js';
import { isoDrawOrder, SortLayer } from '../src/office/engine/isoSort.js';

function box(
  minCol: number,
  minRow: number,
  maxCol: number,
  maxRow: number,
  layer: number = SortLayer.FLOOR,
): SortBox {
  return { minCol, minRow, maxCol, maxRow, layer };
}

function actor(col: number, row: number): SortBox {
  return box(col - 0.01, row - 0.01, col + 0.01, row + 0.01, SortLayer.ACTOR);
}

function drawsBefore(boxes: SortBox[], a: number, b: number): boolean {
  const order = isoDrawOrder(boxes);
  return order.indexOf(a) < order.indexOf(b);
}

const DESK = box(2, 5, 4, 6);

test('a character at the desk front corner draws over the long desk', () => {
  // A single depth key (e.g. the desk's far corner) would put this character
  // behind the desk: its centre sum is smaller than the desk's max corner.
  assert.ok(drawsBefore([DESK, actor(2.5, 6.5)], 0, 1));
});

test('a character behind the desk draws under it', () => {
  assert.ok(drawsBefore([DESK, actor(3.5, 4.5)], 1, 0));
});

test('a character beside the desk on its far side draws under it', () => {
  assert.ok(drawsBefore([DESK, actor(1.5, 5.5)], 1, 0));
});

test('items attached to a footprint draw after it', () => {
  const monitor = box(2, 5, 3, 6, SortLayer.ATTACHED);
  assert.ok(drawsBefore([monitor, DESK], 1, 0));
});

test('a chair whose back faces the viewer covers its sitter, others do not', () => {
  const sitter = actor(5.5, 7.5);
  const facingAway = box(5, 7, 6, 8, SortLayer.ATTACHED);
  const facingViewer = box(5, 7, 6, 8, SortLayer.FLOOR);
  assert.ok(drawsBefore([sitter, facingAway], 0, 1));
  assert.ok(drawsBefore([sitter, facingViewer], 1, 0));
});

test('every box is emitted exactly once, even when overlaps disagree', () => {
  const boxes = [box(0, 0, 3, 3), box(1, 1, 4, 4), box(2, 2, 5, 5), actor(1.5, 1.5)];
  const order = isoDrawOrder(boxes);
  assert.deepEqual([...order].sort(), [0, 1, 2, 3]);
});
