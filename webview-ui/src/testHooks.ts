import type { ColorValue } from './components/ui/types.js';
import type { Building } from './office/engine/building.js';
import type { SortBox } from './office/engine/isoSort.js';
import { isoDrawOrder } from './office/engine/isoSort.js';
import { OfficeState } from './office/engine/officeState.js';
import {
  ART_SPRITE_SCALE,
  characterSortBox,
  characterSpritePlacement,
} from './office/engine/sceneRenderer.js';
import { getCatalogEntry } from './office/layout/furnitureCatalog.js';
import { carpetJunctionCase } from './office/sprites/carpetTiles.js';
import type { SpriteData } from './office/types.js';
import { CharacterState } from './office/types.js';

/** How one seated character sits in its seat, as drawn: who is on top, how
 *  much of the seat and of the character the other leaves visible (opaque
 *  pixels, 0 to 1), and the screen rows of the character's feet and the
 *  seat's top and bottom (iso local px, y grows downward). */
export interface SeatFit {
  id: number;
  isCto: boolean;
  seatType: string;
  facesAway: boolean;
  characterOnTop: boolean;
  seatShown: number;
  characterShown: number;
  feetY: number;
  seatTopY: number;
  seatBottomY: number;
}

const OPAQUE_ALPHA = 0x80;

function isOpaque(color: string | undefined): boolean {
  if (!color) return false;
  return color.length !== 9 || parseInt(color.slice(7, 9), 16) >= OPAQUE_ALPHA;
}

/** A sprite drawn with its top-left at (x, y), `ART_SPRITE_SCALE` iso px per
 *  art px, optionally flipped in place the way the renderer flips it. */
interface DrawnSprite {
  sprite: SpriteData;
  x: number;
  y: number;
  mirrored: boolean;
}

function opaqueAt(drawn: DrawnSprite, px: number, py: number): boolean {
  const row = Math.floor((py - drawn.y) / ART_SPRITE_SCALE);
  const col = Math.floor((px - drawn.x) / ART_SPRITE_SCALE);
  const width = drawn.sprite[0]?.length ?? 0;
  if (row < 0 || row >= drawn.sprite.length || col < 0 || col >= width) return false;
  return isOpaque(drawn.sprite[row][drawn.mirrored ? width - 1 - col : col]);
}

/** Share of `back`'s opaque pixels that `front`, drawn over it, leaves
 *  visible. */
function shownShare(back: DrawnSprite, front: DrawnSprite): number {
  let opaque = 0;
  let shown = 0;
  back.sprite.forEach((line, row) => {
    line.forEach((_, col) => {
      const px = back.x + (col + 0.5) * ART_SPRITE_SCALE;
      const py = back.y + (row + 0.5) * ART_SPRITE_SCALE;
      if (!opaqueAt(back, px, py)) return;
      opaque++;
      if (!opaqueAt(front, px, py)) shown++;
    });
  });
  return opaque === 0 ? 1 : shown / opaque;
}

function opaqueRows(drawn: DrawnSprite): { top: number; bottom: number } {
  const rows = drawn.sprite
    .map((line, row) => (line.some(isOpaque) ? row : -1))
    .filter((row) => row >= 0);
  return {
    top: drawn.y + rows[0] * ART_SPRITE_SCALE,
    bottom: drawn.y + (rows[rows.length - 1] + 1) * ART_SPRITE_SCALE,
  };
}

function seatFitsOf(office: OfficeState): SeatFit[] {
  const fits: SeatFit[] = [];
  const layoutFurniture = office.getLayout().furniture;
  for (const ch of office.getCharacters()) {
    if (ch.state !== CharacterState.TYPE) continue;
    const seat = [...office.seats.values()].find(
      (s) => s.seatCol === ch.tileCol && s.seatRow === ch.tileRow,
    );
    if (!seat) continue;
    const furnitureUid = seat.uid.split(':')[0];
    const instance = office.furniture.find((f) => f.uid === furnitureUid);
    const placed = layoutFurniture.find((f) => f.uid === furnitureUid);
    if (!instance || !placed) continue;
    const orientation = getCatalogEntry(placed.type)?.orientation;
    const seatDrawn: DrawnSprite = {
      sprite: instance.sprite,
      x: instance.x,
      y: instance.y,
      mirrored: !!instance.mirrored,
    };
    const placement = characterSpritePlacement(ch, office.sittingOffset(ch));
    const characterDrawn: DrawnSprite = { ...placement, mirrored: false };
    const [first] = isoDrawOrder([
      instance.sort,
      characterSortBox(ch, placement.x, placement.sprite),
    ]);
    const characterOnTop = first === 0;
    const seatRows = opaqueRows(seatDrawn);
    fits.push({
      id: ch.id,
      isCto: !!ch.isCto,
      seatType: placed.type,
      facesAway: orientation === 'back' || orientation === 'left',
      characterOnTop,
      seatShown: characterOnTop ? shownShare(seatDrawn, characterDrawn) : 1,
      characterShown: characterOnTop ? 1 : shownShare(characterDrawn, seatDrawn),
      feetY: opaqueRows(characterDrawn).bottom,
      seatTopY: seatRows.top,
      seatBottomY: seatRows.bottom,
    });
  }
  return fits;
}

