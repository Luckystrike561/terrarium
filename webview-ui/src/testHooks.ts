import type { ColorValue } from './components/ui/types.js';
import type { Building } from './office/engine/building.js';
import { OfficeState } from './office/engine/officeState.js';
import { carpetJunctionCase } from './office/sprites/carpetTiles.js';

declare global {
  interface Window {
    __terrariumTestHooks?: {
      playedSounds?: Array<{ kind: string; at: number }>;
      getCharacters?: () => Array<{
        id: number;
        matrixEffect: 'spawn' | 'despawn' | null;
        agentName?: string;
        bubbleType: 'permission' | 'waiting' | null;
        waitingAwaitingInput?: boolean;
        isGreeter?: boolean;
      }>;
      // ── Carpet + Areas observability ──
      /** Sparse list of painted carpet tiles with their grid coords. */
      getCarpetTiles?: () => Array<{
        col: number;
        row: number;
        variant: number;
        color?: ColorValue;
        accentColor?: ColorValue;
        order?: number;
      }>;
      /** 4-bit marching-squares case for a junction (NW=1,NE=2,SE=4,SW=8) via the
       *  real renderer logic — for asserting carpet autotiling. */
      getCarpetJunctionCase?: (jx: number, jy: number, variant: number) => number;
      /** Area definitions in the current layout. */
      getAreas?: () => Array<{ label: string; color: string }>;
      /** Sparse list of area-painted tiles with their grid coords. */
      getAreaTiles?: () => Array<{ col: number; row: number; label: string }>;
      /** Count of placed furniture instances — lets a spec assert furniture
       *  placed onto a carpet tile (surface placement) without it being blocked. */
      getFurnitureCount?: () => number;
      /** Seated top-level agents with the area their seat falls in (or null). */
      getAgentSeats?: () => Array<{
        id: number;
        seatId: string | null;
        areaLabel: string | null;
        folderName?: string;
        /** The floor (machine) the agent's seat is on. */
        machineId: string;
      }>;
      /** All seats with grid coords + the area their tile falls in, so a spec
       *  can find seats inside a seeded Area without hardcoding coordinates. */
      getSeats?: () => Array<{
        uid: string;
        col: number;
        row: number;
        areaLabel: string | null;
        assigned: boolean;
      }>;
      getPets?: () => Array<{
        id: string;
        name: string;
        petType: number;
        state: 'idle' | 'walk' | 'follow';
        x: number;
        y: number;
        bubbleType: 'heart' | null;
      }>;
      petClick?: (petId: string) => void;
      addAgentLog?: Array<{
        id: number;
        skipSpawnEffect: boolean | undefined;
        matrixEffectAtCreation: 'spawn' | 'despawn' | null;
      }>;
      messageLog?: Array<{
        at: number;
        type: string;
        id?: number;
        toolName?: string;
        status?: string;
        toolId?: string;
        parentToolId?: string;
      }>;
      selectAgent?: (id: number) => void;
      /** The floors bottom to top, with the agents (not sub-agents) on each and its height. */
      getFloors?: () => Array<{ id: string; name: string; elevation: number; agentIds: number[] }>;
      /** The CTO queue of one floor: who waits there, by reason, in arrival order. */
      getCtoQueue?: (floorId: string) => Array<{ id: number; reason: string }>;
    };
  }
}

/**
 * Install e2e test observables on window.__terrariumTestHooks. Mostly
 * read-only / append-only; the one action (selectAgent) only sets selection
 * state and changes no production logic. Called once at module-load from
 * App.tsx with the singleton buildingRef. Floor-specific reads (pets, seats,
 * layout) describe the first floor.
 *
 * - getCharacters(): point-in-time snapshot of every character's matrix, team, and bubble state.
 * - addAgentLog: append-only history of every OfficeState.addAgent call. The
 *   log captures matrixEffect AT addAgent time (synchronously inside the
 *   wrapper), eliminating the ~300ms matrix-effect lifetime race that would
 *   let a regression slip past a snapshot-based check.
 * - playedSounds: populated separately by notificationSound.ts (same namespace,
 *   different owner).
 * - selectAgent(id): sets officeState.selectedAgentId directly, the same state
 *   a canvas click produces. Lets e2e reveal an agent's "Close agent" (×)
 *   button deterministically instead of pixel-hunting the sprite on the canvas
 *   (see closeAgentFromOverlay in e2e/helpers/office.ts). ToolOverlay reads
 *   selectedAgentId every rAF, so the × button surfaces on the next frame.
 */
