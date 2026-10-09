import { pickDiversePalette } from '../../../../core/src/paletteUtils.js';
import {
  AUTO_ON_FACING_DEPTH,
  AUTO_ON_SIDE_DEPTH,
  CHARACTER_HIT_HALF_WIDTH,
  CHARACTER_HIT_HEIGHT,
  CHARACTER_SITTING_OFFSET_PX,
  CTO_COUCH_SEC,
  CTO_DESK_SEC,
  CTO_ID,
  CTO_QUEUE_MAX_SLOTS,
  CTO_VISIT_SEC,
  DISMISS_BUBBLE_FAST_FADE_SEC,
  FURNITURE_ANIM_INTERVAL_SEC,
  GREETER_ID,
  GREETER_TILE_MARGIN,
  INACTIVE_SEAT_TIMER_MIN_SEC,
  INACTIVE_SEAT_TIMER_RANGE_SEC,
  MAX_PET_ID_LENGTH,
  PET_HIT_HALF_WIDTH,
  PET_HIT_HEIGHT,
  WAITING_BUBBLE_DURATION_SEC,
} from '../../constants.js';
import { worldToIso } from '../iso.js';
import { getAnimationFrames, getCatalogEntry, getOnStateType } from '../layout/furnitureCatalog.js';
import {
  createDefaultLayout,
  getBlockedTiles,
  layoutToFurnitureInstances,
  layoutToSeats,
  layoutToTileMap,
} from '../layout/layoutSerializer.js';
import { findPath, getWalkableTiles, isWalkable } from '../layout/tileMap.js';
import { getPetCount, getPetName } from '../sprites/petSpriteData.js';
import { getLoadedCharacterCount } from '../sprites/spriteData.js';
import type {
  Character,
  CtoQueueReason,
  FurnitureInstance,
  OfficeLayout,
  Pet,
  PlacedFurniture,
  PlacedPet,
  Seat,
  TileType as TileTypeVal,
} from '../types.js';
import { CharacterState, Direction, PetState, TILE_SIZE } from '../types.js';
import {
  advanceAlongPath,
  advancePoseFrame,
  createCharacter,
  releaseRestSeat,
  updateCharacter,
} from './characters.js';
import type { QueueSlot } from './ctoOffice.js';
import { computeDoorQueue, computeOfficeTiles, findCtoSeatId } from './ctoOffice.js';
import { advanceMatrixEffect, startMatrixEffect } from './matrixEffectState.js';
import { createPet, updatePet } from './petEntity.js';
import { anchorTile, closestFreeSeat } from './seatPlacement.js';

/** Internal helper: facing-tile coords for a seat. Returns null for invalid direction. */
function seatFacingOffset(direction: Direction): { dCol: number; dRow: number } {
  if (direction === Direction.RIGHT) return { dCol: 1, dRow: 0 };
  if (direction === Direction.LEFT) return { dCol: -1, dRow: 0 };
  if (direction === Direction.DOWN) return { dCol: 0, dRow: 1 };
  return { dCol: 0, dRow: -1 };
}

export class OfficeState {
  layout: OfficeLayout;
  tileMap: TileTypeVal[][];
  seats: Map<string, Seat>;
  blockedTiles: Set<string>;
  /** Seats that face no electronics — lounge/sofa seating idle agents can rest in,
   *  as opposed to the PC-facing seats that are someone's desk. Recomputed with `seats`. */
  restSeatUids: Set<string> = new Set();
  /** Lounge seat uid → claiming character id. Mirrors `seat.assigned` for desk seats but
   *  stays unpersisted: it is pure FSM bookkeeping for mutual exclusion, not desk ownership. */
  restSeatClaims: Map<string, number> = new Map();
  furniture: FurnitureInstance[];
  walkableTiles: Array<{ col: number; row: number }>;
  characters: Map<number, Character> = new Map();
  pets: Pet[] = [];
  /** Accumulated time for furniture animation frame cycling */
  furnitureAnimTimer = 0;
  selectedAgentId: number | null = null;
  cameraFollowId: number | null = null;
  hoveredAgentId: number | null = null;
  hoveredTile: { col: number; row: number } | null = null;
  /** Maps "parentId:toolId" → sub-agent character ID (negative) */
  subagentIdMap: Map<string, number> = new Map();
  /** Reverse lookup: sub-agent character ID → parent info */
  subagentMeta: Map<number, { parentAgentId: number; parentToolId: string }> = new Map();
  private nextSubagentId = -1;

  /**
   * folderName → list of Area labels that workspace folder belongs to.
   * Populated by useExtensionMessages on `areaMappingsLoaded`. Consulted by
   * `findFreeSeat()` to bias new agents toward seats inside their folder's Area.
   */
  areaMappings: Record<string, string[]> = {};

  /**
   * The first-run consent greeter, deliberately NOT in `characters`.
   *
   * `characters` means "agents": everything that iterates it — seat
   * assignment, palette diversity, the wander FSM, hit-testing, the seat
   * payload the webview persists — is asking an agent question the greeter has
   * no answer to. Holding it here instead of tagging it with a flag makes
   * every one of those loops correct by default, rather than correct as long
   * as each remembers an `isGreeter` guard. It is drawn because
   * `getCharacters()` appends it, and that is the only place it joins the
   * others.
   */
  greeter: Character | null = null;

  /** World-space point the camera drifts to while the greeter is up
   *  (the bubble overlay recomputes it every frame: the combined center of the
   *  character and its speech bubble). An explicit cameraFollowId outranks it. */
  greeterCameraTarget: { x: number; y: number } | null = null;
  /** Latched by a manual pan during the ask: the user took the camera, so the
   *  overlay's per-frame updates stop re-centering. Reset on spawn/despawn. */
  private greeterCameraCancelled = false;

  /** The fixed CTO character, seated at the layout's executive chair. Like the
   *  greeter it is not an agent and lives outside `characters`, so seat
   *  assignment, palettes, hit-testing and persistence never see it. Null when
   *  the layout has no executive chair. */
  cto: Character | null = null;

  /** Agents that need the human, in arrival order, with the reason. They walk
   *  to the queue outside the CTO office door and wait there until it clears. */
  private ctoQueue = new Map<number, CtoQueueReason>();
  private ctoCouchSeatId: string | null = null;
  private ctoVisitorSeatIds: string[] = [];
  private ctoOnCouch = false;
  private ctoPhaseTimer = CTO_DESK_SEC;
  private ctoVisitTimer = CTO_VISIT_SEC;

  setAreaMappings(mappings: Record<string, string[]>): void {
    this.areaMappings = mappings;
  }

  constructor(layout?: OfficeLayout) {
    this.layout = layout || createDefaultLayout();
    this.tileMap = layoutToTileMap(this.layout);
    this.seats = layoutToSeats(this.layout.furniture);
    this.restSeatUids = this.computeRestSeats();
    this.blockedTiles = getBlockedTiles(this.layout.furniture);
    this.walkableTiles = getWalkableTiles(this.tileMap, this.blockedTiles);
    this.placeCto();
    this.furniture = [];
    this.rebuildFurnitureInstances();
    // Pets are built last because they need walkableTiles populated for spawn.
    this.rebuildPetsFromLayout(this.layout);
  }

