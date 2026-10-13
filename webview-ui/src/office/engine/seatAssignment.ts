/**
 * Desk and lounge seat assignment: which seats count as a desk versus lounge
 * seating, picking a free seat for a new or reseated agent, and claiming or
 * releasing a work seat as an agent goes active or idle.
 */

import { pickDiversePalette as pickDiversePaletteFromCounts } from '../../../../core/src/paletteUtils.js';
import { AUTO_ON_FACING_DEPTH } from '../../constants.js';
import { getCatalogEntry } from '../layout/furnitureCatalog.js';
import { findPath } from '../layout/tileMap.js';
import { getLoadedCharacterCount } from '../sprites/spriteData.js';
import type {
  Character,
  OfficeLayout,
  PlacedFurniture,
  Seat,
  TileType as TileTypeVal,
} from '../types.js';
import { CharacterState, Direction, TILE_SIZE } from '../types.js';
import { anchorTile, closestFreeSeat } from './seatPlacement.js';
import type { WorldAccess } from './worldAccess.js';

/** Internal helper: facing-tile coords for a seat. Returns null for invalid direction. */
function seatFacingOffset(direction: Direction): { dCol: number; dRow: number } {
  if (direction === Direction.RIGHT) return { dCol: 1, dRow: 0 };
  if (direction === Direction.LEFT) return { dCol: -1, dRow: 0 };
  if (direction === Direction.DOWN) return { dCol: 0, dRow: 1 };
  return { dCol: 0, dRow: -1 };
}

