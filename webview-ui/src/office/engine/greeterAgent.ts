/**
 * The first-run consent greeter. The Intro is diegetic: a char_0 character
 * stands near the office's bottom-left corner and "speaks" the tour through
 * a DOM bubble (IntroBubble). It is not an agent, the office keeps it outside
 * `characters`, so this module only ever hands back the greeter character or
 * null and never touches the agent map.
 */

import { GREETER_ID, GREETER_TILE_MARGIN } from '../../constants.js';
import type { Character, OfficeLayout } from '../types.js';
import { CharacterState, Direction, TILE_SIZE } from '../types.js';
import { createCharacter } from './characters.js';
import { startMatrixEffect } from './matrixEffectState.js';
import { closestFreeWalkableTile } from './seatAssignment.js';

/** Spawn the greeter near the office's bottom-left corner: target tile
 *  GREETER_TILE_MARGIN in from the left and bottom edges, falling
 *  back to the closest walkable tile when the target is a seat, furniture,
 *  a wall, or VOID (seat tiles are in blockedTiles, so closestFreeWalkableTile
 *  covers every one of those). Idempotent; a remount mid-despawn (StrictMode)
 *  revives it. Returns the (possibly unchanged) greeter, or null when there is
 *  no walkable tile to spawn on — the caller falls back to a fixed panel. */
export function spawnGreeter(
  current: Character | null,
  layout: OfficeLayout,
  characters: ReadonlyMap<number, Character>,
  walkableTiles: Array<{ col: number; row: number }>,
): Character | null {
  if (current) {
    if (current.matrixEffect === 'despawn') startMatrixEffect(current, 'spawn');
    return current;
  }
  const spawn = closestFreeWalkableTile(
    GREETER_TILE_MARGIN,
    layout.rows - 1 - GREETER_TILE_MARGIN,
    characters,
    walkableTiles,
  );
  if (!spawn) return null;
  const ch = createCharacter(GREETER_ID, 0, null, null, 0);
  ch.isGreeter = true;
  ch.state = CharacterState.IDLE;
  ch.isActive = false;
  ch.dir = Direction.DOWN;
  ch.x = spawn.col * TILE_SIZE + TILE_SIZE / 2;
  ch.y = spawn.row * TILE_SIZE + TILE_SIZE / 2;
  ch.tileCol = spawn.col;
  ch.tileRow = spawn.row;
  startMatrixEffect(ch, 'spawn');
  return ch;
}

/** Start the greeter's despawn effect. The character is dropped once the
 *  effect finishes, in OfficeState.update(). Idempotent — every close path
 *  (answer, Escape, hooksStatus) funnels here. No-op when there is no
 *  greeter or it is already despawning. */
export function despawnGreeter(greeter: Character | null): void {
  if (!greeter || greeter.matrixEffect === 'despawn') return;
  startMatrixEffect(greeter, 'despawn');
}
