/**
 * Movement commands for one agent: reassigning its seat, sending it back to
 * its own seat, and walking it to an arbitrary tile.
 */

import { INACTIVE_SEAT_TIMER_MIN_SEC, INACTIVE_SEAT_TIMER_RANGE_SEC } from '../../constants.js';
import { findPath, isWalkable } from '../layout/tileMap.js';
import type { Character } from '../types.js';
import { CharacterState } from '../types.js';
import { releaseRestSeat } from './characters.js';
import { ownSeatKey, walkOrSitAtSeat, withOwnSeatUnblocked } from './seatAssignment.js';
import type { WorldAccess } from './worldAccess.js';

export type MovementWorld = Pick<
  WorldAccess,
  'characters' | 'seats' | 'restSeatClaims' | 'tileMap' | 'blockedTiles'
>;

function restIfIdle(ch: Character): void {
  if (!ch.isActive) {
    ch.seatTimer = INACTIVE_SEAT_TIMER_MIN_SEC + Math.random() * INACTIVE_SEAT_TIMER_RANGE_SEC;
  }
}

/** Reassign an agent from their current seat to a new seat. */
export function reassignSeat(world: MovementWorld, agentId: number, seatId: string): void {
  const { characters, seats, restSeatClaims, tileMap, blockedTiles } = world;
  const ch = characters.get(agentId);
  if (!ch) return;
  releaseRestSeat(ch, restSeatClaims);
  if (ch.seatId) {
    const old = seats.get(ch.seatId);
    if (old) old.assigned = false;
  }
  const seat = seats.get(seatId);
  if (!seat || seat.assigned) return;
  seat.assigned = true;
  ch.seatId = seatId;
  if (!walkOrSitAtSeat(ch, seat, seats, tileMap, blockedTiles)) restIfIdle(ch);
}

/** Send an agent back to their currently assigned seat. */
export function sendToSeat(world: MovementWorld, agentId: number): void {
  const { characters, seats, restSeatClaims, tileMap, blockedTiles } = world;
  const ch = characters.get(agentId);
  if (!ch || !ch.seatId) return;
  releaseRestSeat(ch, restSeatClaims);
  const seat = seats.get(ch.seatId);
  if (!seat) return;
  if (!walkOrSitAtSeat(ch, seat, seats, tileMap, blockedTiles)) restIfIdle(ch);
}

/** Walk an agent to an arbitrary walkable tile (right-click command). */
export function walkToTile(
  world: MovementWorld,
  agentId: number,
  col: number,
  row: number,
): boolean {
  const { characters, seats, restSeatClaims, tileMap, blockedTiles } = world;
  const ch = characters.get(agentId);
  if (!ch || ch.isSubagent) return false;
  releaseRestSeat(ch, restSeatClaims);
  if (!isWalkable(col, row, tileMap, blockedTiles)) {
    // Also allow walking to own seat tile (blocked for others but not self)
    const key = ownSeatKey(ch, seats);
    if (!key || key !== `${col},${row}`) return false;
  }
  const path = withOwnSeatUnblocked(ch, seats, blockedTiles, () =>
    findPath(ch.tileCol, ch.tileRow, col, row, tileMap, blockedTiles),
  );
  if (path.length === 0) return false;
  ch.path = path;
  ch.moveProgress = 0;
  ch.state = CharacterState.WALK;
  ch.frame = 0;
  ch.frameTimer = 0;
  return true;
}
