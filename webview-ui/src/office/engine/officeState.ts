import { FURNITURE_ANIM_INTERVAL_SEC } from '../../constants.js';
import {
  createDefaultLayout,
  getBlockedTiles,
  layoutToSeats,
  layoutToTileMap,
} from '../layout/layoutSerializer.js';
import { getWalkableTiles } from '../layout/tileMap.js';
import type {
  Character,
  FurnitureInstance,
  OfficeLayout,
  Pet,
  Seat,
  TileType as TileTypeVal,
} from '../types.js';
import { TILE_SIZE } from '../types.js';
import { reassignSeat, sendToSeat, walkToTile } from './agentMovement.js';
import {
  clearPermissionBubble,
  dismissBubble,
  setAgentContext,
  setAgentInfo,
  setAgentTool,
  setTeamInfo,
  showPermissionBubble,
  showWaitingBubble,
} from './agentStatus.js';
import { createCharacter, releaseRestSeat, updateCharacter } from './characters.js';
import { CtoOffice } from './ctoOffice.js';
import { rebuildFurnitureInstances } from './furnitureAutoState.js';
import { despawnGreeter, spawnGreeter } from './greeterAgent.js';
import { getCharacterAt } from './hitTesting.js';
import { advanceMatrixEffect, startMatrixEffect } from './matrixEffectState.js';
import { updatePet } from './petEntity.js';
import {
  dismissPetBubble,
  getPetAt,
  rebuildPetsFromLayout,
  relocateOutOfBoundsPets,
  showPetBubble,
} from './pets.js';
import {
  claimWorkSeatForActiveAgent,
  computeRestSeats,
  pickDiversePalette,
  rebalanceRestSeatedAgents,
  relocateOutOfBoundsCharacters,
  reseatCharactersForLayout,
  reseatNextToLead,
  resolveNewAgentPlacement,
  seatZone,
  withPathableSeatsUnblocked,
} from './seatAssignment.js';
import { anchorTile } from './seatPlacement.js';
import { addSubagent, removeAllSubagents, removeSubagent, subagentKey } from './subagents.js';

/** The `saveAgentSeats` payload: each agent's palette, hue and seat, by agent id. */
export type PersistableSeats = Record<
  number,
  { palette: number; hueShift: number; seatId: string | null }
