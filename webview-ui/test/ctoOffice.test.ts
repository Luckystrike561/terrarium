/**
 * The queue outside the CTO office door: spots are outside the office, never
 * in the doorway, nearest the door first, and face the door.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import { computeDoorQueue, computeOfficeTiles } from '../src/office/engine/ctoOffice.ts';
import type { CtoOfficeArea, Seat, TileType as TileTypeVal } from '../src/office/types.ts';
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
  sitOffsetX: 0,
  sitOffsetY: 0,
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

/** A composed, fully open layout: no walls anywhere, the CTO module's own
 *  12x12 rectangle (rows 0-11) directly north of a team module's floor
 *  (rows 12-23), matching `core/src/officeModules.ts`'s join-free design. */
function openMap(rows = 24): TileTypeVal[][] {
  return Array.from({ length: rows }, () => Array.from({ length: 12 }, () => F));
}

const openArea: CtoOfficeArea = {
  c0: 0,
  r0: 0,
  c1: 11,
  r1: 11,
  queueCol: 5,
  queueRow: 12,
  queueFacing: Direction.UP,
};

const openChair: Seat = {
  uid: 'cto',
  seatCol: 5,
  seatRow: 1,
  facingDir: Direction.DOWN,
  assigned: true,
  sitOffsetX: 0,
  sitOffsetY: 0,
};

test('with an area, the office is exactly its rectangle, no doorway needed', () => {
  const office = computeOfficeTiles(openMap(), openChair, openArea);
  assert.equal(office.size, 12 * 12);
  for (let row = 0; row <= 11; row++) {
    for (let col = 0; col <= 11; col++) assert.ok(office.has(`${col},${row}`));
  }
  assert.ok(!office.has('5,12'), 'the team module floor is not part of the office');
});

test('with an area, the queue starts at its anchor and every slot faces queueFacing', () => {
  const slots = computeDoorQueue(openMap(), new Set(), openChair, 5, openArea);
  assert.equal(slots.length, 5);
  assert.deepEqual(slots[0], { col: 5, row: 12, facing: Direction.UP });
  for (const s of slots) {
    assert.ok(s.row >= 12, `slot ${s.col},${s.row} is inside the office rectangle`);
    assert.equal(s.facing, Direction.UP);
  }
});

test('with an area, the queue is a straight line, not fanned out', () => {
  const slots = computeDoorQueue(openMap(), new Set(), openChair, 5, openArea);
  assert.deepEqual(
    slots.map((s) => [s.col, s.row]),
    [
      [5, 12],
      [5, 13],
      [5, 14],
      [5, 15],
      [5, 16],
    ],
  );
});

test('with an area, a blocked tile on the line is skipped, not a stop', () => {
  const slots = computeDoorQueue(openMap(), new Set(['5,13']), openChair, 3, openArea);
  assert.deepEqual(
    slots.map((s) => [s.col, s.row]),
    [
      [5, 12],
      [5, 14],
      [5, 15],
    ],
  );
});

test('with an area, no team module at the anchor means no queue', () => {
  const noNeighbor = { ...openArea, queueRow: 24 };
  assert.deepEqual(computeDoorQueue(openMap(24), new Set(), openChair, 3, noNeighbor), []);
});
