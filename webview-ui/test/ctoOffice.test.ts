/**
 * The queue outside the CTO office door: spots are outside the office, never
 * in the doorway, nearest the door first, and face the door.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import { computeDoorQueue } from '../src/office/engine/ctoOffice.ts';
import type { Seat, TileType as TileTypeVal } from '../src/office/types.ts';
import { Direction, TileType } from '../src/office/types.ts';

const W = TileType.WALL;
const F = TileType.FLOOR_1;

/** 9×5 floor: office on the right (cols 5-8) behind a wall at col 4 with a
 *  one-tile door at row 2. */
function map(): TileTypeVal[][] {
  return Array.from({ length: 5 }, (_, row) =>
    Array.from({ length: 9 }, (_, col) => (col === 4 && row !== 2 ? W : F)),
  );
}

const chair: Seat = {
  uid: 'cto',
  seatCol: 7,
  seatRow: 2,
  facingDir: Direction.DOWN,
  assigned: true,
};

test('queue spots sit outside the office, nearest the door first, facing it', () => {
  const slots = computeDoorQueue(map(), new Set(['7,2']), chair, 3);
  assert.equal(slots.length, 3);
  assert.deepEqual(slots[0], { col: 3, row: 2, facing: Direction.RIGHT });
  for (const s of slots) {
    assert.ok(s.col < 4, `slot ${s.col},${s.row} is inside the office`);
    assert.notDeepEqual([s.col, s.row], [4, 2]);
  }
});

test('blocked tiles are never handed out', () => {
  const slots = computeDoorQueue(map(), new Set(['7,2', '3,2']), chair, 2);
  assert.ok(slots.every((s) => !(s.col === 3 && s.row === 2)));
  assert.equal(slots.length, 2);
});

test('an office with no door has no queue', () => {
  const closed = map();
  closed[2][4] = W;
  assert.deepEqual(computeDoorQueue(closed, new Set(['7,2']), chair, 3), []);
});
