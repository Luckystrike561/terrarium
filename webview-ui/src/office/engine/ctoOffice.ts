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

import {
  CTO_COUCH_SEC,
  CTO_DESK_SEC,
  CTO_ID,
  CTO_QUEUE_MAX_SLOTS,
  CTO_VISIT_SEC,
} from '../../constants.js';
import { findPath, isWalkable } from '../layout/tileMap.js';
import type { Character, CtoQueueReason, Seat, TileType as TileTypeVal } from '../types.js';
import { CharacterState, Direction, TILE_SIZE, TileType } from '../types.js';
import { advanceAlongPath, advancePoseFrame, createCharacter } from './characters.js';
import type { WorldAccess } from './worldAccess.js';

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

/** The office state the CTO loop and queue read: the live seat graph, grid and agents. */
export type CtoWorld = Pick<
  WorldAccess,
  'layout' | 'seats' | 'tileMap' | 'blockedTiles' | 'restSeatUids' | 'characters'
>;

/** The fixed CTO character's desk and couch loop, and the queue of agents
 *  waiting to see the human at its office. */
export class CtoOffice {
  /** The CTO character. Like the greeter it is not an agent and lives outside
   *  `characters`. Null when the layout has no exec chair. */
  cto: Character | null = null;
  /** Agents that need the human, in arrival order. */
  private readonly queue = new Map<number, CtoQueueReason>();
  private couchSeatId: string | null = null;
  private visitorSeatIds: string[] = [];
  private onCouch = false;
  private phaseTimer = CTO_DESK_SEC;
  private visitTimer = CTO_VISIT_SEC;
  private readonly world: CtoWorld;

  constructor(world: CtoWorld) {
    this.world = world;
  }

  /** Seat the CTO at the layout's executive chair, or drop it when the layout
   *  has none. The whole office is the CTO's: every seat in it is claimed so
   *  no agent is given one as a desk or rests there, and agents never wander
   *  in. Its lounge seats are the CTO's couch; its other seats are visitor
   *  chairs for the queue. Returns `walkableTiles` without the office's tiles. */
  place(walkableTiles: Array<{ col: number; row: number }>): Array<{ col: number; row: number }> {
    const { layout, seats, tileMap, restSeatUids } = this.world;
    const types = new Map(layout.furniture.map((f) => [f.uid, f.type]));
    const seatId = findCtoSeatId(seats, types);
    const seat = seatId ? seats.get(seatId) : undefined;
    this.couchSeatId = null;
    this.visitorSeatIds = [];
    if (!seatId || !seat) {
      this.cto = null;
      return walkableTiles;
    }
    const office = computeOfficeTiles(tileMap, seat);
    for (const [uid, s] of seats) {
      if (!office.has(`${s.seatCol},${s.seatRow}`)) continue;
      s.assigned = true;
      if (uid === seatId) continue;
      if (!restSeatUids.has(uid)) this.visitorSeatIds.push(uid);
      else this.couchSeatId ??= uid;
    }
    const cto = this.cto ?? createCharacter(CTO_ID, 0, seatId, seat);
    cto.isCto = true;
    cto.isActive = true;
    cto.state = CharacterState.TYPE;
    cto.seatId = seatId;
    cto.path = [];
    cto.moveProgress = 0;
    cto.tileCol = seat.seatCol;
    cto.tileRow = seat.seatRow;
    cto.x = seat.seatCol * TILE_SIZE + TILE_SIZE / 2;
    cto.y = seat.seatRow * TILE_SIZE + TILE_SIZE / 2;
    cto.dir = seat.facingDir;
    this.cto = cto;
    this.onCouch = false;
    this.phaseTimer = CTO_DESK_SEC;
    return walkableTiles.filter((t) => !office.has(`${t.col},${t.row}`));
  }

