import { LOCAL_MACHINE_ID } from '../../../../core/src/constants.js';
import type { Floor as FloorDefinition } from '../../../../core/src/messages.js';
import { BUILDING_FLOOR_GAP_PX, BUILDING_SLAB_PX, FLOOR_SLAB_PX } from '../../constants.js';
import { isoToWorld } from '../iso.js';
import type { LocalRect } from '../projection.js';
import { boundsRect, contentBounds } from '../projection.js';
import type { Character, OfficeLayout } from '../types.js';
import { TILE_SIZE } from '../types.js';
import {
  composedToLayout,
  composeOffice,
  neededTeamModules,
  nextTeamModuleCount,
  rectOccupied,
  teamModuleOfSeat,
} from './modularOffice.js';
import type { PersistableSeats } from './officeState.js';
import { OfficeState } from './officeState.js';

/** One floor of the building: the office of one machine, with every agent that runs there. */
export interface Floor {
  readonly id: string;
  name: string;
  readonly office: OfficeState;
  /** How far this floor stands above the first, in iso px: it is drawn and hit-tested that much higher. */
  elevation: number;
  /** Active team modules, when the building composes this floor's office itself (see `enableModularOffice`). */
  teamModules: number;
}

/**
 * The office as a stack of floors, one per machine, drawn on the same iso projection at increasing heights.
 *
 * Each floor is a whole OfficeState: its own seats, lounge, CTO office and CTO queue. An agent is added to its
 * machine's floor and never leaves it, so it can only ever take a seat or a queue spot there. Floors never overlap
 * on screen: the one above starts over the top of the walls below, so every character on every floor stays visible
 * and clickable.
 *
 * What is not about one floor lives here: which character is selected, hovered and followed.
 */
export class Building {
  /** Bottom to top. The first is the machine the server runs on, and is always there. */
  floors: Floor[];
  selectedAgentId: number | null = null;
  cameraFollowId: number | null = null;
  hoveredAgentId: number | null = null;
  /** The tile under the cursor, on the selected agent's floor: where seat reassignment would put it. */
  hoveredTile: { col: number; row: number } | null = null;

  /** Shared by every floor, so a sub-agent id names one character in the whole building. */
  private readonly subagentIds = { next: -1 };
  /** The layout every floor above the first uses, once the server sent it. Unused once `enableModularOffice`
   *  switches the building over to composing every floor's layout itself from its own agent count. */
  private floorLayout: OfficeLayout | undefined;
  private areaMappings: Record<string, string[]> = {};
  /** True once the server reports no `~/.terrarium/layout.json` (`LayoutLoaded.isDefault`): every floor composes
   *  its own layout (`core/src/officeModules.ts`) from `ceil(its agents / 10)` team modules instead of using a
   *  server-sent layout verbatim. */
  private modularOffice = false;
  /** `SettingsLoaded.ctoOffice`, read before `enableModularOffice` ever composes anything. */
  private ctoOfficeEnabled = true;

  constructor(groundLayout?: OfficeLayout) {
    this.floors = [
      {
        id: LOCAL_MACHINE_ID,
        name: '',
        office: new OfficeState(groundLayout, this.subagentIds),
        elevation: 0,
        teamModules: 1,
      },
    ];
  }

  /** The first floor: this machine's office, where the greeter speaks. */
  get ground(): OfficeState {
    return this.floors[0].office;
  }

  /** Slab thickness under every floor: today's thin edge for a lone office, a building slab once there are several. */
  get slabPx(): number {
    return this.floors.length > 1 ? BUILDING_SLAB_PX : FLOOR_SLAB_PX;
  }