>;

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
  /** Maps "parentId:toolId" → sub-agent character ID (negative) */
  subagentIdMap: Map<string, number> = new Map();
  /** Reverse lookup: sub-agent character ID → parent info */
  subagentMeta: Map<number, { parentAgentId: number; parentToolId: string }> = new Map();
  /** Sub-agent ids are negative and unique across every floor of the building: the next one to hand out. */
  private readonly subagentIds: { next: number };

  /** folderName → list of Area labels that workspace folder belongs to, as the server
   *  last sent them. Biases new-agent seat picking toward the folder's Area. */
  areaMappings: Record<string, string[]> = {};

  /** The first-run consent greeter, deliberately NOT in `characters`: everything that
   *  iterates `characters` (seat assignment, palette diversity, the wander FSM,
   *  hit-testing, the persisted seat payload) is asking an agent question the greeter
   *  has no answer to. `getCharacters()` is the only place it joins the agents. */
  greeter: Character | null = null;

  /** World-space point the camera drifts to while the greeter is up
   *  (the bubble overlay recomputes it every frame: the combined center of the
   *  character and its speech bubble). An explicit cameraFollowId outranks it. */
  greeterCameraTarget: { x: number; y: number } | null = null;
  /** Latched by a manual pan during the ask: the user took the camera, so the
   *  overlay's per-frame updates stop re-centering. Reset on spawn/despawn. */
  private greeterCameraCancelled = false;

  /** The CTO's loop and the queue of agents that need the human. */
  private readonly ctoOffice = new CtoOffice(this);

  /** The fixed CTO character, seated at the layout's executive chair. Like the greeter it
   *  is not an agent and lives outside `characters`. Null when the layout has no exec chair. */
  get cto(): Character | null {
    return this.ctoOffice.cto;
  }

  setAreaMappings(mappings: Record<string, string[]>): void {
    this.areaMappings = mappings;
  }

  constructor(layout?: OfficeLayout, subagentIds: { next: number } = { next: -1 }) {
    this.subagentIds = subagentIds;
    this.layout = layout || createDefaultLayout();
    this.tileMap = layoutToTileMap(this.layout);
    this.seats = layoutToSeats(this.layout.furniture);
    this.restSeatUids = computeRestSeats(this.seats, this.layout.furniture);
    this.blockedTiles = getBlockedTiles(this.layout.furniture);
    this.walkableTiles = getWalkableTiles(this.tileMap, this.blockedTiles);
    this.walkableTiles = this.ctoOffice.place(this.walkableTiles);
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
    this.restSeatUids = computeRestSeats(this.seats, this.layout.furniture);
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
    this.walkableTiles = this.ctoOffice.place(this.walkableTiles);
    reseatCharactersForLayout(this);

    // A layout edit can turn a desk into a lounge seat or add new desks — move
    // any active agent still parked on a rest seat onto a freshly free desk.
    rebalanceRestSeatedAgents(this);
    this.ctoOffice.refreshQueue();

    // Relocate characters and pets an edited layout left outside its bounds (or, for
    // pets, off a walkable tile). Seated characters are fine as-is.
    relocateOutOfBoundsCharacters(this.characters, layout, (ch) =>
      this.relocateCharacterToWalkable(ch),
    );
    relocateOutOfBoundsPets(this.pets, layout, this.tileMap, this.blockedTiles, this.walkableTiles);

    // Reconcile pets against the new layout's roster
    this.rebuildPetsFromLayout(layout);
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

  /** Find the area label assigned to a seat's tile, or null. Public for e2e
   *  observability (getAgentSeats hook reads a seated agent's area). */
  seatZone(uid: string): string | null {
    return seatZone(uid, this.seats, this.layout.areaTiles, this.layout.cols);
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
      const pick = pickDiversePalette(this.characters);
      palette = pick.palette;
      hueShift = pick.hueShift;
    }

    // Preferred seat, then teammate clustering, then any free seat, then a spawn tile.
    const anchor = nearAgentId !== undefined ? this.characters.get(nearAgentId) : undefined;
    const anchorAt = anchorTile(anchor, this.seats);
    const placement = resolveNewAgentPlacement(this, preferredSeatId, anchorAt, folderName);

    let ch: Character;
    if (placement.seatId) {
      const seat = this.seats.get(placement.seatId)!;
      seat.assigned = true;
      ch = createCharacter(id, palette, placement.seatId, seat, hueShift);
    } else {
      const spawn = placement.spawn!;
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
    claimWorkSeatForActiveAgent(ch, this);
  }

  // ── Greeter ─────────────────────────────────────────────────── (see the `greeter` field)

  /** Spawn the greeter near the office's bottom-left corner. Idempotent. */
  spawnGreeter(): void {
    this.greeterCameraCancelled = false;
    this.greeter = spawnGreeter(this.greeter, this.layout, this.characters, this.walkableTiles);
  }

  /** Start the greeter's despawn effect and release the greeter camera. */
  despawnGreeter(): void {
    this.greeterCameraTarget = null;
    this.greeterCameraCancelled = false;
    despawnGreeter(this.greeter);
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
    // Free seat immediately
    if (ch.seatId) {
      const seat = this.seats.get(ch.seatId);
      if (seat) seat.assigned = false;
      rebalanceRestSeatedAgents(this, id);
    }
    releaseRestSeat(ch, this.restSeatClaims);
    this.ctoOffice.leave(id);
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
    reassignSeat(this, agentId, seatId);
  }

  /** Move a just-linked teammate to the free seat closest to its lead, so teams cluster. */
  private reseatNextToLead(teammateId: number, leadId: number): void {
    const target = reseatNextToLead(teammateId, leadId, this.characters, this.seats);
    if (target) this.reassignSeat(teammateId, target);
  }

  /** Send an agent back to their currently assigned seat */
  sendToSeat(agentId: number): void {
    sendToSeat(this, agentId);
  }

  /** Walk an agent to an arbitrary walkable tile (right-click command) */
  walkToTile(agentId: number, col: number, row: number): boolean {
    return walkToTile(this, agentId, col, row);
  }

  /** Create a sub-agent character with the parent's palette. Returns the sub-agent ID. */
  addSubagent(parentAgentId: number, parentToolId: string): number {
    return addSubagent(this, this.subagentIds, parentAgentId, parentToolId);
  }

  /** Remove a specific sub-agent character and free its seat */
  removeSubagent(parentAgentId: number, parentToolId: string): void {
    removeSubagent(this, parentAgentId, parentToolId);
  }

  /** Remove all sub-agents belonging to a parent agent */
  removeAllSubagents(parentAgentId: number): void {
    removeAllSubagents(this, parentAgentId);
  }

  /** Look up the sub-agent character ID for a given parent+toolId, or null */
  getSubagentId(parentAgentId: number, parentToolId: string): number | null {
    return this.subagentIdMap.get(subagentKey(parentAgentId, parentToolId)) ?? null;
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
        this.ctoOffice.leave(id, 'input');
        claimWorkSeatForActiveAgent(ch, this);
      }
      this.rebuildFurnitureInstances();
    }
  }

  /** Rebuild furniture instances with auto-state applied (active agents turn electronics ON) */
  private rebuildFurnitureInstances(): void {
    this.furniture = rebuildFurnitureInstances(
      this.layout.furniture,
      [...this.characters.values(), ...(this.cto ? [this.cto] : [])],
      this.seats,
      this.furnitureAnimTimer,
    );
  }

  setAgentTool(id: number, tool: string | null): void {
    setAgentTool(id, tool, this.characters);
  }

  showPermissionBubble(id: number): void {
    showPermissionBubble(id, this.characters, (i, r) => this.ctoOffice.join(i, r));
  }

  clearPermissionBubble(id: number): void {
    clearPermissionBubble(id, this.characters, (i, r) => this.ctoOffice.leave(i, r));
  }

  showWaitingBubble(id: number, awaitingInput = false): void {
    showWaitingBubble(
      id,
      awaitingInput,
      this.characters,
      (i, r) => this.ctoOffice.join(i, r),
      (i, r) => this.ctoOffice.leave(i, r),
    );
  }

  /** Dismiss bubble on click — permission: instant, waiting: quick fade */
  dismissBubble(id: number): void {
    dismissBubble(id, this.characters);
  }

  // ── Pets ──────────────────────────────────────────────────────

  /** Shallow snapshot for external consumers (renderer, hooks). */
  getPets(): Pet[] {
    return this.pets.slice();
  }

  /** Hit-test pets at an iso screen point (unscaled sprite px); id or null. */
  getPetAt(isoX: number, isoY: number): string | null {
    return getPetAt(this.pets, isoX, isoY);
  }

  /** Show the heart bubble on a pet for WAITING_BUBBLE_DURATION_SEC. */
  showPetBubble(petId: string): void {
    showPetBubble(this.pets, petId);
  }

  /** Dismiss the heart bubble on click; collapses timer to a fast fade. */
  dismissPetBubble(petId: string): void {
    dismissPetBubble(this.pets, petId);
  }

  /** Reconcile `this.pets` to match the layout's placed-pet roster. */
  private rebuildPetsFromLayout(layout: OfficeLayout): void {
    this.pets = rebuildPetsFromLayout(layout, this.pets, this.walkableTiles);
  }

  setTeamInfo(
    id: number,
    teamName?: string,
    agentName?: string,
    isTeamLead?: boolean,
    leadAgentId?: number,
    teamUsesTmux?: boolean,
  ): void {
    setTeamInfo(
      id,
      teamName,
      agentName,
      isTeamLead,
      leadAgentId,
      teamUsesTmux,
      this.characters,
      (teammateId, leadId) => this.reseatNextToLead(teammateId, leadId),
    );
  }

  setAgentContext(id: number, contextTokens: number, maxContextTokens: number): void {
    setAgentContext(id, contextTokens, maxContextTokens, this.characters);
  }

  setAgentInfo(id: number, name: string | undefined, task: string | undefined): void {
    setAgentInfo(id, name, task, this.characters);
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

    if (this.ctoOffice.update(dt)) this.rebuildFurnitureInstances();
    this.ctoOffice.rotateQueue(dt);

    const toDelete: number[] = [];
    for (const ch of this.characters.values()) {
      const effect = advanceMatrixEffect(ch, dt);
      if (effect !== 'none') {
        if (effect === 'despawned') toDelete.push(ch.id);
        continue; // skip normal FSM while the effect is (or just was) active
      }

      // Temporarily unblock own seat + reachable rest seats so the FSM can pathfind
      withPathableSeatsUnblocked(ch, this, () =>
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
  getPersistableSeats(): PersistableSeats {
    const seats: PersistableSeats = {};
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

  /** Get the character drawn at an iso screen point (unscaled sprite px); id or null. */
  getCharacterAt(isoX: number, isoY: number): number | null {
    return getCharacterAt(this.characters, isoX, isoY);
  }
}
