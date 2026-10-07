import {
  DEFAULT_MAX_CONTEXT_TOKENS,
  SEAT_REST_MAX_SEC,
  SEAT_REST_MIN_SEC,
  TYPE_FRAME_DURATION_SEC,
  WALK_FRAME_DURATION_SEC,
  WALK_SPEED_PX_PER_SEC,
  WANDER_MOVES_BEFORE_REST_MAX,
  WANDER_MOVES_BEFORE_REST_MIN,
  WANDER_PAUSE_MAX_SEC,
  WANDER_PAUSE_MIN_SEC,
} from '../../constants.js';
import { findPath } from '../layout/tileMap.js';
import type { CharacterSprites } from '../sprites/spriteData.js';
import { isReadingToolName } from '../toolUtils.js';
import type { Character, Seat, SpriteData, TileType as TileTypeVal } from '../types.js';
import { CharacterState, Direction, TILE_SIZE } from '../types.js';

/** Whether a tool should show the reading animation (vs typing). Taxonomy comes
 *  from the enabled agent modules via the `providerCapabilities` message. */
export function isReadingTool(tool: string | null): boolean {
  if (!tool) return false;
  return isReadingToolName(tool);
}

/** Pixel center of a tile */
function tileCenter(col: number, row: number): { x: number; y: number } {
  return {
    x: col * TILE_SIZE + TILE_SIZE / 2,
    y: row * TILE_SIZE + TILE_SIZE / 2,
  };
}

/** Direction from one tile to an adjacent tile */
function directionBetween(
  fromCol: number,
  fromRow: number,
  toCol: number,
  toRow: number,
): Direction {
  const dc = toCol - fromCol;
  const dr = toRow - fromRow;
  if (dc > 0) return Direction.RIGHT;
  if (dc < 0) return Direction.LEFT;
  if (dr > 0) return Direction.DOWN;
  return Direction.UP;
}

export function createCharacter(
  id: number,
  palette: number,
  seatId: string | null,
  seat: Seat | null,
  hueShift = 0,
): Character {
  const col = seat ? seat.seatCol : 1;
  const row = seat ? seat.seatRow : 1;
  const center = tileCenter(col, row);
  return {
    id,
    state: CharacterState.TYPE,
    dir: seat ? seat.facingDir : Direction.DOWN,
    x: center.x,
    y: center.y,
    tileCol: col,
    tileRow: row,
    path: [],
    moveProgress: 0,
    currentTool: null,
    palette,
    hueShift,
    frame: 0,
    frameTimer: 0,
    wanderTimer: 0,
    wanderCount: 0,
    wanderLimit: randomInt(WANDER_MOVES_BEFORE_REST_MIN, WANDER_MOVES_BEFORE_REST_MAX),
    isActive: true,
    seatId,
    restSeatId: null,
    bubbleType: null,
    bubbleTimer: 0,
    seatTimer: 0,
    isSubagent: false,
    parentAgentId: null,
    matrixEffect: null,
    matrixEffectTimer: 0,
    matrixEffectSeeds: [],
    contextTokens: 0,
    maxContextTokens: DEFAULT_MAX_CONTEXT_TOKENS,
  };
}

/** Is this rest seat sittable right now: nobody's permanent desk, nobody else resting there. */
function isFreeRestSeat(
  uid: string,
  seats: Map<string, Seat>,
  restSeatClaims: Map<string, number>,
): boolean {
  const seat = seats.get(uid);
  return !!seat && !seat.assigned && !restSeatClaims.has(uid);
}

/** Pick a free lounge/rest seat uid, or null if every one is occupied, claimed, or doubles
 *  as someone's permanent desk. */