  /** Rebuild all derived state from a new layout. Reassigns existing characters. */
  rebuildFromLayout(layout: OfficeLayout): void {
    this.layout = layout;
    this.tileMap = layoutToTileMap(layout);
    this.seats = layoutToSeats(layout.furniture);
    this.blockedTiles = getBlockedTiles(layout.furniture);
    this.restSeatUids = this.computeRestSeats();
    // Drop claims (and the claiming character's pointer to them) for rest seats the
    // new layout removed or turned into a desk — stale ids would otherwise wedge the
    // claimant in CharacterState.TYPE forever since nothing else clears restSeatId.
    for (const [uid, charId] of this.restSeatClaims) {
      if (this.restSeatUids.has(uid)) continue;
      this.restSeatClaims.delete(uid);
      const ch = this.characters.get(charId);
      if (ch && ch.restSeatId === uid) ch.restSeatId = null;
    }
    this.rebuildFurnitureInstances();
    this.walkableTiles = getWalkableTiles(this.tileMap, this.blockedTiles);

    // Reassign characters to new seats, preserving existing assignments when possible
    for (const seat of this.seats.values()) {
      seat.assigned = false;
    }
    this.placeCto();

    // First pass: try to keep characters at their existing seats
    for (const ch of this.characters.values()) {
      if (ch.seatId && this.seats.has(ch.seatId)) {
        const seat = this.seats.get(ch.seatId)!;
        if (!seat.assigned) {
          seat.assigned = true;
          // Snap character to seat position
          ch.tileCol = seat.seatCol;
          ch.tileRow = seat.seatRow;
          const cx = seat.seatCol * TILE_SIZE + TILE_SIZE / 2;
          const cy = seat.seatRow * TILE_SIZE + TILE_SIZE / 2;
          ch.x = cx;
          ch.y = cy;
          ch.dir = seat.facingDir;
          continue;
        }
      }
      ch.seatId = null; // will be reassigned below
    }

    // Second pass: assign remaining characters to free seats
    for (const ch of this.characters.values()) {
      if (ch.seatId) continue;
      const seatId = this.findFreeSeat(ch.folderName);
      if (seatId) {
        this.seats.get(seatId)!.assigned = true;
        ch.seatId = seatId;
        const seat = this.seats.get(seatId)!;
        ch.tileCol = seat.seatCol;
        ch.tileRow = seat.seatRow;
        ch.x = seat.seatCol * TILE_SIZE + TILE_SIZE / 2;
        ch.y = seat.seatRow * TILE_SIZE + TILE_SIZE / 2;
        ch.dir = seat.facingDir;
      }
    }

    // A layout edit can turn a desk into a lounge seat or add new desks — move
    // any active agent still parked on a rest seat onto a freshly free desk.
    this.rebalanceRestSeatedAgents();
    this.refreshCtoQueue();

    // Relocate any characters that ended up outside bounds or on non-walkable tiles
    for (const ch of this.characters.values()) {
      if (ch.seatId) continue; // seated characters are fine
      if (
        ch.tileCol < 0 ||
        ch.tileCol >= layout.cols ||
        ch.tileRow < 0 ||
        ch.tileRow >= layout.rows
      ) {
        this.relocateCharacterToWalkable(ch);
      }
    }

    // Relocate any pets that ended up outside bounds or on non-walkable tiles
    for (const pet of this.pets) {
      if (
        pet.tileCol < 0 ||
        pet.tileCol >= layout.cols ||
        pet.tileRow < 0 ||
        pet.tileRow >= layout.rows ||
        !isWalkable(pet.tileCol, pet.tileRow, this.tileMap, this.blockedTiles)
      ) {
        if (this.walkableTiles.length > 0) {
          const spawn = this.walkableTiles[Math.floor(Math.random() * this.walkableTiles.length)];
          pet.tileCol = spawn.col;
          pet.tileRow = spawn.row;
          pet.x = spawn.col * TILE_SIZE + TILE_SIZE / 2;
          pet.y = spawn.row * TILE_SIZE + TILE_SIZE / 2;
          pet.path = [];
          pet.moveProgress = 0;
          pet.state = PetState.IDLE;
          pet.frame = 0;
          pet.frameTimer = 0;
          pet.followTargetId = null;
        }
      }
    }

    // Reconcile pets against the new layout's roster
    this.rebuildPetsFromLayout(layout);
  }

  /** Seat the CTO at the layout's executive chair, or drop it when the layout
   *  has none. The whole office is the CTO's: every seat in it is claimed so
   *  no agent is given one as a desk or rests there, and agents never wander
   *  in. Its lounge seats are the CTO's couch; its other seats are visitor
   *  chairs for the queue. */
  private placeCto(): void {
    const types = new Map(this.layout.furniture.map((f) => [f.uid, f.type]));
    const seatId = findCtoSeatId(this.seats, types);
    const seat = seatId ? this.seats.get(seatId) : undefined;
    this.ctoCouchSeatId = null;
    this.ctoVisitorSeatIds = [];
    if (!seatId || !seat) {
      this.cto = null;
      return;
    }
    const office = computeOfficeTiles(this.tileMap, seat);
    for (const [uid, s] of this.seats) {
      if (!office.has(`${s.seatCol},${s.seatRow}`)) continue;
      s.assigned = true;
      if (uid === seatId) continue;
      if (!this.restSeatUids.has(uid)) this.ctoVisitorSeatIds.push(uid);
      else this.ctoCouchSeatId ??= uid;
    }
    this.walkableTiles = this.walkableTiles.filter((t) => !office.has(`${t.col},${t.row}`));
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
    this.ctoOnCouch = false;
    this.ctoPhaseTimer = CTO_DESK_SEC;
  }

  /** The CTO's loop: work at the desk for CTO_DESK_SEC, then walk to the
   *  office couch for CTO_COUCH_SEC, and back. Types at the desk, which is
   *  also the only place its monitor is on, and rests on the couch. */
  private updateCto(dt: number): void {
    const cto = this.cto;
    if (!cto) return;
    this.ctoPhaseTimer -= dt;
    if (this.ctoPhaseTimer <= 0 && this.ctoCouchSeatId && cto.seatId) {
      this.ctoOnCouch = !this.ctoOnCouch;
      this.ctoPhaseTimer = this.ctoOnCouch ? CTO_COUCH_SEC : CTO_DESK_SEC;
      const target = this.seats.get(this.ctoOnCouch ? this.ctoCouchSeatId : cto.seatId);
      if (target) {
        const key = `${target.seatCol},${target.seatRow}`;
        const wasBlocked = this.blockedTiles.delete(key);
        cto.path = findPath(
          cto.tileCol,
          cto.tileRow,
          target.seatCol,
          target.seatRow,
          this.tileMap,
          this.blockedTiles,
        );
        if (wasBlocked) this.blockedTiles.add(key);
        cto.moveProgress = 0;
        cto.state = CharacterState.WALK;
        cto.frame = 0;
        cto.frameTimer = 0;
        if (cto.isActive) {
          cto.isActive = false;
          this.rebuildFurnitureInstances();
        }
      }
    }
    cto.frameTimer += dt;
    if (cto.state === CharacterState.WALK) {
      advanceAlongPath(cto, dt);
      if (cto.path.length > 0 || cto.moveProgress > 0) return;
      const seat = this.seats.get(
        this.ctoOnCouch && this.ctoCouchSeatId ? this.ctoCouchSeatId : cto.seatId!,
      );
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
      if (!this.ctoOnCouch) {
        cto.isActive = true;
        this.rebuildFurnitureInstances();
      }
      return;
    }
    advancePoseFrame(cto);
  }

