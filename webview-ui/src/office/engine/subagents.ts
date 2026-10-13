/**
 * Sub-agent characters: the Task-tool helpers a parent agent spawns, and the
 * key/id maps that track them.
 */

import type { Character } from '../types.js';
import { TILE_SIZE } from '../types.js';
import { createCharacter } from './characters.js';
import { startMatrixEffect } from './matrixEffectState.js';
import { closestFreeWalkableTile } from './seatAssignment.js';
import type { WorldAccess } from './worldAccess.js';

export interface SubagentWorld extends Pick<WorldAccess, 'characters' | 'seats' | 'walkableTiles'> {
  /** Maps "parentId:toolId" → sub-agent character ID (negative) */
  subagentIdMap: Map<string, number>;
  /** Reverse lookup: sub-agent character ID → parent info */
  subagentMeta: Map<number, { parentAgentId: number; parentToolId: string }>;
}

export function subagentKey(parentAgentId: number, parentToolId: string): string {
  return `${parentAgentId}:${parentToolId}`;
}

/** Create a sub-agent character with the parent's palette, next to the parent.
 *  Returns the sub-agent id. */
export function addSubagent(
  world: SubagentWorld,
  subagentIds: { next: number },
  parentAgentId: number,
  parentToolId: string,
): number {
  const { characters, walkableTiles, subagentIdMap, subagentMeta } = world;
  const key = subagentKey(parentAgentId, parentToolId);
  const existing = subagentIdMap.get(key);
  if (existing !== undefined) return existing;

  const id = subagentIds.next--;
  const parentCh = characters.get(parentAgentId);
  const palette = parentCh ? parentCh.palette : 0;
  const hueShift = parentCh ? parentCh.hueShift : 0;

  // Find the closest walkable tile to the parent, avoiding tiles occupied by other characters
  const parentCol = parentCh ? parentCh.tileCol : 0;
  const parentRow = parentCh ? parentCh.tileRow : 0;
  let spawn = { col: parentCol, row: parentRow };
  if (walkableTiles.length > 0) {
    spawn =
      closestFreeWalkableTile(parentCol, parentRow, characters, walkableTiles) ?? walkableTiles[0];
  }

  const ch = createCharacter(id, palette, null, null, hueShift);
  ch.x = spawn.col * TILE_SIZE + TILE_SIZE / 2;
  ch.y = spawn.row * TILE_SIZE + TILE_SIZE / 2;
  ch.tileCol = spawn.col;
  ch.tileRow = spawn.row;
  if (parentCh) ch.dir = parentCh.dir;
  ch.isSubagent = true;
  ch.parentAgentId = parentAgentId;
  startMatrixEffect(ch, 'spawn');
  characters.set(id, ch);

  subagentIdMap.set(key, id);
  subagentMeta.set(id, { parentAgentId, parentToolId });
  return id;
}

/** Free a sub-agent's seat and start its despawn effect. The character stays in
 *  `characters` until the effect finishes so it keeps rendering. */
function despawnSubagent(world: SubagentWorld, ch: Character): void {
  if (ch.seatId) {
    const seat = world.seats.get(ch.seatId);
    if (seat) seat.assigned = false;
  }
  startMatrixEffect(ch, 'despawn');
  ch.bubbleType = null;
}

/** Remove a specific sub-agent character and free its seat. */
export function removeSubagent(
  world: SubagentWorld,
  parentAgentId: number,
  parentToolId: string,
): void {
  const { characters, subagentIdMap, subagentMeta } = world;
  const key = subagentKey(parentAgentId, parentToolId);
  const id = subagentIdMap.get(key);
  if (id === undefined) return;

  const ch = characters.get(id);
  if (ch && ch.matrixEffect !== 'despawn') despawnSubagent(world, ch);
  // Clean up tracking maps immediately so keys don't collide
  subagentIdMap.delete(key);
  subagentMeta.delete(id);
}

/** Remove all sub-agents belonging to a parent agent. */
export function removeAllSubagents(world: SubagentWorld, parentAgentId: number): void {
  const { characters, subagentIdMap, subagentMeta } = world;
  const toRemove: string[] = [];
  for (const [key, id] of subagentIdMap) {
    const meta = subagentMeta.get(id);
    if (!meta || meta.parentAgentId !== parentAgentId) continue;
    const ch = characters.get(id);
    if (ch && ch.matrixEffect !== 'despawn') despawnSubagent(world, ch);
    subagentMeta.delete(id);
    toRemove.push(key);
  }
  for (const key of toRemove) {
    subagentIdMap.delete(key);
  }
}