function findFreeRestSeat(
  seats: Map<string, Seat>,
  restSeatUids: ReadonlySet<string>,
  restSeatClaims: Map<string, number>,
): string | null {
  const candidates: string[] = [];
  for (const uid of restSeatUids) {
    if (isFreeRestSeat(uid, seats, restSeatClaims)) candidates.push(uid);
  }
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function claimRestSeat(ch: Character, uid: string, restSeatClaims: Map<string, number>): void {
  restSeatClaims.set(uid, ch.id);
  ch.restSeatId = uid;
}

/** Release a character's claimed rest seat, if any. Safe to call unconditionally. */
export function releaseRestSeat(ch: Character, restSeatClaims: Map<string, number>): void {
  if (!ch.restSeatId) return;
  if (restSeatClaims.get(ch.restSeatId) === ch.id) restSeatClaims.delete(ch.restSeatId);
  ch.restSeatId = null;
}

/** Claim a free lounge seat and start walking there (sit immediately if already on it).
 *  Returns false — claiming nothing — when no rest seat is free or reachable. Sub-agents
 *  never rest in the lounge: they have no desk of their own to leave, so they keep the
 *  plain wander FSM untouched. */
function headToRestSeat(
  ch: Character,
  seats: Map<string, Seat>,
  tileMap: TileTypeVal[][],
  blockedTiles: Set<string>,
  restSeatUids: ReadonlySet<string>,
  restSeatClaims: Map<string, number>,
): boolean {
  if (ch.isSubagent) return false;
  const uid = findFreeRestSeat(seats, restSeatUids, restSeatClaims);
  if (!uid) return false;
  const seat = seats.get(uid);
  if (!seat) return false;

  if (ch.tileCol === seat.seatCol && ch.tileRow === seat.seatRow) {
    claimRestSeat(ch, uid, restSeatClaims);
    ch.state = CharacterState.TYPE;
    ch.dir = seat.facingDir;
    ch.frame = 0;
    ch.frameTimer = 0;
    return true;
  }

  const path = findPath(ch.tileCol, ch.tileRow, seat.seatCol, seat.seatRow, tileMap, blockedTiles);
  if (path.length === 0) return false;
  claimRestSeat(ch, uid, restSeatClaims);
  ch.path = path;
  ch.moveProgress = 0;
  ch.state = CharacterState.WALK;
  ch.frame = 0;
  ch.frameTimer = 0;
  return true;
}

/** Walk back to the agent's own desk seat, or sit in place when it has none. No-op when
 *  already there or when the seat has gone missing (stale id after a layout edit). */
function headToOwnSeat(
  ch: Character,
  seats: Map<string, Seat>,
  tileMap: TileTypeVal[][],
  blockedTiles: Set<string>,
): void {
  if (!ch.seatId) return;
  const seat = seats.get(ch.seatId);
  if (!seat) return;
  if (ch.tileCol === seat.seatCol && ch.tileRow === seat.seatRow) {
    ch.state = CharacterState.TYPE;
    ch.dir = seat.facingDir;
    ch.frame = 0;
    ch.frameTimer = 0;
    return;
  }
  const path = findPath(ch.tileCol, ch.tileRow, seat.seatCol, seat.seatRow, tileMap, blockedTiles);
  if (path.length > 0) {
    ch.path = path;
    ch.moveProgress = 0;
    ch.state = CharacterState.WALK;
    ch.frame = 0;
    ch.frameTimer = 0;
  }
}

/** Walk animation + one step of movement along `ch.path`. The caller adds
 *  `dt` to `ch.frameTimer` first. */
export function advanceAlongPath(ch: Character, dt: number): void {
  if (ch.frameTimer >= WALK_FRAME_DURATION_SEC) {
    ch.frameTimer -= WALK_FRAME_DURATION_SEC;
    ch.frame = (ch.frame + 1) % 4;
  }
  const nextTile = ch.path[0];
  if (!nextTile) return;
  ch.dir = directionBetween(ch.tileCol, ch.tileRow, nextTile.col, nextTile.row);
  ch.moveProgress += (WALK_SPEED_PX_PER_SEC / TILE_SIZE) * dt;
  const fromCenter = tileCenter(ch.tileCol, ch.tileRow);
  const toCenter = tileCenter(nextTile.col, nextTile.row);
  const t = Math.min(ch.moveProgress, 1);
  ch.x = fromCenter.x + (toCenter.x - fromCenter.x) * t;
  ch.y = fromCenter.y + (toCenter.y - fromCenter.y) * t;
  if (ch.moveProgress >= 1) {
    ch.tileCol = nextTile.col;
    ch.tileRow = nextTile.row;
    ch.x = toCenter.x;
    ch.y = toCenter.y;
    ch.path.shift();
    ch.moveProgress = 0;
  }
}

/** Walk to the assigned CTO queue spot and wait there: seated in a visitor
 *  chair, or standing outside the door facing it. Overrides the desk/lounge/
 *  wander FSM until the slot is cleared, when the agent drops to IDLE and the
 *  normal FSM sends it back to its desk. */
function waitAtCtoDoor(
  ch: Character,
  dt: number,
  tileMap: TileTypeVal[][],
  blockedTiles: Set<string>,
  restSeatClaims: Map<string, number>,
): void {
  const slot = ch.ctoQueueSlot;
  if (!slot) return;
  releaseRestSeat(ch, restSeatClaims);
  const atSlot = ch.tileCol === slot.col && ch.tileRow === slot.row && ch.moveProgress === 0;
  if (atSlot && ch.path.length === 0) {
    const center = tileCenter(ch.tileCol, ch.tileRow);
    ch.x = center.x;
    ch.y = center.y;
    const pose = slot.seated ? CharacterState.TYPE : CharacterState.IDLE;
    if (ch.state !== pose) {
      ch.state = pose;
      ch.frame = 0;
      ch.frameTimer = 0;
    }
    ch.dir = slot.facing;
    return;
  }
  const last = ch.path[ch.path.length - 1];
  if (!last || last.col !== slot.col || last.row !== slot.row) {
    // A visitor chair is a seat tile, blocked for everyone but its sitter.
    const slotKey = `${slot.col},${slot.row}`;
    const wasBlocked = blockedTiles.delete(slotKey);
    const path = findPath(ch.tileCol, ch.tileRow, slot.col, slot.row, tileMap, blockedTiles);
    if (wasBlocked) blockedTiles.add(slotKey);
    if (path.length === 0) return;
    ch.path = path;
    ch.moveProgress = 0;
  }
  if (ch.state !== CharacterState.WALK) {
    ch.state = CharacterState.WALK;
    ch.frame = 0;
    ch.frameTimer = 0;
  }
  ch.frameTimer += dt;
  advanceAlongPath(ch, dt);
}

export function updateCharacter(
  ch: Character,
  dt: number,
  walkableTiles: Array<{ col: number; row: number }>,
  seats: Map<string, Seat>,
  tileMap: TileTypeVal[][],
  blockedTiles: Set<string>,
  restSeatUids: ReadonlySet<string>,
  restSeatClaims: Map<string, number>,
): void {
  if (ch.ctoQueueSlot) {
    waitAtCtoDoor(ch, dt, tileMap, blockedTiles, restSeatClaims);
    return;
  }
  ch.frameTimer += dt;

  // Release a lounge claim the instant work resumes, whether the agent is mid-walk there
  // or already seated — frees the seat for someone else as early as possible.
  const wasResting = ch.isActive && ch.restSeatId !== null;
  if (wasResting) {
    releaseRestSeat(ch, restSeatClaims);
  }

  switch (ch.state) {
    case CharacterState.TYPE: {
      if (ch.frameTimer >= TYPE_FRAME_DURATION_SEC) {
        ch.frameTimer -= TYPE_FRAME_DURATION_SEC;
        ch.frame = (ch.frame + 1) % 2;
      }
      if (ch.isActive) {
        // Was sitting in the lounge, not at the desk — head back to work.
        if (wasResting) headToOwnSeat(ch, seats, tileMap, blockedTiles);
        break;
      }
      if (ch.restSeatId) {
        // Already settled in the lounge — stay seated until work resumes.
        break;
      }
      // Stand up and head to the lounge (after seatTimer expires)
      if (ch.seatTimer > 0) {
        ch.seatTimer -= dt;
        break;
      }
      ch.seatTimer = 0; // clear sentinel
      if (!headToRestSeat(ch, seats, tileMap, blockedTiles, restSeatUids, restSeatClaims)) {
        // No rest seat free or reachable — fall back to the plain wander FSM.
        ch.state = CharacterState.IDLE;
        ch.frame = 0;
        ch.frameTimer = 0;
        ch.wanderTimer = randomRange(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC);
        ch.wanderCount = 0;
        ch.wanderLimit = randomInt(WANDER_MOVES_BEFORE_REST_MIN, WANDER_MOVES_BEFORE_REST_MAX);
      }
      break;
    }

    case CharacterState.IDLE: {
      // No idle animation — static pose
      ch.frame = 0;
      if (ch.seatTimer < 0) ch.seatTimer = 0; // clear turn-end sentinel
      // If became active, pathfind to seat
      if (ch.isActive) {
        if (!ch.seatId) {
          // No seat assigned — type in place
          ch.state = CharacterState.TYPE;
          ch.frame = 0;
          ch.frameTimer = 0;
          break;
        }
        headToOwnSeat(ch, seats, tileMap, blockedTiles);
        break;
      }
      // Countdown wander timer
      ch.wanderTimer -= dt;
      if (ch.wanderTimer <= 0) {
        // Wandered enough — try the lounge again, falling back to a rest at the desk
        if (ch.wanderCount >= ch.wanderLimit) {
          if (headToRestSeat(ch, seats, tileMap, blockedTiles, restSeatUids, restSeatClaims)) {
            break;
          }
          if (ch.seatId) {
            const seat = seats.get(ch.seatId);
            if (seat) {
              const path = findPath(
                ch.tileCol,
                ch.tileRow,
                seat.seatCol,
                seat.seatRow,
                tileMap,
                blockedTiles,
              );
              if (path.length > 0) {
                ch.path = path;
                ch.moveProgress = 0;
                ch.state = CharacterState.WALK;
                ch.frame = 0;
                ch.frameTimer = 0;
                break;
              }
            }
          }
        }
        if (walkableTiles.length > 0) {
          const target = walkableTiles[Math.floor(Math.random() * walkableTiles.length)];
          const path = findPath(
            ch.tileCol,
            ch.tileRow,
            target.col,
            target.row,
            tileMap,
            blockedTiles,
          );
          if (path.length > 0) {
            ch.path = path;
            ch.moveProgress = 0;
            ch.state = CharacterState.WALK;
            ch.frame = 0;
            ch.frameTimer = 0;
            ch.wanderCount++;
          }
        }
        ch.wanderTimer = randomRange(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC);
      }
      break;
    }

    case CharacterState.WALK: {
      if (ch.path.length === 0) {
        // Path complete — snap to tile center and transition
        const center = tileCenter(ch.tileCol, ch.tileRow);
        ch.x = center.x;
        ch.y = center.y;

        if (ch.isActive) {
          if (!ch.seatId) {
            // No seat — type in place
            ch.state = CharacterState.TYPE;
          } else {
            const seat = seats.get(ch.seatId);
            if (seat && ch.tileCol === seat.seatCol && ch.tileRow === seat.seatRow) {
              ch.state = CharacterState.TYPE;
              ch.dir = seat.facingDir;
            } else {
              ch.state = CharacterState.IDLE;
            }
          }
        } else {
          // Arrived at the claimed lounge seat — settle in and stay seated
          if (ch.restSeatId) {
            const restSeat = seats.get(ch.restSeatId);
            if (restSeat && ch.tileCol === restSeat.seatCol && ch.tileRow === restSeat.seatRow) {
              ch.state = CharacterState.TYPE;
              ch.dir = restSeat.facingDir;
              ch.frame = 0;
              ch.frameTimer = 0;
              break;
            }
            // Claimed seat vanished from under us (layout edit mid-walk) — drop it and wander.
            releaseRestSeat(ch, restSeatClaims);
          }
          // Check if arrived at assigned seat — sit down for a rest before wandering again
          if (ch.seatId) {
            const seat = seats.get(ch.seatId);
            if (seat && ch.tileCol === seat.seatCol && ch.tileRow === seat.seatRow) {
              ch.state = CharacterState.TYPE;
              ch.dir = seat.facingDir;
              // seatTimer < 0 is a sentinel from setAgentActive(false) meaning
              // "turn just ended" — skip the long rest so idle transition is immediate
              if (ch.seatTimer < 0) {
                ch.seatTimer = 0;
              } else {
                ch.seatTimer = randomRange(SEAT_REST_MIN_SEC, SEAT_REST_MAX_SEC);
              }
              ch.wanderCount = 0;
              ch.wanderLimit = randomInt(
                WANDER_MOVES_BEFORE_REST_MIN,
                WANDER_MOVES_BEFORE_REST_MAX,
              );
              ch.frame = 0;
              ch.frameTimer = 0;
              break;
            }
          }
          ch.state = CharacterState.IDLE;
          ch.wanderTimer = randomRange(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC);
        }
        ch.frame = 0;
        ch.frameTimer = 0;
        break;
      }

      advanceAlongPath(ch, dt);

      // If became active while wandering, repath to seat
      if (ch.isActive && ch.seatId) {
        const seat = seats.get(ch.seatId);
        if (seat) {
          const lastStep = ch.path[ch.path.length - 1];
          if (!lastStep || lastStep.col !== seat.seatCol || lastStep.row !== seat.seatRow) {
            const newPath = findPath(
              ch.tileCol,
              ch.tileRow,
              seat.seatCol,
              seat.seatRow,
              tileMap,
              blockedTiles,
            );
            if (newPath.length > 0) {
              ch.path = newPath;
              ch.moveProgress = 0;
            }
          }
        }
      }
      break;
    }
  }
}

/** Get the correct sprite frame for a character's current state and direction */
export function getCharacterSprite(ch: Character, sprites: CharacterSprites): SpriteData {
  switch (ch.state) {
    case CharacterState.TYPE:
      if (isReadingTool(ch.currentTool)) {
        return sprites.reading[ch.dir][ch.frame % 2];
      }
      return sprites.typing[ch.dir][ch.frame % 2];
    case CharacterState.WALK:
      return sprites.walk[ch.dir][ch.frame % 4];
    case CharacterState.IDLE:
      return sprites.walk[ch.dir][1];
    default:
      return sprites.walk[ch.dir][1];
  }
}

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}