  /** Furnish the first floor with `groundLayout` and every other with `floorLayout`. Only used when the office is
   *  NOT composed at runtime (a custom `~/.terrarium/layout.json` exists): see `enableModularOffice`. */
  setLayouts(groundLayout: OfficeLayout, floorLayout: OfficeLayout): void {
    this.floorLayout = floorLayout;
    this.ground.rebuildFromLayout(groundLayout);
    for (const floor of this.floors.slice(1)) floor.office.rebuildFromLayout(floorLayout);
    this.restack();
  }

  /** `SettingsLoaded.ctoOffice`, read before any composition happens (it arrives before `layoutLoaded`). */
  setCtoOfficeEnabled(enabled: boolean): void {
    this.ctoOfficeEnabled = enabled;
  }

  /** Switch every floor over to composing its own layout from its own agent count (`LayoutLoaded.isDefault`:
   *  no `~/.terrarium/layout.json`). Each floor grows or shrinks that count on its own as agents join or leave
   *  it (`addAgent`/`removeAgent`). A repeated `layoutLoaded` (a reconnect, a second handshake) keeps every
   *  floor's current modules, so seated agents keep their desks. */
  enableModularOffice(): void {
    const wasModular = this.modularOffice;
    this.modularOffice = true;
    for (const floor of this.floors) {
      const needed = neededTeamModules(this.topLevelAgentCount(floor));
      floor.teamModules = wasModular ? Math.max(floor.teamModules, needed) : needed;
      this.recompose(floor);
    }
  }

  setAreaMappings(mappings: Record<string, string[]>): void {
    this.areaMappings = mappings;
    for (const floor of this.floors) floor.office.setAreaMappings(mappings);
  }

  /** Match the server's floor list, bottom to top. A floor it no longer lists goes, with every character on it. */
  setFloors(definitions: readonly FloorDefinition[]): void {
    const ground = this.floors[0];
    const upper = definitions.filter((definition) => definition.id !== ground.id);
    ground.name =
      definitions.find((definition) => definition.id === ground.id)?.name ?? ground.name;
    const kept = upper.map((definition) => {
      const floor = this.floors.find((existing) => existing.id === definition.id);
      if (!floor) return this.createFloor(definition);
      floor.name = definition.name;
      return floor;
    });
    for (const floor of this.floors.slice(1)) {
      if (!kept.includes(floor)) this.clearFocusOn(floor.office);
    }
    this.floors = [ground, ...kept];
    this.restack();
  }

  /** The floor of machine `machineId`. An agent can name a machine before its floor is announced: that floor is
   *  then built on top, named after the id until the server names it. */
  floorFor(machineId: string): Floor {
    const existing = this.floors.find((floor) => floor.id === machineId);
    if (existing) return existing;
    const floor = this.createFloor({ id: machineId, name: machineId });
    this.floors.push(floor);
    this.restack();
    return floor;
  }

  /** The floor a character (agent or sub-agent) is on. */
  floorOf(characterId: number): Floor | undefined {
    return this.floors.find((floor) => floor.office.characters.has(characterId));
  }

  officeOf(characterId: number): OfficeState | undefined {
    return this.floorOf(characterId)?.office;
  }

  getCharacter(characterId: number): Character | undefined {
    return this.officeOf(characterId)?.characters.get(characterId);
  }

  addAgent(
    machineId: string,
    id: number,
    preferredPalette?: number,
    preferredHueShift?: number,
    preferredSeatId?: string,
    skipSpawnEffect?: boolean,
    folderName?: string,
    nearAgentId?: number,
  ): void {
    if (this.floorOf(id)) return;
    const floor = this.floorFor(machineId);
    this.growIfNeeded(floor, 1, preferredSeatId);
    floor.office.addAgent(
      id,
      preferredPalette,
      preferredHueShift,
      preferredSeatId,
      skipSpawnEffect,
      folderName,
      nearAgentId,
    );
  }

  removeAgent(id: number): void {
    const floor = this.floorOf(id);
    floor?.office.removeAgent(id);
    this.clearFocus(id);
    if (floor) this.shrinkIfNeeded(floor);
  }