export function installTestHooks(buildingRef: { current: Building | null }): void {
  if (typeof window === 'undefined') return;
  if (!window.__terrariumTestHooks) window.__terrariumTestHooks = {};
  const hooks = window.__terrariumTestHooks;
  if (!hooks.addAgentLog) hooks.addAgentLog = [];

  hooks.getCharacters = () => {
    const building = buildingRef.current;
    if (!building) return [];
    // getCharacters(), not `characters`: e2e asserts on the consent greeter,
    // which lives outside the agent map and joins only at the render seam.
    return building.floors
      .flatMap((floor) => floor.office.getCharacters())
      .map((ch) => ({
        id: ch.id,
        matrixEffect: ch.matrixEffect,
        agentName: ch.agentName,
        bubbleType: ch.bubbleType,
        waitingAwaitingInput: ch.waitingAwaitingInput,
        isGreeter: ch.isGreeter,
      }));
  };

  hooks.selectAgent = (id) => {
    const building = buildingRef.current;
    if (building) building.selectedAgentId = id;
  };

  hooks.getFloors = () =>
    (buildingRef.current?.floors ?? []).map((floor) => ({
      id: floor.id,
      name: floor.name,
      elevation: floor.elevation,
      agentIds: [...floor.office.characters.values()]
        .filter((ch) => !ch.isSubagent && ch.matrixEffect !== 'despawn')
        .map((ch) => ch.id),
    }));

  hooks.getCtoQueue = (floorId) =>
    [
      ...(buildingRef.current?.floors
        .find((floor) => floor.id === floorId)
        ?.office.characters.values() ?? []),
    ]
      .filter((ch) => ch.ctoQueueSlot)
      .map((ch) => ({ id: ch.id, reason: ch.ctoQueueSlot!.reason }));

  // Point-in-time snapshot of every live pet. Pets render only on the canvas
  // (no DOM) and the heart bubble is never persisted, so e2e reads pet state
  // through here — the same rationale as getCharacters() above.
  hooks.getPets = () => {
    const os = buildingRef.current?.ground;
    if (!os) return [];
    return os.pets.map((pet) => ({
      id: pet.id,
      name: pet.name,
      petType: pet.petType,
      state: pet.state,
      x: pet.x,
      y: pet.y,
      bubbleType: pet.bubbleType,
    }));
  };

  // Drive the same state a canvas click on a pet produces (toggle the heart
  // bubble). Mirrors OfficeCanvas's pet-hit branch but takes a known petId
  // instead of a hit-test result, so tests don't pixel-hunt the randomly
  // spawned sprite — the same tradeoff selectAgent makes for characters.
  hooks.petClick = (petId) => {
    const os = buildingRef.current?.ground;
    if (!os) return;
    const pet = os.pets.find((p) => p.id === petId);
    if (!pet) return;
    if (pet.bubbleType) {
      os.dismissPetBubble(petId);
    } else {
      os.showPetBubble(petId);
    }
  };

  // ── Carpet + Areas read hooks (canvas-only state, read like getPets) ──
  hooks.getCarpetTiles = () => {
    const os = buildingRef.current?.ground;
    if (!os) return [];
    const layout = os.getLayout();
    const tiles = layout.carpetTiles;
    if (!tiles) return [];
    const out: Array<{
      col: number;
      row: number;
      variant: number;
      color?: ColorValue;
      accentColor?: ColorValue;
      order?: number;
    }> = [];
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      if (!t) continue;
      out.push({
        col: i % layout.cols,
        row: Math.floor(i / layout.cols),
        variant: t.variant,
        color: t.color,
        accentColor: t.accentColor,
        order: t.order,
      });
    }
    return out;
  };

  hooks.getCarpetJunctionCase = (jx, jy, variant) => {
    const os = buildingRef.current?.ground;
    if (!os) return 0;
    const layout = os.getLayout();
    return carpetJunctionCase(jx, jy, variant, layout.carpetTiles ?? [], layout.cols, layout.rows);
  };

  hooks.getAreas = () => {
    const os = buildingRef.current?.ground;
    if (!os) return [];
    return (os.getLayout().areas ?? []).map((a) => ({ label: a.label, color: a.color }));
  };

  hooks.getAreaTiles = () => {
    const os = buildingRef.current?.ground;
    if (!os) return [];
    const layout = os.getLayout();
    const tiles = layout.areaTiles;
    if (!tiles) return [];
    const out: Array<{ col: number; row: number; label: string }> = [];
    for (let i = 0; i < tiles.length; i++) {
      const label = tiles[i];
      if (!label) continue;
      out.push({ col: i % layout.cols, row: Math.floor(i / layout.cols), label });
    }
    return out;
  };

  hooks.getFurnitureCount = () => {
    const os = buildingRef.current?.ground;
    if (!os) return 0;
    return os.furniture.length;
  };

  hooks.getAgentSeats = () =>
    (buildingRef.current?.floors ?? []).flatMap(({ id: machineId, office }) =>
      Array.from(office.characters.values())
        .filter((ch) => !ch.isSubagent)
        .map((ch) => ({
          id: ch.id,
          seatId: ch.seatId,
          areaLabel: ch.seatId ? office.seatZone(ch.seatId) : null,
          folderName: ch.folderName,
          machineId,
        })),
    );

  hooks.getSeats = () => {
    const os = buildingRef.current?.ground;
    if (!os) return [];
    return Array.from(os.seats.entries()).map(([uid, seat]) => ({
      uid,
      col: seat.seatCol,
      row: seat.seatRow,
      areaLabel: os.seatZone(uid),
      assigned: seat.assigned,
    }));
  };

  const origAddAgent = OfficeState.prototype.addAgent;
  OfficeState.prototype.addAgent = function (
    id,
    preferredPalette,
    preferredHueShift,
    preferredSeatId,
    skipSpawnEffect,
    folderName,
    nearAgentId,
  ) {
    origAddAgent.call(
      this,
      id,
      preferredPalette,
      preferredHueShift,
      preferredSeatId,
      skipSpawnEffect,
      folderName,
      nearAgentId,
    );
    const ch = this.characters.get(id);
    hooks.addAgentLog?.push({
      id,
      skipSpawnEffect,
      matrixEffectAtCreation: ch?.matrixEffect ?? null,
    });
  };
}