/** A pair of drawn things whose opaque pixels overlap and whose draw order
 *  contradicts where their footprints stand. */
export interface DrawOrderViolation {
  front: string;
  behind: string;
}

interface Drawn extends DrawnSprite {
  name: string;
  box: SortBox;
}

function opaqueOverlap(a: DrawnSprite, b: DrawnSprite): boolean {
  const aw = (a.sprite[0]?.length ?? 0) * ART_SPRITE_SCALE;
  const bw = (b.sprite[0]?.length ?? 0) * ART_SPRITE_SCALE;
  const ah = a.sprite.length * ART_SPRITE_SCALE;
  const bh = b.sprite.length * ART_SPRITE_SCALE;
  if (a.x >= b.x + bw || b.x >= a.x + aw || a.y >= b.y + bh || b.y >= a.y + ah) return false;
  for (let row = 0; row < a.sprite.length; row++) {
    for (let col = 0; col < (a.sprite[row]?.length ?? 0); col++) {
      const px = a.x + (col + 0.5) * ART_SPRITE_SCALE;
      const py = a.y + (row + 0.5) * ART_SPRITE_SCALE;
      if (opaqueAt(a, px, py) && opaqueAt(b, px, py)) return true;
    }
  }
  return false;
}

/** Which of two footprints stands in front, from the grid alone: 1 when `a`
 *  is in front, -1 when `b` is, 0 when they share floor (then the layer rule
 *  decides, which the seat checks cover). Side by side, separated along one
 *  axis each way, the one whose front corner is nearer the viewer is. */
function standsInFront(a: SortBox, b: SortBox): number {
  const aBehind = a.maxCol <= b.minCol || a.maxRow <= b.minRow;
  const bBehind = b.maxCol <= a.minCol || b.maxRow <= a.minRow;
  if (aBehind && bBehind) return a.maxCol + a.maxRow > b.maxCol + b.maxRow ? 1 : -1;
  if (aBehind) return -1;
  if (bBehind) return 1;
  return 0;
}

/** Every character against every piece of furniture and every other
 *  character on one floor, drawn the way the renderer draws them: each pair
 *  whose opaque pixels overlap must be drawn in the order their footprints
 *  stand. */
function drawOrderViolationsOf(office: OfficeState): DrawOrderViolation[] {
  const drawn: Drawn[] = office.furniture.map((f) => ({
    name: f.uid ?? 'furniture',
    box: f.sort,
    sprite: f.sprite,
    x: f.x,
    y: f.y,
    mirrored: !!f.mirrored,
  }));
  const characterStart = drawn.length;
  for (const ch of office.getCharacters()) {
    if (ch.matrixEffect) continue;
    const placement = characterSpritePlacement(ch, office.sittingOffset(ch));
    drawn.push({
      name: ch.isCto ? 'cto' : `agent ${ch.id}`,
      box: characterSortBox(ch, placement.x, placement.sprite),
      ...placement,
      mirrored: false,
    });
  }
  const order = isoDrawOrder(drawn.map((d) => d.box));
  const position = new Array<number>(drawn.length);
  order.forEach((index, at) => (position[index] = at));
  const violations: DrawOrderViolation[] = [];
  for (let i = characterStart; i < drawn.length; i++) {
    for (let j = 0; j < drawn.length; j++) {
      if (j === i || (j >= characterStart && j < i)) continue;
      const inFront = standsInFront(drawn[i].box, drawn[j].box);
      if (inFront === 0 || !opaqueOverlap(drawn[i], drawn[j])) continue;
      const [front, behind] = inFront > 0 ? [i, j] : [j, i];
      if (position[front] < position[behind]) {
        violations.push({ front: drawn[front].name, behind: drawn[behind].name });
      }
    }
  }
  return violations;
}

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
      /** Every character sitting in a seat on one floor, the CTO included. */
      getSeatFits?: (floorId: string) => SeatFit[];
      /** Overlapping character/furniture and character/character pairs on one
       *  floor drawn against where their footprints stand. */
      getDrawOrderViolations?: (floorId: string) => DrawOrderViolation[];
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

  hooks.getSeatFits = (floorId) => {
    const office = buildingRef.current?.floors.find((floor) => floor.id === floorId)?.office;
    return office ? seatFitsOf(office) : [];
  };

  hooks.getDrawOrderViolations = (floorId) => {
    const office = buildingRef.current?.floors.find((floor) => floor.id === floorId)?.office;
    return office ? drawOrderViolationsOf(office) : [];
  };

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