  /** A sub-agent spawns beside its parent, on its parent's floor. */
  addSubagent(parentAgentId: number, parentToolId: string): number {
    return (this.officeOf(parentAgentId) ?? this.ground).addSubagent(parentAgentId, parentToolId);
  }

  getSubagentId(parentAgentId: number, parentToolId: string): number | null {
    for (const floor of this.floors) {
      const id = floor.office.getSubagentId(parentAgentId, parentToolId);
      if (id !== null) return id;
    }
    return null;
  }

  /** The parent of a sub-agent character, or undefined for anything else. */
  subagentParentOf(characterId: number): number | undefined {
    return this.officeOf(characterId)?.subagentMeta.get(characterId)?.parentAgentId;
  }

  /** Sub-agent characters of `parentAgentId`, with the tool that spawned each. */
  subagentsOf(parentAgentId: number): Array<{ id: number; parentToolId: string }> {
    return this.floors.flatMap((floor) =>
      [...floor.office.subagentMeta]
        .filter(([, meta]) => meta.parentAgentId === parentAgentId)
        .map(([id, meta]) => ({ id, parentToolId: meta.parentToolId })),
    );
  }

  removeSubagent(parentAgentId: number, parentToolId: string): void {
    const id = this.getSubagentId(parentAgentId, parentToolId);
    if (id === null) return;
    this.officeOf(id)?.removeSubagent(parentAgentId, parentToolId);
    this.clearFocus(id);
  }

  removeAllSubagents(parentAgentId: number): void {
    for (const { id } of this.subagentsOf(parentAgentId)) this.clearFocus(id);
    for (const floor of this.floors) floor.office.removeAllSubagents(parentAgentId);
  }

  update(dt: number): void {
    for (const floor of this.floors) floor.office.update(dt);
  }

  /** The `saveAgentSeats` payload of every floor. Seat ids repeat across floors, which is fine: each agent's seat is
   *  looked up on its own floor. */
  getPersistableSeats(): PersistableSeats {
    return Object.assign({}, ...this.floors.map((floor) => floor.office.getPersistableSeats()));
  }

  /** The agent drawn at an iso point, upper floors first since they draw over lower ones. */
  getCharacterAt(isoX: number, isoY: number): number | null {
    for (const floor of [...this.floors].reverse()) {
      const id = floor.office.getCharacterAt(isoX, isoY + floor.elevation);
      if (id !== null) return id;
    }
    return null;
  }

  getPetAt(isoX: number, isoY: number): { office: OfficeState; petId: string } | null {
    for (const floor of [...this.floors].reverse()) {
      const petId = floor.office.getPetAt(isoX, isoY + floor.elevation);
      if (petId !== null) return { office: floor.office, petId };
    }
    return null;
  }

  /** The tile of `floor` under an iso point, or null off its grid. */
  tileAt(floor: Floor, isoX: number, isoY: number): { col: number; row: number } | null {
    const world = isoToWorld(isoX, isoY + floor.elevation);
    const col = Math.floor(world.x / TILE_SIZE);
    const row = Math.floor(world.y / TILE_SIZE);
    const { cols, rows } = floor.office.getLayout();
    if (col < 0 || col >= cols || row < 0 || row >= rows) return null;
    return { col, row };
  }

  /** What the fitted view shows: a lone office exactly as before, or every floor with its slab. */
  viewRect(): LocalRect {
    const rects = this.floors.map((floor) => {
      const rect = boundsRect(contentBounds(floor.office.getLayout()));
      return {
        minX: rect.minX,
        minY: rect.minY - floor.elevation,
        maxX: rect.maxX,
        maxY: rect.maxY - floor.elevation + (this.floors.length > 1 ? this.slabPx : 0),
      };
    });
    return {
      minX: Math.min(...rects.map((rect) => rect.minX)),
      minY: Math.min(...rects.map((rect) => rect.minY)),
      maxX: Math.max(...rects.map((rect) => rect.maxX)),
      maxY: Math.max(...rects.map((rect) => rect.maxY)),
    };
  }