  /** The CTO's loop: work at the desk for CTO_DESK_SEC, then walk to the
   *  office couch for CTO_COUCH_SEC, and back. Types at the desk, which is
   *  also the only place its monitor is on, and rests on the couch. Returns
   *  true when the CTO's monitor turned on or off. */
  update(dt: number): boolean {
    const cto = this.cto;
    if (!cto) return false;
    const { seats, tileMap, blockedTiles } = this.world;
    let monitorChanged = false;
    this.phaseTimer -= dt;
    if (this.phaseTimer <= 0 && this.couchSeatId && cto.seatId) {
      this.onCouch = !this.onCouch;
      this.phaseTimer = this.onCouch ? CTO_COUCH_SEC : CTO_DESK_SEC;
      const target = seats.get(this.onCouch ? this.couchSeatId : cto.seatId);
      if (target) {
        const key = `${target.seatCol},${target.seatRow}`;
        const wasBlocked = blockedTiles.delete(key);
        cto.path = findPath(
          cto.tileCol,
          cto.tileRow,
          target.seatCol,
          target.seatRow,
          tileMap,
          blockedTiles,
        );
        if (wasBlocked) blockedTiles.add(key);
        cto.moveProgress = 0;
        cto.state = CharacterState.WALK;
        cto.frame = 0;
        cto.frameTimer = 0;
        if (cto.isActive) {
          cto.isActive = false;
          monitorChanged = true;
        }
      }
    }
    cto.frameTimer += dt;
    if (cto.state !== CharacterState.WALK) {
      advancePoseFrame(cto);
      return monitorChanged;
    }
    advanceAlongPath(cto, dt);
    if (cto.path.length > 0 || cto.moveProgress > 0) return monitorChanged;
    const seat = seats.get(this.onCouch && this.couchSeatId ? this.couchSeatId : cto.seatId!);
    if (seat) {
      cto.tileCol = seat.seatCol;
      cto.tileRow = seat.seatRow;
      cto.x = seat.seatCol * TILE_SIZE + TILE_SIZE / 2;
      cto.y = seat.seatRow * TILE_SIZE + TILE_SIZE / 2;
      cto.dir = seat.facingDir;
    }
    cto.state = CharacterState.TYPE;
    cto.frame = 0;
    cto.frameTimer = 0;
    if (this.onCouch) return monitorChanged;
    cto.isActive = true;
    return true;
  }

  /** Hand out CTO queue spots in queue order: the visitor chairs in front of
   *  the CTO's desk first, then standing spots outside the door. Agents beyond
   *  every spot carry on as usual. An agent whose spot is taken away drops to
   *  IDLE so the normal FSM walks it back to its desk. */
  refreshQueue(): void {
    const { seats, tileMap, blockedTiles, characters } = this.world;
    const ctoSeat = this.cto?.seatId ? seats.get(this.cto.seatId) : undefined;
    const slots: QueueSlot[] = [];
    for (const uid of this.visitorSeatIds) {
      const seat = seats.get(uid);
      if (seat) {
        slots.push({ col: seat.seatCol, row: seat.seatRow, facing: seat.facingDir, seated: true });
      }
    }
    if (ctoSeat) {
      slots.push(...computeDoorQueue(tileMap, blockedTiles, ctoSeat, CTO_QUEUE_MAX_SLOTS));
    }
    const assigned = new Map<number, Character['ctoQueueSlot']>();
    let i = 0;
    for (const [id, reason] of this.queue) {
      if (characters.has(id) && i < slots.length) assigned.set(id, { ...slots[i++], reason });
    }
    for (const ch of characters.values()) {
      const slot = assigned.get(ch.id) ?? null;
      if (ch.ctoQueueSlot && !slot && ch.state !== CharacterState.WALK) {
        ch.state = CharacterState.IDLE;
        ch.frame = 0;
        ch.frameTimer = 0;
        ch.wanderTimer = 0;
      }
      ch.ctoQueueSlot = slot;
    }
  }

  /** Rotate the queue every CTO_VISIT_SEC while agents wait at the door: the
   *  longest-seated visitor goes to the back of the line and the next agent at
   *  the door takes its chair. */
  rotateQueue(dt: number): void {
    if (this.queue.size <= this.visitorSeatIds.length || this.visitorSeatIds.length === 0) {
      this.visitTimer = CTO_VISIT_SEC;
      return;
    }
    this.visitTimer -= dt;
    if (this.visitTimer > 0) return;
    this.visitTimer = CTO_VISIT_SEC;
    const [[firstId, reason]] = this.queue;
    this.queue.delete(firstId);
    this.queue.set(firstId, reason);
    this.refreshQueue();
  }

  join(id: number, reason: CtoQueueReason): void {
    const ch = this.world.characters.get(id);
    if (!ch || ch.isSubagent) return;
    if (this.queue.get(id) === 'permission') return;
    this.queue.set(id, reason);
    this.refreshQueue();
  }

  leave(id: number, reason?: CtoQueueReason): void {
    const current = this.queue.get(id);
    if (!current || (reason && current !== reason)) return;
    this.queue.delete(id);
    this.refreshQueue();
  }
}
