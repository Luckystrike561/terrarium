/**
 * A turn ending used to send a seated agent straight to the lounge and back
 * on the very next turn (setAgentActive(false) set a -1 seatTimer sentinel
 * that the TYPE case read as "proceed now"). It now lingers at the desk in
 * the rest pose for SEAT_LINGER_SEC, resuming in place if work picks back up,
 * and only heads to the lounge once the window actually expires.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import { SEAT_LINGER_SEC } from '../src/constants.js';
import { createCharacter, updateCharacter } from '../src/office/engine/characters.js';
import type { Seat } from '../src/office/types.js';
import { CharacterState, Direction, TileType } from '../src/office/types.js';

/** A desk seat and, across the room, a free lounge (rest) seat. */
function scenario() {
  const tileMap: TileType[][] = Array.from({ length: 10 }, () =>
    new Array<TileType>(10).fill(TileType.FLOOR_1),
  );
  const deskSeat: Seat = {
    uid: 'desk',
    seatCol: 2,
    seatRow: 2,
    facingDir: Direction.DOWN,
    assigned: true,
    sitOffsetX: 0,
    sitOffsetY: 0,
  };
  const sofaSeat: Seat = {
    uid: 'sofa',
    seatCol: 7,
    seatRow: 7,
    facingDir: Direction.DOWN,
    assigned: false,
    sitOffsetX: 0,
    sitOffsetY: 0,
  };
  const seats = new Map<string, Seat>([
    ['desk', deskSeat],
    ['sofa', sofaSeat],
  ]);
  const restSeatUids = new Set(['sofa']);
  const restSeatClaims = new Map<string, number>();
  const ch = createCharacter(1, 0, 'desk', deskSeat);
  const blockedTiles = new Set<string>();
  const tick = (dt: number) =>
    updateCharacter(ch, dt, [], seats, tileMap, blockedTiles, restSeatUids, restSeatClaims);
  return { ch, restSeatClaims, tick };
}

test('a turn ending within the linger window keeps the agent seated, resuming in place', () => {
  const { ch, tick } = scenario();
  // Mirrors OfficeState.setAgentActive(false): the turn-end linger sentinel.
  ch.isActive = false;
  ch.seatTimer = -SEAT_LINGER_SEC;

  for (let elapsed = 0; elapsed < SEAT_LINGER_SEC - 1; elapsed++) {
    tick(1);
    assert.equal(ch.state, CharacterState.TYPE, `still at the desk at t=${elapsed}`);
    assert.equal(ch.restSeatId, null, 'never claimed a lounge seat');
  }
  assert.equal(ch.tileCol, 2, 'never moved from the desk tile');
  assert.equal(ch.tileRow, 2);

  // Work resumes mid-linger.
  ch.isActive = true;
  tick(0.1);
  assert.equal(ch.state, CharacterState.TYPE, 'resumed typing, not walking');
  assert.equal(ch.path.length, 0, 'no walk back to the desk — it never left');
  assert.equal(ch.tileCol, 2);
  assert.equal(ch.tileRow, 2);
});

test('a turn ending with no resumption heads to the lounge once the linger expires', () => {
  const { ch, tick, restSeatClaims } = scenario();
  ch.isActive = false;
  ch.seatTimer = -SEAT_LINGER_SEC;

  for (let elapsed = 0; elapsed < SEAT_LINGER_SEC; elapsed++) {
    tick(1);
  }

  assert.equal(ch.state, CharacterState.WALK, 'left the desk for the lounge seat');
  assert.ok(ch.path.length > 0, 'walking toward the lounge seat');
  assert.equal(ch.restSeatId, 'sofa', 'claimed the free lounge seat');
  assert.equal(restSeatClaims.get('sofa'), ch.id);
});