  private createFloor(definition: FloorDefinition): Floor {
    const office = new OfficeState(this.initialLayoutFor(), this.subagentIds);
    office.setAreaMappings(this.areaMappings);
    return { id: definition.id, name: definition.name, office, elevation: 0, teamModules: 1 };
  }

  /** The layout a brand new floor starts with: 1 team module plus the CTO when the office composes itself,
   *  else the server-sent `floorLayout` (or none yet, furnished later by `setLayouts`). */
  private initialLayoutFor(): OfficeLayout | undefined {
    if (!this.modularOffice) return this.floorLayout;
    return composedToLayout(composeOffice({ teamModules: 1, cto: this.ctoOfficeEnabled }));
  }

  /** Attach team modules before seating an agent: enough for this floor's agents plus `joining`, and the module
   *  holding `preferredSeatId` (a restored agent's persisted desk) so that desk exists when it is claimed. */
  private growIfNeeded(floor: Floor, joining: number, preferredSeatId?: string): void {
    if (!this.modularOffice) return;
    const needed = Math.max(
      neededTeamModules(this.topLevelAgentCount(floor) + joining),
      teamModuleOfSeat(preferredSeatId),
    );
    if (needed <= floor.teamModules) return;
    floor.teamModules = needed;
    this.recompose(floor);
  }

  /** Remove the outermost team module once it is both surplus to this floor's agent count and empty. */
  private shrinkIfNeeded(floor: Floor): void {
    if (!this.modularOffice) return;
    const composed = composeOffice({ teamModules: floor.teamModules, cto: this.ctoOfficeEnabled });
    const next = nextTeamModuleCount(
      floor.teamModules,
      this.topLevelAgentCount(floor),
      (ringIndex) => {
        const area = composed.teamModuleAreas[ringIndex];
        return area !== undefined && !rectOccupied(floor.office.seats, area);
      },
    );
    if (next === floor.teamModules) return;
    floor.teamModules = next;
    this.recompose(floor);
  }

  /** Characters on `floor` that count toward its team-module quota: every agent, not its sub-agents, and not one
   *  mid-despawn — `removeAgent` starts that animation and only deletes the character once it finishes, so an
   *  immediate grow/shrink check right after would otherwise still see it. */
  private topLevelAgentCount(floor: Floor): number {
    let count = 0;
    for (const ch of floor.office.characters.values()) {
      if (ch.matrixEffect === 'despawn') continue;
      if (floor.office.subagentMeta.has(ch.id)) continue;
      count++;
    }
    return count;
  }

  private recompose(floor: Floor): void {
    const composed = composeOffice({ teamModules: floor.teamModules, cto: this.ctoOfficeEnabled });
    floor.office.rebuildFromLayout(composedToLayout(composed));
    this.restack();
  }

  /** Raise each floor so its slab clears the top of the walls of the floor below by BUILDING_FLOOR_GAP_PX. */
  private restack(): void {
    let below: { elevation: number; minY: number } | undefined;
    for (const floor of this.floors) {
      const rect = boundsRect(contentBounds(floor.office.getLayout()));
      floor.elevation = below
        ? below.elevation + rect.maxY + this.slabPx + BUILDING_FLOOR_GAP_PX - below.minY
        : 0;
      below = { elevation: floor.elevation, minY: rect.minY };
    }
  }

  private clearFocus(characterId: number): void {
    if (this.selectedAgentId === characterId) this.selectedAgentId = null;
    if (this.cameraFollowId === characterId) this.cameraFollowId = null;
    if (this.hoveredAgentId === characterId) this.hoveredAgentId = null;
  }

  private clearFocusOn(office: OfficeState): void {
    for (const id of office.characters.keys()) this.clearFocus(id);
  }
}