/** Collect every tile occupied by electronics furniture (PCs, monitors, etc.). */
function buildElectronicsTileSet(furniture: PlacedFurniture[]): Set<string> {
  const out = new Set<string>();
  for (const item of furniture) {
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

/**
 * Does this seat face an electronics tile (PC, monitor)? Mirrors the
 * forward-and-flanking scan used by furniture auto-state.
 */
function isSeatFacingElectronics(seat: Seat, electronicsTiles: Set<string>): boolean {
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
export function computeRestSeats(
  seats: ReadonlyMap<string, Seat>,
  furniture: PlacedFurniture[],
): Set<string> {
  const electronicsTiles = buildElectronicsTileSet(furniture);
  const rest = new Set<string>();
  for (const [uid, seat] of seats) {
    if (!isSeatFacingElectronics(seat, electronicsTiles)) rest.add(uid);
  }
  return rest;
}

/** Find the area label assigned to a seat's tile, or null. */
export function seatZone(
  uid: string,
  seats: ReadonlyMap<string, Seat>,
  areaTiles: OfficeLayout['areaTiles'],
  cols: number,
): string | null {
  const seat = seats.get(uid);
  if (!seat) return null;
  if (!areaTiles || areaTiles.length === 0) return null;
  const idx = seat.seatRow * cols + seat.seatCol;
  if (idx < 0 || idx >= areaTiles.length) return null;
  return areaTiles[idx] ?? null;
}

/** Random-pick a seat from a candidate list, or null when it's empty. */
function pickRandomSeat(seatUids: string[]): string | null {
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
function pickSeatByArea(
  freeSeats: string[],
  folderName: string | undefined,
  seats: ReadonlyMap<string, Seat>,
  areaMappings: Record<string, string[]>,
  areaTiles: OfficeLayout['areaTiles'],
  cols: number,
): string | null {
  if (freeSeats.length === 0) return null;
  const areaLabels = folderName ? areaMappings[folderName] : undefined;

  if (areaLabels && areaLabels.length > 0) {
    const wanted = new Set(areaLabels);
    const inArea = freeSeats.filter((uid) => {
      const label = seatZone(uid, seats, areaTiles, cols);
      return label !== null && wanted.has(label);
    });
    const pick = pickRandomSeat(inArea);
    if (pick) return pick;
  }

  const unzoned = freeSeats.filter((uid) => seatZone(uid, seats, areaTiles, cols) === null);
  const pick2 = pickRandomSeat(unzoned);
  if (pick2) return pick2;

  return pickRandomSeat(freeSeats);
}

/**
 * Desk-seat picker for top-level agents. Work (PC-facing) seats are always
 * exhausted — across every Area stage — before a rest/lounge seat is ever
 * handed out as someone's desk: the Area stages used to run their
 * preference PER POOL, so a folder routed into an area with only sofas free
 * would seat an agent on a sofa even while desks sat empty in another area.
 * A rest seat is now only a fallback for when no desk is free anywhere.
 */
export function findFreeSeat(
  seats: ReadonlyMap<string, Seat>,
  restSeatUids: ReadonlySet<string>,
  folderName: string | undefined,
  areaMappings: Record<string, string[]>,
  areaTiles: OfficeLayout['areaTiles'],
  cols: number,
): string | null {
  const freeWorkSeats: string[] = [];
  const freeRestSeats: string[] = [];
  for (const [uid, seat] of seats) {
    if (seat.assigned) continue;
    (restSeatUids.has(uid) ? freeRestSeats : freeWorkSeats).push(uid);
  }
  return (
    pickSeatByArea(freeWorkSeats, folderName, seats, areaMappings, areaTiles, cols) ??
    pickSeatByArea(freeRestSeats, folderName, seats, areaMappings, areaTiles, cols)
  );
}

/** First free desk/work (non-rest) seat uid, or null if every one is taken. */
export function findFreeWorkSeatUid(
  seats: ReadonlyMap<string, Seat>,
  restSeatUids: ReadonlySet<string>,
): string | null {
  for (const [uid, seat] of seats) {
    if (!seat.assigned && !restSeatUids.has(uid)) return uid;
  }
  return null;
}

/** Get the blocked-tile key for a character's own seat, or null */
export function ownSeatKey(ch: Character, seats: ReadonlyMap<string, Seat>): string | null {
  if (!ch.seatId) return null;
  const seat = seats.get(ch.seatId);
  if (!seat) return null;
  return `${seat.seatCol},${seat.seatRow}`;
}

/** Temporarily unblock a character's own seat, run fn, then re-block */
export function withOwnSeatUnblocked<T>(
  ch: Character,
  seats: ReadonlyMap<string, Seat>,
  blockedTiles: Set<string>,
  fn: () => T,
): T {
  const key = ownSeatKey(ch, seats);
  if (key) blockedTiles.delete(key);
  const result = fn();
  if (key) blockedTiles.add(key);
  return result;
}

/** Temporarily unblock every seat tile a character's FSM tick might legitimately path
 *  onto: its own desk, its already-claimed rest seat, and every rest seat still free to
 *  claim. Chairs are otherwise impassable to everyone but their own sitter (mirrors
 *  `withOwnSeatUnblocked`), so a candidate lounge seat has to be unblocked before
 *  `headToRestSeat` can even pathfind to it, let alone claim it. */
export function withPathableSeatsUnblocked<T>(ch: Character, world: WorldAccess, fn: () => T): T {
  const keys = new Set<string>();
  const own = ownSeatKey(ch, world.seats);
  if (own) keys.add(own);
  if (ch.restSeatId) {
    const seat = world.seats.get(ch.restSeatId);
    if (seat) keys.add(`${seat.seatCol},${seat.seatRow}`);
  }
  for (const uid of world.restSeatUids) {
    const seat = world.seats.get(uid);
    if (!seat || seat.assigned || world.restSeatClaims.has(uid)) continue;
    keys.add(`${seat.seatCol},${seat.seatRow}`);
  }
  for (const key of keys) world.blockedTiles.delete(key);
  const result = fn();
  for (const key of keys) world.blockedTiles.add(key);
  return result;
}

/** Pathfind a character onto `seat` and start walking, or sit immediately when already
 *  there or unreachable. Returns true when it started walking, false when it sat down. */
export function walkOrSitAtSeat(
  ch: Character,
  seat: Seat,
  seats: ReadonlyMap<string, Seat>,
  tileMap: TileTypeVal[][],
  blockedTiles: Set<string>,
): boolean {
  const path = withOwnSeatUnblocked(ch, seats, blockedTiles, () =>
    findPath(ch.tileCol, ch.tileRow, seat.seatCol, seat.seatRow, tileMap, blockedTiles),
  );
  if (path.length > 0) {
    ch.path = path;
    ch.moveProgress = 0;
    ch.state = CharacterState.WALK;
    ch.frame = 0;
    ch.frameTimer = 0;
    return true;
  }
  ch.state = CharacterState.TYPE;
  ch.dir = seat.facingDir;
  ch.frame = 0;
  ch.frameTimer = 0;
  return false;
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
function assignWorkSeat(
  ch: Character,
  workSeatUid: string,
  previousOwner: Character | null,
  seats: ReadonlyMap<string, Seat>,
  tileMap: TileTypeVal[][],
  blockedTiles: Set<string>,
): void {
  const workSeat = seats.get(workSeatUid);
  if (!workSeat) return;
  const oldSeatId = ch.seatId;
  if (previousOwner) {
    previousOwner.seatId = oldSeatId;
  } else if (oldSeatId) {
    const old = seats.get(oldSeatId);
    if (old) old.assigned = false;
  }
  workSeat.assigned = true;
  ch.seatId = workSeatUid;
  walkOrSitAtSeat(ch, workSeat, seats, tileMap, blockedTiles);
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
export function claimWorkSeatForActiveAgent(ch: Character, world: WorldAccess): void {
  if (!ch.isActive || !ch.seatId || !world.restSeatUids.has(ch.seatId)) return;
  const freeSeatId = findFreeWorkSeatUid(world.seats, world.restSeatUids);
  if (freeSeatId) {
    assignWorkSeat(ch, freeSeatId, null, world.seats, world.tileMap, world.blockedTiles);
    return;
  }
  for (const other of world.characters.values()) {
    if (other.id === ch.id || other.isActive) continue;
    if (!other.seatId || world.restSeatUids.has(other.seatId)) continue;
    assignWorkSeat(ch, other.seatId, other, world.seats, world.tileMap, world.blockedTiles);
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
export function rebalanceRestSeatedAgents(world: WorldAccess, excludeId?: number): void {
  for (const ch of world.characters.values()) {
    if (ch.id === excludeId) continue;
    claimWorkSeatForActiveAgent(ch, world);
  }
}

/** Closest walkable tile to (col,row) not occupied by another character, or null. */
export function closestFreeWalkableTile(
  col: number,
  row: number,
  characters: ReadonlyMap<number, Character>,
  walkableTiles: Array<{ col: number; row: number }>,
): { col: number; row: number } | null {
  const occupied = new Set<string>();
  for (const ch of characters.values()) {
    occupied.add(`${ch.tileCol},${ch.tileRow}`);
  }
  let best: { col: number; row: number } | null = null;
  let bestDist = Infinity;
  for (const tile of walkableTiles) {
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
export function pickDiversePalette(characters: ReadonlyMap<number, Character>): {
  palette: number;
  hueShift: number;
} {
  const paletteCount = getLoadedCharacterCount();
  const counts = new Array(paletteCount).fill(0) as number[];
  for (const ch of characters.values()) {
    if (ch.isSubagent) continue;
    if (ch.palette < paletteCount) counts[ch.palette]++;
  }
  return pickDiversePaletteFromCounts(paletteCount, counts);
}

/**
 * Move a just-linked teammate to the free seat closest to its lead, so teams
 * cluster. Only moves when that seat is strictly closer than the teammate's
 * current one — a teammate created as a plain external agent (seated by an
 * arbitrary findFreeSeat) and tagged as a teammate only after tag discovery
 * would otherwise keep its arbitrary seat, unlike an inline teammate seated
 * next to the lead at creation. Returns the seat uid to reassign the
 * teammate to, or null when it should keep its current seat.
 */
export function reseatNextToLead(
  teammateId: number,
  leadId: number,
  characters: ReadonlyMap<number, Character>,
  seats: ReadonlyMap<string, Seat>,
): string | null {
  const teammate = characters.get(teammateId);
  const lead = characters.get(leadId);
  if (!teammate || !lead) return null;
  const anchorAt = anchorTile(lead, seats);
  if (!anchorAt) return null;
  const target = closestFreeSeat(seats, anchorAt.col, anchorAt.row);
  if (!target || target === teammate.seatId) return null;
  const targetSeat = seats.get(target)!;
  const targetDist =
    Math.abs(targetSeat.seatCol - anchorAt.col) + Math.abs(targetSeat.seatRow - anchorAt.row);
  const currentSeat = teammate.seatId ? seats.get(teammate.seatId) : undefined;
  const currentDist = currentSeat
    ? Math.abs(currentSeat.seatCol - anchorAt.col) + Math.abs(currentSeat.seatRow - anchorAt.row)
    : Infinity;
  return targetDist < currentDist ? target : null;
}

export interface NewAgentPlacement {
  seatId: string | null;
  spawn: { col: number; row: number } | null;
}

/**
 * Resolve where a new (or teammate) agent should appear: its preferred seat first (unless
 * that seat has since been demoted to a rest seat and a real desk is now free), then — for
 * a teammate — the free seat closest to its anchor agent, then any free seat. When every
 * seat is taken, a teammate spawns beside its anchor and anyone else at a random walkable
 * tile. `anchorAt` is the anchor's SEAT (stable from creation) rather than its live tile,
 * so a teammate placed while the lead is still walking to its seat still clusters around
 * the final seat.
 */
export function resolveNewAgentPlacement(
  world: WorldAccess,
  preferredSeatId: string | undefined,
  anchorAt: { col: number; row: number } | undefined,
  folderName: string | undefined,
): NewAgentPlacement {
  const { seats, restSeatUids, areaMappings, layout, characters, walkableTiles } = world;
  let seatId: string | null = null;
  if (preferredSeatId && seats.has(preferredSeatId)) {
    const seat = seats.get(preferredSeatId)!;
    // A persisted desk that is now a rest seat is only honored when no real desk is
    // free, otherwise restore would keep repeating the original misassignment forever.
    const demoted =
      restSeatUids.has(preferredSeatId) && findFreeWorkSeatUid(seats, restSeatUids) !== null;
    if (!seat.assigned && !demoted) {
      seatId = preferredSeatId;
    }
  }
  if (!seatId && anchorAt) {
    seatId = closestFreeSeat(seats, anchorAt.col, anchorAt.row);
  }
  if (!seatId) {
    seatId = findFreeSeat(
      seats,
      restSeatUids,
      folderName,
      areaMappings,
      layout.areaTiles,
      layout.cols,
    );
  }
  if (seatId) return { seatId, spawn: null };

  let spawn = anchorAt
    ? closestFreeWalkableTile(anchorAt.col, anchorAt.row, characters, walkableTiles)
    : null;
  if (!spawn) {
    spawn =
      walkableTiles.length > 0
        ? walkableTiles[Math.floor(Math.random() * walkableTiles.length)]
        : { col: 1, row: 1 };
  }
  return { seatId: null, spawn };
}

/** Reassign existing characters to a rebuilt layout's seats, preserving their current seat
 *  when it still exists and is free; everyone else gets a free seat if one is available.
 *  Characters that end up without a seat are left for the caller to relocate. */
export function reseatCharactersForLayout(world: WorldAccess): void {
  const { characters, seats, restSeatUids, areaMappings, layout } = world;
  for (const ch of characters.values()) {
    if (ch.seatId && seats.has(ch.seatId)) {
      const seat = seats.get(ch.seatId)!;
      if (!seat.assigned) {
        seat.assigned = true;
        ch.tileCol = seat.seatCol;
        ch.tileRow = seat.seatRow;
        ch.x = seat.seatCol * TILE_SIZE + TILE_SIZE / 2;
        ch.y = seat.seatRow * TILE_SIZE + TILE_SIZE / 2;
        ch.dir = seat.facingDir;
        continue;
      }
    }
    ch.seatId = null;
  }

  for (const ch of characters.values()) {
    if (ch.seatId) continue;
    const seatId = findFreeSeat(
      seats,
      restSeatUids,
      ch.folderName,
      areaMappings,
      layout.areaTiles,
      layout.cols,
    );
    if (!seatId) continue;
    seats.get(seatId)!.assigned = true;
    ch.seatId = seatId;
    const seat = seats.get(seatId)!;
    ch.tileCol = seat.seatCol;
    ch.tileRow = seat.seatRow;
    ch.x = seat.seatCol * TILE_SIZE + TILE_SIZE / 2;
    ch.y = seat.seatRow * TILE_SIZE + TILE_SIZE / 2;
    ch.dir = seat.facingDir;
  }
}

/** Relocate characters an edited layout left outside its bounds (seated characters are
 *  fine: rebuildFromLayout already snapped them onto a valid seat). */
export function relocateOutOfBoundsCharacters(
  characters: Map<number, Character>,
  layout: OfficeLayout,
  relocate: (ch: Character) => void,
): void {
  for (const ch of characters.values()) {
    if (ch.seatId) continue;
    if (
      ch.tileCol < 0 ||
      ch.tileCol >= layout.cols ||
      ch.tileRow < 0 ||
      ch.tileRow >= layout.rows
    ) {
      relocate(ch);
    }
  }
}