  /** Hand out CTO queue spots in queue order: the visitor chairs in front of
   *  the CTO's desk first, then standing spots outside the door. Agents beyond
   *  every spot carry on as usual. An agent whose spot is taken away drops to
   *  IDLE so the normal FSM walks it back to its desk. */
  private refreshCtoQueue(): void {
    const ctoSeat = this.cto?.seatId ? this.seats.get(this.cto.seatId) : undefined;
    const slots: QueueSlot[] = [];
    for (const uid of this.ctoVisitorSeatIds) {
      const seat = this.seats.get(uid);
      if (seat) {
        slots.push({ col: seat.seatCol, row: seat.seatRow, facing: seat.facingDir, seated: true });
      }
    }
    if (ctoSeat) {
      slots.push(
        ...computeDoorQueue(this.tileMap, this.blockedTiles, ctoSeat, CTO_QUEUE_MAX_SLOTS),
      );
    }
    const assigned = new Map<number, Character['ctoQueueSlot']>();
    let i = 0;
    for (const [id, reason] of this.ctoQueue) {
      if (this.characters.has(id) && i < slots.length) assigned.set(id, { ...slots[i++], reason });
    }
    for (const ch of this.characters.values()) {
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
  private rotateCtoQueue(dt: number): void {
    if (
      this.ctoQueue.size <= this.ctoVisitorSeatIds.length ||
      this.ctoVisitorSeatIds.length === 0
    ) {
      this.ctoVisitTimer = CTO_VISIT_SEC;
      return;
    }
    this.ctoVisitTimer -= dt;
    if (this.ctoVisitTimer > 0) return;
    this.ctoVisitTimer = CTO_VISIT_SEC;
    const [[firstId, reason]] = this.ctoQueue;
    this.ctoQueue.delete(firstId);
    this.ctoQueue.set(firstId, reason);
    this.refreshCtoQueue();
  }

  private joinCtoQueue(id: number, reason: CtoQueueReason): void {
    const ch = this.characters.get(id);
    if (!ch || ch.isSubagent) return;
    if (this.ctoQueue.get(id) === 'permission') return;
    this.ctoQueue.set(id, reason);
    this.refreshCtoQueue();
  }

  private leaveCtoQueue(id: number, reason?: CtoQueueReason): void {
    const current = this.ctoQueue.get(id);
    if (!current || (reason && current !== reason)) return;
    this.ctoQueue.delete(id);
    this.refreshCtoQueue();
  }

  /** Move a character to a random walkable tile */
  private relocateCharacterToWalkable(ch: Character): void {
    if (this.walkableTiles.length === 0) return;
    const spawn = this.walkableTiles[Math.floor(Math.random() * this.walkableTiles.length)];
    ch.tileCol = spawn.col;
    ch.tileRow = spawn.row;
    ch.x = spawn.col * TILE_SIZE + TILE_SIZE / 2;
    ch.y = spawn.row * TILE_SIZE + TILE_SIZE / 2;
    ch.path = [];
    ch.moveProgress = 0;
  }

  getLayout(): OfficeLayout {
    return this.layout;
  }

  /** Get the blocked-tile key for a character's own seat, or null */
  private ownSeatKey(ch: Character): string | null {
    if (!ch.seatId) return null;
    const seat = this.seats.get(ch.seatId);
    if (!seat) return null;
    return `${seat.seatCol},${seat.seatRow}`;
  }

  /** Temporarily unblock a character's own seat, run fn, then re-block */
  private withOwnSeatUnblocked<T>(ch: Character, fn: () => T): T {
    const key = this.ownSeatKey(ch);
    if (key) this.blockedTiles.delete(key);
    const result = fn();
    if (key) this.blockedTiles.add(key);
    return result;
  }

  /** Temporarily unblock every seat tile a character's FSM tick might legitimately path
   *  onto: its own desk, its already-claimed rest seat, and every rest seat still free to
   *  claim. Chairs are otherwise impassable to everyone but their own sitter (mirrors
   *  `withOwnSeatUnblocked`), so a candidate lounge seat has to be unblocked before
   *  `headToRestSeat` can even pathfind to it, let alone claim it. */
  private withPathableSeatsUnblocked<T>(ch: Character, fn: () => T): T {
    const keys = new Set<string>();
    const own = this.ownSeatKey(ch);
    if (own) keys.add(own);
    if (ch.restSeatId) {
      const seat = this.seats.get(ch.restSeatId);
      if (seat) keys.add(`${seat.seatCol},${seat.seatRow}`);
    }
    for (const uid of this.restSeatUids) {
      const seat = this.seats.get(uid);
      if (!seat || seat.assigned || this.restSeatClaims.has(uid)) continue;
      keys.add(`${seat.seatCol},${seat.seatRow}`);
    }
    for (const key of keys) this.blockedTiles.delete(key);
    const result = fn();
    for (const key of keys) this.blockedTiles.add(key);
    return result;
  }

  /** Collect every tile occupied by electronics furniture (PCs, monitors, etc.). */
  private buildElectronicsTileSet(): Set<string> {
    const out = new Set<string>();
    for (const item of this.layout.furniture) {
      const entry = getCatalogEntry(item.type);
      if (!entry || entry.category !== 'electronics') continue;
      for (let dr = 0; dr < entry.footprintH; dr++) {
        for (let dc = 0; dc < entry.footprintW; dc++) {
          out.add(`${item.col + dc},${item.row + dr}`);
        }
      }
    }
    return out;
  }

  /** Find the area label assigned to a seat's tile, or null. Public for e2e
   *  observability (getAgentSeats hook reads a seated agent's area). */
  seatZone(uid: string): string | null {
    const seat = this.seats.get(uid);
    if (!seat) return null;
    const tiles = this.layout.areaTiles;
    if (!tiles || tiles.length === 0) return null;
    const idx = seat.seatRow * this.layout.cols + seat.seatCol;
    if (idx < 0 || idx >= tiles.length) return null;
    return tiles[idx] ?? null;
  }

  /**
   * Does this seat face an electronics tile (PC, monitor)? Mirrors the
   * forward-and-flanking scan used by furniture auto-state.
   */
  private isSeatFacingElectronics(seat: Seat, electronicsTiles: Set<string>): boolean {
    const { dCol, dRow } = seatFacingOffset(seat.facingDir);
    for (let d = 1; d <= AUTO_ON_FACING_DEPTH; d++) {
      const tileCol = seat.seatCol + dCol * d;
      const tileRow = seat.seatRow + dRow * d;
      if (electronicsTiles.has(`${tileCol},${tileRow}`)) return true;
      if (dCol !== 0) {
        if (
          electronicsTiles.has(`${tileCol},${tileRow - 1}`) ||
          electronicsTiles.has(`${tileCol},${tileRow + 1}`)
        ) {
          return true;
        }
      } else if (
        electronicsTiles.has(`${tileCol - 1},${tileRow}`) ||
        electronicsTiles.has(`${tileCol + 1},${tileRow}`)
      ) {
        return true;
      }
    }
    return false;
  }

  /** Seats that face no electronics: the lounge/sofa seating idle agents rest in, as
   *  opposed to the PC-facing seats that are someone's desk. A coffee table is
   *  `isDesk` for placement purposes but hosts no PC, so this (not desk-adjacency)
   *  is what actually separates a lounge chair from a workstation. */
  private computeRestSeats(): Set<string> {
    const electronicsTiles = this.buildElectronicsTileSet();
    const rest = new Set<string>();
    for (const [uid, seat] of this.seats) {
      if (!this.isSeatFacingElectronics(seat, electronicsTiles)) rest.add(uid);
    }
    return rest;
  }

  /** Random-pick a seat from a candidate list, or null when it's empty. */
  private pickRandomSeat(seatUids: string[]): string | null {
    if (seatUids.length === 0) return null;
    return seatUids[Math.floor(Math.random() * seatUids.length)];
  }

  /**
   * Area-aware picker run once against a pre-filtered candidate pool.
   *
   *   Stage 1: If `folderName` is given and `areaMappings[folderName]` lists
   *            Area labels, prefer free seats whose tile is labeled with one
   *            of those areas.
   *   Stage 2: Prefer free seats whose tile has NO area label (unzoned).
   *   Stage 3: Any free seat in the pool.
   *
   * Returns null only when the pool is empty. Passing `undefined` folderName
   * preserves pre-Areas single-stage behavior (skips Stage 1; Stage 2 picks
   * unzoned seats from a layout without `areaTiles`, which is every seat).
   */
  private pickSeatByArea(freeSeats: string[], folderName: string | undefined): string | null {
    if (freeSeats.length === 0) return null;
    const areaLabels = folderName ? this.areaMappings[folderName] : undefined;

    if (areaLabels && areaLabels.length > 0) {
      const wanted = new Set(areaLabels);
      const inArea = freeSeats.filter((uid) => {
        const label = this.seatZone(uid);
        return label !== null && wanted.has(label);
      });
      const pick = this.pickRandomSeat(inArea);
      if (pick) return pick;
    }

    const unzoned = freeSeats.filter((uid) => this.seatZone(uid) === null);
    const pick2 = this.pickRandomSeat(unzoned);
    if (pick2) return pick2;

    return this.pickRandomSeat(freeSeats);
  }

  /**
   * Desk-seat picker for top-level agents. Work (PC-facing) seats are always
   * exhausted — across every Area stage — before a rest/lounge seat is ever
   * handed out as someone's desk: the Area stages used to run their
   * preference PER POOL, so a folder routed into an area with only sofas free
   * would seat an agent on a sofa even while desks sat empty in another area.
   * A rest seat is now only a fallback for when no desk is free anywhere.
   */
  private findFreeSeat(folderName?: string): string | null {
    const freeWorkSeats: string[] = [];
    const freeRestSeats: string[] = [];
    for (const [uid, seat] of this.seats) {
      if (seat.assigned) continue;
      (this.restSeatUids.has(uid) ? freeRestSeats : freeWorkSeats).push(uid);
    }
    return (
      this.pickSeatByArea(freeWorkSeats, folderName) ??
      this.pickSeatByArea(freeRestSeats, folderName)
    );
  }

  /** First free desk/work (non-rest) seat uid, or null if every one is taken. */
  private findFreeWorkSeatUid(): string | null {
    for (const [uid, seat] of this.seats) {
      if (!seat.assigned && !this.restSeatUids.has(uid)) return uid;
    }
    return null;
  }

  /**
   * Hand `ch` a work seat it already owns the claim to (via `claimWorkSeatForActiveAgent`)
   * and physically walk it there. When `previousOwner` is given, the work seat was taken
   * from an idle agent's desk, which in turn inherits `ch`'s old rest seat — correct since
   * an idle agent rests in the lounge regardless of what its desk `seatId` says, so losing
   * that desk costs it nothing right now and it needs no physical move. Without a
   * `previousOwner` the work seat was genuinely free, so `ch`'s old rest seat (if any) is
   * vacated instead.
   */
  private assignWorkSeat(
    ch: Character,
    workSeatUid: string,
    previousOwner: Character | null,
  ): void {
    const workSeat = this.seats.get(workSeatUid);
    if (!workSeat) return;
    const oldSeatId = ch.seatId;
    if (previousOwner) {
      previousOwner.seatId = oldSeatId;
    } else if (oldSeatId) {
      const old = this.seats.get(oldSeatId);
      if (old) old.assigned = false;
    }
    workSeat.assigned = true;
    ch.seatId = workSeatUid;
    const path = this.withOwnSeatUnblocked(ch, () =>
      findPath(
        ch.tileCol,
        ch.tileRow,
        workSeat.seatCol,
        workSeat.seatRow,
        this.tileMap,
        this.blockedTiles,
      ),
    );
    if (path.length > 0) {
      ch.path = path;
      ch.moveProgress = 0;
      ch.state = CharacterState.WALK;
      ch.frame = 0;
      ch.frameTimer = 0;
    } else {
      ch.state = CharacterState.TYPE;
      ch.dir = workSeat.facingDir;
      ch.frame = 0;
      ch.frameTimer = 0;
    }
  }

  /**
   * Desks belong to whoever is working them. If `ch` is active and its desk (`seatId`) is
   * a rest seat, upgrade it to a work seat: a free one first, else steal one from an idle
   * agent (never from another active agent — a desk genuinely in use stays in use). An idle
   * agent rests in the lounge regardless of its desk `seatId`, so handing that desk to an
   * active colleague costs the idle agent nothing visible right now. No-op when `ch` has no
   * seat, already has a work seat, or every work seat is legitimately in active use.
   * Cheap to call unconditionally (e.g. on every `agentStatus: active`): the common case is
   * a single Map lookup confirming `seatId` is already a work seat.
   */
  private claimWorkSeatForActiveAgent(ch: Character): void {
    if (!ch.isActive || !ch.seatId || !this.restSeatUids.has(ch.seatId)) return;
    const freeSeatId = this.findFreeWorkSeatUid();
    if (freeSeatId) {
      this.assignWorkSeat(ch, freeSeatId, null);
      return;
    }
    for (const other of this.characters.values()) {
      if (other.id === ch.id || other.isActive) continue;
      if (!other.seatId || this.restSeatUids.has(other.seatId)) continue;
      this.assignWorkSeat(ch, other.seatId, other);
      return;
    }
  }

  /**
   * Re-run `claimWorkSeatForActiveAgent` for every active agent. Desk assignment
   * (`findFreeSeat`, restore via `preferredSeatId`, `setAgentActive`) already claims a work
   * seat the moment it's possible, but that alone only stops NEW misassignment — an agent
   * already parked on a sofa as its desk (from before this fix, or because every desk was
   * briefly full or in active use) stays there until something changes. `excludeId` skips a
   * character mid-removal — its old seat was just freed but it's still in `characters` until
   * the despawn animation finishes, so without the guard it could claim a seat nobody will
   * ever free. Call whenever a seat could have freed or an owner could have gone idle: agent
   * removal, layout rebuild.
   */
  private rebalanceRestSeatedAgents(excludeId?: number): void {
    for (const ch of this.characters.values()) {
      if (ch.id === excludeId) continue;
      this.claimWorkSeatForActiveAgent(ch);
    }
  }

  /** Closest walkable tile to (col,row) not occupied by another character, or null. */
  private closestFreeWalkableTile(col: number, row: number): { col: number; row: number } | null {
    const occupied = new Set<string>();
    for (const ch of this.characters.values()) {
      occupied.add(`${ch.tileCol},${ch.tileRow}`);
    }
    let best: { col: number; row: number } | null = null;
    let bestDist = Infinity;
    for (const tile of this.walkableTiles) {
      if (occupied.has(`${tile.col},${tile.row}`)) continue;
      const d = Math.abs(tile.col - col) + Math.abs(tile.row - row);
      if (d < bestDist) {
        best = tile;
        bestDist = d;
      }
    }
    return best;
  }

  /**
   * Pick a diverse palette for a new agent based on currently active agents.
   * The first agents each get a unique skin (random order), one per loaded
   * sheet. Beyond that, skins repeat in balanced rounds with a random hue
   * shift (≥45°).
   */
  private pickDiversePalette(): { palette: number; hueShift: number } {
    // Count how many non-sub-agents use each base palette
    const paletteCount = getLoadedCharacterCount();
    const counts = new Array(paletteCount).fill(0) as number[];
    for (const ch of this.characters.values()) {
      if (ch.isSubagent) continue;
      if (ch.palette < paletteCount) counts[ch.palette]++;
    }
    return pickDiversePalette(paletteCount, counts);
  }

  addAgent(
    id: number,
    preferredPalette?: number,
    preferredHueShift?: number,
    preferredSeatId?: string,
    skipSpawnEffect?: boolean,
    folderName?: string,
    nearAgentId?: number,
  ): void {
    if (this.characters.has(id)) return;

    let palette: number;
    let hueShift: number;
    if (preferredPalette !== undefined) {
      palette = preferredPalette;
      hueShift = preferredHueShift ?? 0;
    } else {
      const pick = this.pickDiversePalette();
      palette = pick.palette;
      hueShift = pick.hueShift;
    }

    // Try preferred seat first, then (for teammates) the seat closest to the
    // anchor agent, then any free seat. anchorTile resolves to the anchor's SEAT
    // (stable from creation) rather than its live tile, so a teammate placed while
    // the lead is still walking to its seat still clusters around the final seat.
    const anchor = nearAgentId !== undefined ? this.characters.get(nearAgentId) : undefined;
    const anchorAt = anchorTile(anchor, this.seats);
    let seatId: string | null = null;
    if (preferredSeatId && this.seats.has(preferredSeatId)) {
      const seat = this.seats.get(preferredSeatId)!;
      // A persisted desk that is now a rest seat (e.g. from before this fix) is only
      // honored when no real desk is free — otherwise restore would keep repeating
      // the original misassignment forever.
      const demoted = this.restSeatUids.has(preferredSeatId) && this.findFreeWorkSeatUid() !== null;
      if (!seat.assigned && !demoted) {
        seatId = preferredSeatId;
      }
    }
    if (!seatId && anchorAt) {
      seatId = closestFreeSeat(this.seats, anchorAt.col, anchorAt.row);
    }
    if (!seatId) {
      seatId = this.findFreeSeat(folderName);
    }

    let ch: Character;
    if (seatId) {
      const seat = this.seats.get(seatId)!;
      seat.assigned = true;
      ch = createCharacter(id, palette, seatId, seat, hueShift);
    } else {
      // No seats — teammates spawn beside their anchor, others at a random walkable tile
      let spawn = anchorAt ? this.closestFreeWalkableTile(anchorAt.col, anchorAt.row) : null;
      if (!spawn) {
        spawn =
          this.walkableTiles.length > 0
            ? this.walkableTiles[Math.floor(Math.random() * this.walkableTiles.length)]
            : { col: 1, row: 1 };
      }
      ch = createCharacter(id, palette, null, null, hueShift);
      ch.x = spawn.col * TILE_SIZE + TILE_SIZE / 2;
      ch.y = spawn.row * TILE_SIZE + TILE_SIZE / 2;
      ch.tileCol = spawn.col;
      ch.tileRow = spawn.row;
    }

    if (folderName) {
      ch.folderName = folderName;
    }
    if (!skipSpawnEffect) {
      startMatrixEffect(ch, 'spawn');
    }
    this.characters.set(id, ch);
    // Covers both a persisted desk already demoted above and a fresh findFreeSeat()
    // fallback to the lounge — either way, steal a work seat from an idle agent if no
    // free one exists, same as a live active-transition would.
    this.claimWorkSeatForActiveAgent(ch);
  }

  // ── Greeter ───────────────────────────────────────────────────
  // The Intro is diegetic: a char_0 character stands near the office's
  // bottom-left corner and "speaks" the tour through a DOM bubble
  // (IntroBubble). It is not an agent — see the `greeter` field.

  /** Spawn the greeter near the office's bottom-left corner: target tile
   *  GREETER_TILE_MARGIN in from the left and bottom edges, falling
   *  back to the closest walkable tile when the target is a seat, furniture,
   *  a wall, or VOID (seat tiles are in blockedTiles, so closestFreeWalkableTile
   *  covers every one of those). Idempotent; a remount mid-despawn (StrictMode)
   *  revives it. */
  spawnGreeter(): void {
    this.greeterCameraCancelled = false;
    if (this.greeter) {
      if (this.greeter.matrixEffect === 'despawn') startMatrixEffect(this.greeter, 'spawn');
      return;
    }
    const spawn = this.closestFreeWalkableTile(
      GREETER_TILE_MARGIN,
      this.layout.rows - 1 - GREETER_TILE_MARGIN,
    );
    if (!spawn) return; // no walkable tile — IntroBubble falls back to a fixed panel
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
    this.greeter = ch;
  }

  /** Start the greeter's despawn effect and release the greeter camera. The
   *  character is dropped once the effect finishes (see update()).
   *  Idempotent — every close path (answer, Escape, hooksStatus) funnels here. */
  despawnGreeter(): void {
    this.greeterCameraTarget = null;
    this.greeterCameraCancelled = false;
    if (!this.greeter || this.greeter.matrixEffect === 'despawn') return;
    startMatrixEffect(this.greeter, 'despawn');
  }

  /** Per-frame update from the bubble overlay; ignored once the user panned. */
  setGreeterCameraTarget(p: { x: number; y: number }): void {
    if (!this.greeterCameraCancelled) this.greeterCameraTarget = p;
  }

  /** Manual pan during the ask: stop re-centering until the next spawn. */
  cancelGreeterCamera(): void {
    this.greeterCameraTarget = null;
    this.greeterCameraCancelled = true;
  }

  removeAgent(id: number): void {
    const ch = this.characters.get(id);
    if (!ch) return;
    if (ch.matrixEffect === 'despawn') return; // already despawning
    // Free seat and clear selection immediately
    if (ch.seatId) {
      const seat = this.seats.get(ch.seatId);
      if (seat) seat.assigned = false;
      this.rebalanceRestSeatedAgents(id);
    }
    releaseRestSeat(ch, this.restSeatClaims);
    if (this.selectedAgentId === id) this.selectedAgentId = null;
    if (this.cameraFollowId === id) this.cameraFollowId = null;
    this.leaveCtoQueue(id);
    // Start despawn animation instead of immediate delete
    startMatrixEffect(ch, 'despawn');
    ch.bubbleType = null;
  }

  /** Find seat uid at a given tile position, or null */
  getSeatAtTile(col: number, row: number): string | null {
    for (const [uid, seat] of this.seats) {
      if (seat.seatCol === col && seat.seatRow === row) return uid;
    }
    return null;
  }

  /** Reassign an agent from their current seat to a new seat */
  reassignSeat(agentId: number, seatId: string): void {
    const ch = this.characters.get(agentId);
    if (!ch) return;
    releaseRestSeat(ch, this.restSeatClaims);
    // Unassign old seat
    if (ch.seatId) {
      const old = this.seats.get(ch.seatId);
      if (old) old.assigned = false;
    }
    // Assign new seat
    const seat = this.seats.get(seatId);
    if (!seat || seat.assigned) return;
    seat.assigned = true;
    ch.seatId = seatId;
    // Pathfind to new seat (unblock own seat tile for this query)
    const path = this.withOwnSeatUnblocked(ch, () =>
      findPath(ch.tileCol, ch.tileRow, seat.seatCol, seat.seatRow, this.tileMap, this.blockedTiles),
    );
    if (path.length > 0) {
      ch.path = path;
      ch.moveProgress = 0;
      ch.state = CharacterState.WALK;
      ch.frame = 0;
      ch.frameTimer = 0;
    } else {
      // Already at seat or no path — sit down
      ch.state = CharacterState.TYPE;
      ch.dir = seat.facingDir;
      ch.frame = 0;
      ch.frameTimer = 0;
      if (!ch.isActive) {
        ch.seatTimer = INACTIVE_SEAT_TIMER_MIN_SEC + Math.random() * INACTIVE_SEAT_TIMER_RANGE_SEC;
      }
    }
  }

  /**
   * Move a just-linked teammate to the free seat closest to its lead, so teams
   * cluster. Only moves when that seat is strictly closer than the teammate's
   * current one — a teammate created as a plain external agent (seated by an
   * arbitrary findFreeSeat) and tagged as a teammate only after tag discovery
   * would otherwise keep its arbitrary seat, unlike an inline teammate seated
   * next to the lead at creation.
   */
  private reseatNextToLead(teammateId: number, leadId: number): void {
    const teammate = this.characters.get(teammateId);
    const lead = this.characters.get(leadId);
    if (!teammate || !lead) return;
    const anchorAt = anchorTile(lead, this.seats);
    if (!anchorAt) return;
    const target = closestFreeSeat(this.seats, anchorAt.col, anchorAt.row);
    if (!target || target === teammate.seatId) return;
    const targetSeat = this.seats.get(target)!;
    const targetDist =
      Math.abs(targetSeat.seatCol - anchorAt.col) + Math.abs(targetSeat.seatRow - anchorAt.row);
    const currentSeat = teammate.seatId ? this.seats.get(teammate.seatId) : undefined;
    const currentDist = currentSeat
      ? Math.abs(currentSeat.seatCol - anchorAt.col) + Math.abs(currentSeat.seatRow - anchorAt.row)
      : Infinity;
    if (targetDist < currentDist) {
      this.reassignSeat(teammateId, target);
    }
  }

  /** Send an agent back to their currently assigned seat */
  sendToSeat(agentId: number): void {
    const ch = this.characters.get(agentId);
    if (!ch || !ch.seatId) return;
    releaseRestSeat(ch, this.restSeatClaims);
    const seat = this.seats.get(ch.seatId);
    if (!seat) return;
    const path = this.withOwnSeatUnblocked(ch, () =>
      findPath(ch.tileCol, ch.tileRow, seat.seatCol, seat.seatRow, this.tileMap, this.blockedTiles),
    );
    if (path.length > 0) {
      ch.path = path;
      ch.moveProgress = 0;
      ch.state = CharacterState.WALK;
      ch.frame = 0;
      ch.frameTimer = 0;
    } else {
      // Already at seat — sit down
      ch.state = CharacterState.TYPE;
      ch.dir = seat.facingDir;
      ch.frame = 0;
      ch.frameTimer = 0;
      if (!ch.isActive) {
        ch.seatTimer = INACTIVE_SEAT_TIMER_MIN_SEC + Math.random() * INACTIVE_SEAT_TIMER_RANGE_SEC;
      }
    }
  }

  /** Walk an agent to an arbitrary walkable tile (right-click command) */
  walkToTile(agentId: number, col: number, row: number): boolean {
    const ch = this.characters.get(agentId);
    if (!ch || ch.isSubagent) return false;
    releaseRestSeat(ch, this.restSeatClaims);
    if (!isWalkable(col, row, this.tileMap, this.blockedTiles)) {
      // Also allow walking to own seat tile (blocked for others but not self)
      const key = this.ownSeatKey(ch);
      if (!key || key !== `${col},${row}`) return false;
    }
    const path = this.withOwnSeatUnblocked(ch, () =>
      findPath(ch.tileCol, ch.tileRow, col, row, this.tileMap, this.blockedTiles),
    );
    if (path.length === 0) return false;
    ch.path = path;
    ch.moveProgress = 0;
    ch.state = CharacterState.WALK;
    ch.frame = 0;
    ch.frameTimer = 0;
    return true;
  }

  /** Create a sub-agent character with the parent's palette. Returns the sub-agent ID. */
  addSubagent(parentAgentId: number, parentToolId: string): number {
    const key = `${parentAgentId}:${parentToolId}`;
    if (this.subagentIdMap.has(key)) return this.subagentIdMap.get(key)!;

    const id = this.nextSubagentId--;
    const parentCh = this.characters.get(parentAgentId);
    const palette = parentCh ? parentCh.palette : 0;
    const hueShift = parentCh ? parentCh.hueShift : 0;

    // Find the closest walkable tile to the parent, avoiding tiles occupied by other characters
    const parentCol = parentCh ? parentCh.tileCol : 0;
    const parentRow = parentCh ? parentCh.tileRow : 0;
    let spawn = { col: parentCol, row: parentRow };
    if (this.walkableTiles.length > 0) {
      spawn = this.closestFreeWalkableTile(parentCol, parentRow) ?? this.walkableTiles[0];
    }

    const ch = createCharacter(id, palette, null, null, hueShift);
    ch.x = spawn.col * TILE_SIZE + TILE_SIZE / 2;
    ch.y = spawn.row * TILE_SIZE + TILE_SIZE / 2;
    ch.tileCol = spawn.col;
    ch.tileRow = spawn.row;
    // Face the same direction as the parent agent
    if (parentCh) ch.dir = parentCh.dir;
    ch.isSubagent = true;
    ch.parentAgentId = parentAgentId;
    startMatrixEffect(ch, 'spawn');
    this.characters.set(id, ch);

    this.subagentIdMap.set(key, id);
    this.subagentMeta.set(id, { parentAgentId, parentToolId });
    return id;
  }

  /** Remove a specific sub-agent character and free its seat */
  removeSubagent(parentAgentId: number, parentToolId: string): void {
    const key = `${parentAgentId}:${parentToolId}`;
    const id = this.subagentIdMap.get(key);
    if (id === undefined) return;

    const ch = this.characters.get(id);
    if (ch) {
      if (ch.matrixEffect === 'despawn') {
        // Already despawning — just clean up maps
        this.subagentIdMap.delete(key);
        this.subagentMeta.delete(id);
        return;
      }
      if (ch.seatId) {
        const seat = this.seats.get(ch.seatId);
        if (seat) seat.assigned = false;
      }
      // Start despawn animation — keep character in map for rendering
      startMatrixEffect(ch, 'despawn');
      ch.bubbleType = null;
    }
    // Clean up tracking maps immediately so keys don't collide
    this.subagentIdMap.delete(key);
    this.subagentMeta.delete(id);
    if (this.selectedAgentId === id) this.selectedAgentId = null;
    if (this.cameraFollowId === id) this.cameraFollowId = null;
  }

  /** Remove all sub-agents belonging to a parent agent */
  removeAllSubagents(parentAgentId: number): void {
    const toRemove: string[] = [];
    for (const [key, id] of this.subagentIdMap) {
      const meta = this.subagentMeta.get(id);
      if (meta && meta.parentAgentId === parentAgentId) {
        const ch = this.characters.get(id);
        if (ch) {
          if (ch.matrixEffect === 'despawn') {
            // Already despawning — just clean up maps
            this.subagentMeta.delete(id);
            toRemove.push(key);
            continue;
          }
          if (ch.seatId) {
            const seat = this.seats.get(ch.seatId);
            if (seat) seat.assigned = false;
          }
          // Start despawn animation
          startMatrixEffect(ch, 'despawn');
          ch.bubbleType = null;
        }
        this.subagentMeta.delete(id);
        if (this.selectedAgentId === id) this.selectedAgentId = null;
        if (this.cameraFollowId === id) this.cameraFollowId = null;
        toRemove.push(key);
      }
    }
    for (const key of toRemove) {
      this.subagentIdMap.delete(key);
    }
  }

  /** Look up the sub-agent character ID for a given parent+toolId, or null */
  getSubagentId(parentAgentId: number, parentToolId: string): number | null {
    return this.subagentIdMap.get(`${parentAgentId}:${parentToolId}`) ?? null;
  }

  setAgentActive(id: number, active: boolean): void {
    const ch = this.characters.get(id);
    if (ch) {
      ch.isActive = active;
      if (!active) {
        // Sentinel -1: signals turn just ended, skip next seat rest timer.
        // Prevents the WALK handler from setting a 2-4 min rest on arrival.
        ch.seatTimer = -1;
        ch.path = [];
        ch.moveProgress = 0;
      } else {
        this.leaveCtoQueue(id, 'input');
        this.claimWorkSeatForActiveAgent(ch);
      }
      this.rebuildFurnitureInstances();
    }
  }

  /** Rebuild furniture instances with auto-state applied (active agents turn electronics ON) */
  private rebuildFurnitureInstances(): void {
    // Collect tiles where active agents face desks
    const autoOnTiles = new Set<string>();
    for (const ch of [...this.characters.values(), ...(this.cto ? [this.cto] : [])]) {
      if (!ch.isActive || !ch.seatId) continue;
      const seat = this.seats.get(ch.seatId);
      if (!seat) continue;
      // Find the desk tile(s) the agent faces from their seat
      const dCol =
        seat.facingDir === Direction.RIGHT ? 1 : seat.facingDir === Direction.LEFT ? -1 : 0;
      const dRow = seat.facingDir === Direction.DOWN ? 1 : seat.facingDir === Direction.UP ? -1 : 0;
      // Check tiles in the facing direction (desk could be 1-3 tiles deep)
      for (let d = 1; d <= AUTO_ON_FACING_DEPTH; d++) {
        const tileCol = seat.seatCol + dCol * d;
        const tileRow = seat.seatRow + dRow * d;
        autoOnTiles.add(`${tileCol},${tileRow}`);
      }
      // Also check tiles to the sides of the facing direction (desks can be wide)
      for (let d = 1; d <= AUTO_ON_SIDE_DEPTH; d++) {
        const baseCol = seat.seatCol + dCol * d;
        const baseRow = seat.seatRow + dRow * d;
        if (dCol !== 0) {
          // Facing left/right: check tiles above and below
          autoOnTiles.add(`${baseCol},${baseRow - 1}`);
          autoOnTiles.add(`${baseCol},${baseRow + 1}`);
        } else {
          // Facing up/down: check tiles left and right
          autoOnTiles.add(`${baseCol - 1},${baseRow}`);
          autoOnTiles.add(`${baseCol + 1},${baseRow}`);
        }
      }
    }

    // Build modified furniture list with auto-state and animation applied.
    // Items placed directly in an animated on state (an espresso machine
    // that is always running) animate regardless of who is nearby.
    const animFrame = Math.floor(this.furnitureAnimTimer / FURNITURE_ANIM_INTERVAL_SEC);
    const animate = (type: string): string => {
      const frames = getAnimationFrames(type);
      return frames && frames.length > 1 ? frames[animFrame % frames.length] : type;
    };
    const modifiedFurniture: PlacedFurniture[] = this.layout.furniture.map((item) => {
      const entry = getCatalogEntry(item.type);
      if (!entry) return item;
      const placedAnimated = animate(item.type);
      if (placedAnimated !== item.type) return { ...item, type: placedAnimated };
      for (let dr = 0; dr < entry.footprintH; dr++) {
        for (let dc = 0; dc < entry.footprintW; dc++) {
          if (autoOnTiles.has(`${item.col + dc},${item.row + dr}`)) {
            const onType = getOnStateType(item.type);
            return onType === item.type ? item : { ...item, type: animate(onType) };
          }
        }
      }
      return item;
    });

    this.furniture = layoutToFurnitureInstances(modifiedFurniture);
  }

  setAgentTool(id: number, tool: string | null): void {
    const ch = this.characters.get(id);
    if (ch) {
      ch.currentTool = tool;
    }
  }

  showPermissionBubble(id: number): void {
    const ch = this.characters.get(id);
    if (ch) {
      ch.bubbleType = 'permission';
      ch.bubbleTimer = 0;
      this.joinCtoQueue(id, 'permission');
    }
  }

  clearPermissionBubble(id: number): void {
    const ch = this.characters.get(id);
    if (ch && ch.bubbleType === 'permission') {
      ch.bubbleType = null;
      ch.bubbleTimer = 0;
    }
    this.leaveCtoQueue(id, 'permission');
  }

  showWaitingBubble(id: number, awaitingInput = false): void {
    const ch = this.characters.get(id);
    if (ch) {
      ch.bubbleType = 'waiting';
      ch.waitingAwaitingInput = awaitingInput;
      ch.bubbleTimer = WAITING_BUBBLE_DURATION_SEC;
      if (awaitingInput) this.joinCtoQueue(id, 'input');
      else this.leaveCtoQueue(id, 'input');
    }
  }

  /** Dismiss bubble on click — permission: instant, waiting: quick fade */
  dismissBubble(id: number): void {
    const ch = this.characters.get(id);
    if (!ch || !ch.bubbleType) return;
    if (ch.bubbleType === 'permission') {
      ch.bubbleType = null;
      ch.bubbleTimer = 0;
    } else if (ch.bubbleType === 'waiting') {
      // Trigger immediate fade (0.3s remaining)
      ch.bubbleTimer = Math.min(ch.bubbleTimer, DISMISS_BUBBLE_FAST_FADE_SEC);
    }
  }

  // ── Pets ──────────────────────────────────────────────────────

  /**
   * Spawn a placed pet at a uniformly-random walkable tile. Bounds-checks
   * petType against the loaded sprite count to defend against stale layouts.
   */
  private spawnPet(placedPet: PlacedPet): void {
    // Defensive guards (upstream 5e6c0a0)
    if (
      typeof placedPet.id !== 'string' ||
      placedPet.id.length === 0 ||
      placedPet.id.length > MAX_PET_ID_LENGTH
    ) {
      return;
    }
    if (
      !Number.isInteger(placedPet.petType) ||
      placedPet.petType < 0 ||
      placedPet.petType >= getPetCount()
    ) {
      return;
    }
    if (this.pets.some((p) => p.id === placedPet.id)) return; // de-dupe
    if (this.walkableTiles.length === 0) return; // no spawn space — silently drop

    const spawn = this.walkableTiles[Math.floor(Math.random() * this.walkableTiles.length)];
    const pet = createPet(placedPet.id, placedPet.petType, spawn.col, spawn.row);
    pet.name = getPetName(placedPet.petType);
    this.pets.push(pet);
  }

  /** Shallow snapshot for external consumers (renderer, hooks). */
  getPets(): Pet[] {
    return this.pets.slice();
  }

  /**
   * Hit-test pets at an iso screen point (unscaled sprite px). Front-most
   * (largest x + y) first so the visually-frontmost pet receives the click.
   * Returns the pet id or null.
   */
  getPetAt(isoX: number, isoY: number): string | null {
    const ordered = this.pets.slice().sort((a, b) => b.x + b.y - (a.x + a.y));
    for (const pet of ordered) {
      const anchor = worldToIso(pet.x, pet.y);
      if (
        Math.abs(isoX - anchor.x) <= PET_HIT_HALF_WIDTH &&
        isoY >= anchor.y - PET_HIT_HEIGHT &&
        isoY <= anchor.y
      ) {
        return pet.id;
      }
    }
    return null;
  }

  /** Show the heart bubble on a pet for WAITING_BUBBLE_DURATION_SEC. */
  showPetBubble(petId: string): void {
    const pet = this.pets.find((p) => p.id === petId);
    if (!pet) return;
    pet.bubbleType = 'heart';
    pet.bubbleTimer = WAITING_BUBBLE_DURATION_SEC;
  }

  /** Dismiss the heart bubble on click; collapses timer to a fast fade. */
  dismissPetBubble(petId: string): void {
    const pet = this.pets.find((p) => p.id === petId);
    if (!pet || !pet.bubbleType) return;
    pet.bubbleTimer = Math.min(pet.bubbleTimer, DISMISS_BUBBLE_FAST_FADE_SEC);
  }

  /**
   * Reconcile `this.pets` to match the layout's placed-pet roster.
   * - Pets in layout but not in runtime → spawn via spawnPet().
   * - Pets in runtime but not in layout → remove.
   * - Pets in both → keep existing runtime state (position, FSM).
   *
   * Called from constructor and rebuildFromLayout. Always runs AFTER walkableTiles
   * is populated.
   */
  private rebuildPetsFromLayout(layout: OfficeLayout): void {
    const placed = layout.pets ?? [];
    const placedIds = new Set(placed.map((p) => p.id));

    // 1. Remove pets no longer in layout
    this.pets = this.pets.filter((p) => placedIds.has(p.id));

    // 2. Add pets that exist in layout but not in runtime
    const existingIds = new Set(this.pets.map((p) => p.id));
    for (const p of placed) {
      if (existingIds.has(p.id)) continue;
      this.spawnPet(p);
    }
  }

  setTeamInfo(
    id: number,
    teamName?: string,
    agentName?: string,
    isTeamLead?: boolean,
    leadAgentId?: number,
    teamUsesTmux?: boolean,
  ): void {
    const ch = this.characters.get(id);
    if (!ch) return;
    const wasUnlinked = ch.leadAgentId === undefined;
    ch.teamName = teamName;
    ch.agentName = agentName;
    ch.isTeamLead = isTeamLead;
    ch.leadAgentId = leadAgentId;
    if (teamUsesTmux !== undefined) {
      ch.teamUsesTmux = teamUsesTmux;
    }
    // A teammate discovered only after its plain external session was adopted is
    // linked here, not at creation, so it never went through the seat-next-to-lead
    // path addAgent runs for inline teammates. Cluster it now, once, on first link.
    if (wasUnlinked && leadAgentId !== undefined && !isTeamLead) {
      this.reseatNextToLead(id, leadAgentId);
    }
  }

  setAgentContext(id: number, contextTokens: number, maxContextTokens: number): void {
    const ch = this.characters.get(id);
    if (!ch) return;
    ch.contextTokens = contextTokens;
    ch.maxContextTokens = maxContextTokens;
  }

  setAgentInfo(id: number, name: string | undefined, task: string | undefined): void {
    const ch = this.characters.get(id);
    if (!ch) return;
    if (name !== undefined) ch.folderName = name || undefined;
    if (task !== undefined) ch.task = task || undefined;
  }

  update(dt: number): void {
    // Furniture animation cycling
    const prevFrame = Math.floor(this.furnitureAnimTimer / FURNITURE_ANIM_INTERVAL_SEC);
    this.furnitureAnimTimer += dt;
    const newFrame = Math.floor(this.furnitureAnimTimer / FURNITURE_ANIM_INTERVAL_SEC);
    if (newFrame !== prevFrame) {
      this.rebuildFurnitureInstances();
    }

    // The greeter materializes and dematerializes like anyone else, but runs
    // no FSM — it stands where it spawned for as long as the ask is up.
    if (this.greeter && advanceMatrixEffect(this.greeter, dt) === 'despawned') {
      this.greeter = null;
    }

    this.updateCto(dt);
    this.rotateCtoQueue(dt);

    const toDelete: number[] = [];
    for (const ch of this.characters.values()) {
      const effect = advanceMatrixEffect(ch, dt);
      if (effect !== 'none') {
        if (effect === 'despawned') toDelete.push(ch.id);
        continue; // skip normal FSM while the effect is (or just was) active
      }

      // Temporarily unblock own seat + reachable rest seats so the FSM can pathfind
      this.withPathableSeatsUnblocked(ch, () =>
        updateCharacter(
          ch,
          dt,
          this.walkableTiles,
          this.seats,
          this.tileMap,
          this.blockedTiles,
          this.restSeatUids,
          this.restSeatClaims,
        ),
      );

      // Tick bubble timer for waiting bubbles. An agent queued at the CTO door
      // for input keeps its "waiting for input" badge until the queue clears.
      if (ch.bubbleType === 'waiting' && !(ch.ctoQueueSlot && ch.waitingAwaitingInput)) {
        ch.bubbleTimer -= dt;
        if (ch.bubbleTimer <= 0) {
          ch.bubbleType = null;
          ch.bubbleTimer = 0;
        }
      }
    }
    // Remove characters that finished despawn
    for (const id of toDelete) {
      this.characters.delete(id);
    }

    // ── Pet FSM ────────────────────────────────────────────────
    for (const pet of this.pets) {
      updatePet(pet, dt, this.walkableTiles, this.characters, this.tileMap, this.blockedTiles);

      // Tick heart bubble timer (mirrors character waiting-bubble pattern)
      if (pet.bubbleType) {
        pet.bubbleTimer -= dt;
        if (pet.bubbleTimer <= 0) {
          pet.bubbleType = null;
          pet.bubbleTimer = 0;
        }
      }
    }
  }

  /** The `saveAgentSeats` payload: palette, hue and seat for every agent worth
   *  restoring. Sub-agents are excluded because they are derived state the
   *  runtime re-materializes, and the greeter never reaches here at all —
   *  it is not in `characters`. */
  getPersistableSeats(): Record<
    number,
    { palette: number; hueShift: number; seatId: string | null }
  > {
    const seats: Record<number, { palette: number; hueShift: number; seatId: string | null }> = {};
    for (const ch of this.characters.values()) {
      if (ch.isSubagent) continue;
      seats[ch.id] = { palette: ch.palette, hueShift: ch.hueShift, seatId: ch.seatId };
    }
    return seats;
  }

  /** Everything the renderer draws: the agents plus, while the first-run ask
   *  is up, the consent greeter. This is the ONE place the greeter joins the
   *  agents — every other consumer reads `characters` and gets agents only. */
  getCharacters(): Character[] {
    const chars = Array.from(this.characters.values());
    if (this.greeter) chars.push(this.greeter);
    if (this.cto) chars.push(this.cto);
    return chars;
  }

  /** Get the character drawn at an iso screen point (unscaled sprite px).
   *  Returns id or null. Agents only: clicks pass straight through the consent
   *  greeter, which is a prop, not something to select or follow. */
  getCharacterAt(isoX: number, isoY: number): number | null {
    const chars = Array.from(this.characters.values()).sort((a, b) => b.x + b.y - (a.x + a.y));
    for (const ch of chars) {
      if (ch.matrixEffect === 'despawn') continue;
      const sittingOffset = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0;
      const anchor = worldToIso(ch.x, ch.y);
      const bottom = anchor.y + sittingOffset;
      if (
        Math.abs(isoX - anchor.x) <= CHARACTER_HIT_HALF_WIDTH &&
        isoY >= bottom - CHARACTER_HIT_HEIGHT &&
        isoY <= bottom
      ) {
        return ch.id;
      }
    }
    return null;
  }
}
