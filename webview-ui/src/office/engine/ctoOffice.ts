/**
 * The CTO's office: where the fixed CTO character works, and the queue in
 * front of its door where agents wait while they need the human.
 *
 * The office is found from the layout, not configured: it is the room holding
 * the first EXEC_CHAIR. Its door is the gap in a partition (a run of 1-2
 * non-wall tiles with walls on both ends of the same line) nearest to that
 * chair by walking distance. Queue slots are the walkable tiles just outside
 * the door, nearest first.
 */

import { isWalkable } from '../layout/tileMap.js';
import type { Seat, TileType as TileTypeVal } from '../types.js';
import { Direction, TileType } from '../types.js';

export const CTO_CHAIR_PREFIX = 'EXEC_CHAIR';
/** Longest gap in a partition still read as a door. */
const MAX_DOOR_WIDTH = 2;

export interface Tile {
  col: number;
  row: number;
}

export interface QueueSlot extends Tile {
  /** Direction the waiting agent faces. */
  facing: Direction;
  /** Sits (a visitor chair) rather than stands (outside the door). */
  seated?: boolean;
}

const STEPS: readonly Tile[] = [
  { col: 1, row: 0 },
  { col: -1, row: 0 },
  { col: 0, row: 1 },
  { col: 0, row: -1 },
];

/** Uid of the seat the CTO sits in, or null when the layout has no exec chair. */
export function findCtoSeatId(
  seats: ReadonlyMap<string, Seat>,
  furnitureTypes: ReadonlyMap<string, string>,
): string | null {
  for (const uid of seats.keys()) {
    const furnitureUid = uid.split(':')[0];
    if (furnitureTypes.get(furnitureUid)?.startsWith(CTO_CHAIR_PREFIX)) return uid;
  }
  return null;
}

function isWall(tileMap: TileTypeVal[][], col: number, row: number): boolean {
  return tileMap[row]?.[col] === TileType.WALL;
}

/** A non-wall tile inside a short gap of a wall line, along cols or rows. */
function isDoorway(tileMap: TileTypeVal[][], col: number, row: number): boolean {
  const t = tileMap[row]?.[col];
  if (t === undefined || t === TileType.WALL || t === TileType.VOID) return false;
  for (const [dc, dr] of [
    [1, 0],
    [0, 1],
  ] as const) {
    let before = 0;
    while (
      before <= MAX_DOOR_WIDTH &&
      !isWall(tileMap, col - dc * (before + 1), row - dr * (before + 1))
    )
      before++;
    let after = 0;
    while (
      after <= MAX_DOOR_WIDTH &&
      !isWall(tileMap, col + dc * (after + 1), row + dr * (after + 1))
    )
      after++;
    if (before + after + 1 <= MAX_DOOR_WIDTH) return true;
  }
  return false;
}

/** BFS walking distance from a start tile (the start itself may be blocked). */
function distances(
  tileMap: TileTypeVal[][],
  blockedTiles: Set<string>,
  start: Tile,
): Map<string, number> {
  const dist = new Map<string, number>([[`${start.col},${start.row}`, 0]]);
  const queue: Tile[] = [start];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const d = dist.get(`${cur.col},${cur.row}`)!;
    for (const s of STEPS) {
      const col = cur.col + s.col;
      const row = cur.row + s.row;
      const key = `${col},${row}`;
      if (dist.has(key) || !isWalkable(col, row, tileMap, blockedTiles)) continue;
      dist.set(key, d + 1);
      queue.push({ col, row });
    }
  }
  return dist;
}

function facingToward(from: Tile, to: Tile): Direction {
  const dc = to.col - from.col;
  const dr = to.row - from.row;
  if (Math.abs(dc) >= Math.abs(dr)) return dc >= 0 ? Direction.RIGHT : Direction.LEFT;
  return dr >= 0 ? Direction.DOWN : Direction.UP;
}

/** Tiles of the room around the CTO chair: everything reachable from it
 *  without stepping through a doorway, ignoring furniture. Agents never get a
 *  seat or a wander target in here. */
export function computeOfficeTiles(tileMap: TileTypeVal[][], ctoSeat: Seat): Set<string> {
  const start = `${ctoSeat.seatCol},${ctoSeat.seatRow}`;
  const room = new Set<string>([start]);
  const queue: Tile[] = [{ col: ctoSeat.seatCol, row: ctoSeat.seatRow }];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const s of STEPS) {
      const col = cur.col + s.col;
      const row = cur.row + s.row;
      const key = `${col},${row}`;
      if (room.has(key) || !isWalkable(col, row, tileMap, new Set())) continue;
      if (isDoorway(tileMap, col, row)) continue;
      room.add(key);
      queue.push({ col, row });
    }
  }
  return room;
}

/** Up to `count` waiting spots outside the CTO office door, nearest first. */
export function computeDoorQueue(
  tileMap: TileTypeVal[][],
  blockedTiles: Set<string>,
  ctoSeat: Seat,
  count: number,
): QueueSlot[] {
  const fromChair = distances(tileMap, blockedTiles, {
    col: ctoSeat.seatCol,
    row: ctoSeat.seatRow,
  });

  let door: Tile | null = null;
  let doorDist = Infinity;
  for (const [key, d] of fromChair) {
    const [col, row] = key.split(',').map(Number);
    if (d < doorDist && isDoorway(tileMap, col, row)) {
      door = { col, row };
      doorDist = d;
    }
  }
  if (!door) return [];

  // Outside = everything farther from the chair than the door, minus the
  // doorway tiles themselves so a queue never blocks the entrance.
  const fromDoor = distances(tileMap, blockedTiles, door);
  const outside = [...fromDoor.entries()]
    .map(([key, d]) => {
      const [col, row] = key.split(',').map(Number);
      return { col, row, d };
    })
    .filter(
      (t) =>
        (fromChair.get(`${t.col},${t.row}`) ?? Infinity) > doorDist &&
        !isDoorway(tileMap, t.col, t.row),
    )
    .sort((a, b) => a.d - b.d || a.row - b.row || a.col - b.col);

  return outside.slice(0, count).map((t) => ({
    col: t.col,
    row: t.row,
    facing: facingToward(t, door),
  }));
}
