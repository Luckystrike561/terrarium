/**
 * Office modules: fixed-size room templates tiled on a lattice and composed
 * into one layout grid. Pure data and pure functions (no node `fs`), so
 * `scripts/iso-art/layout.ts` and the webview can both import it directly.
 *
 * Every module is `MODULE_SIZE` square, so any two line up edge to edge on
 * any side with no overhang. Each template reserves a 1-tile margin on all
 * four sides (local index 0 and `MODULE_SIZE - 1`) for the wall line the
 * composer may draw there; furniture never sits on that margin.
 */

const WALL = 0;
const VOID_TILE = 255;
/** Numeric encoding matching `office/types.ts`'s `Direction.UP`: core has no
 *  webview dependency, so the composer emits the same plain number instead
 *  of importing the enum. */
const DIRECTION_UP = 3;

export const MODULE_SIZE = 12;
/** Local index range of the 2-wide door gap cut into a drawn wall, centered
 *  on a MODULE_SIZE-12 side. */
const DOOR_LO = 5;
const DOOR_HI = 6;

export interface ModuleColor {
  h: number;
  s: number;
  b: number;
  c: number;
}

/** Light blue-grey wallpaper, the office's default wall colour, independent
 *  of the floor tiles' colour so it stays legible whichever material a
 *  module's floor uses. */
const WALL_COLOR: ModuleColor = { h: 220, s: 30, b: 46, c: 0 };

interface FloorFill {
  c0: number;
  r0: number;
  c1: number;
  r1: number;
  tile: number;
  color: ModuleColor;
}

interface CarpetFill {
  c0: number;
  r0: number;
  c1: number;
  r1: number;
  color: ModuleColor;
  accentColor: ModuleColor;
}

interface ModuleFurniturePlacement {
  type: string;
  col: number;
  row: number;
}

/** A wall-mounted decoration, positioned along a back wall's run by a single
 *  local offset: the column for a north wall (local row 0), the row for a
 *  west wall (local col 0). Only drawn when the composer actually draws that
 *  wall for a given module instance (it depends on what, if anything, sits
 *  beyond that side in the final composition, not on the template alone). */
interface WallDecorItem {
  type: string;
  offset: number;
}

export interface ModuleTemplate {
  floors: readonly FloorFill[];
  carpets?: readonly CarpetFill[];
  furniture: readonly ModuleFurniturePlacement[];
  /** `_FRONT` items for the north wall (local row 0, runs along cols) and
   *  `_RIGHT` items (front mirrored) for the west wall (local col 0, runs
   *  along rows), each at least 2 tiles apart and clear of the door gap and
   *  the window columns/rows. */
  wallDecor: { north: readonly WallDecorItem[]; west: readonly WallDecorItem[] };
}

const PALE_TILE = 2;
const PLANKS = 5;
const CHECKER_COARSE = 9;

const SKY_TILE: ModuleColor = { h: -8, s: 4, b: 0, c: 0 };
const HONEY_WOOD: ModuleColor = { h: 0, s: 0, b: 0, c: 0 };
const SUNSHINE_CHECKER: ModuleColor = { h: 10, s: 6, b: 3, c: 0 };

const BREAK_RUG: CarpetFill = {
  c0: 1,
  r0: 8,
  c1: 2,
  r1: 9,
  color: { h: 175, s: 42, b: -4, c: 0 },
  accentColor: { h: 42, s: 48, b: 26, c: 0 },
};
const CTO_RUG: CarpetFill = {
  c0: 3,
  r0: 1,
  c1: 7,
  r1: 4,
  color: { h: 42, s: 65, b: 6, c: 0 },
  accentColor: { h: 24, s: 48, b: -18, c: 0 },
};

/** One back-to-back desk pod: 2 desks, 2 PCs each, 4 chairs, 4 seats. */
function deskPod(c0: number, r0: number): ModuleFurniturePlacement[] {
  return [
    { type: 'CUSHIONED_CHAIR_FRONT', col: c0, row: r0 },
    { type: 'CUSHIONED_CHAIR_FRONT', col: c0 + 1, row: r0 },
    { type: 'DESK_BACK', col: c0, row: r0 + 1 },
    { type: 'PC_BACK_OFF', col: c0, row: r0 + 1 },
    { type: 'PC_BACK_OFF', col: c0 + 1, row: r0 + 1 },
    { type: 'DESK_FRONT', col: c0, row: r0 + 2 },
    { type: 'PC_FRONT_OFF', col: c0, row: r0 + 2 },
    { type: 'PC_FRONT_OFF', col: c0 + 1, row: r0 + 2 },
    { type: 'CUSHIONED_CHAIR_BACK', col: c0, row: r0 + 3 },
    { type: 'CUSHIONED_CHAIR_BACK', col: c0 + 1, row: r0 + 3 },
  ];
}

/** Half a pod, front-facing only: 1 desk, 2 PCs, 2 chairs, 2 seats. */
function deskPair(c0: number, r0: number): ModuleFurniturePlacement[] {
  return [
    { type: 'CUSHIONED_CHAIR_FRONT', col: c0, row: r0 },
    { type: 'CUSHIONED_CHAIR_FRONT', col: c0 + 1, row: r0 },
    { type: 'DESK_FRONT', col: c0, row: r0 + 1 },
    { type: 'PC_FRONT_OFF', col: c0, row: r0 + 1 },
    { type: 'PC_FRONT_OFF', col: c0 + 1, row: r0 + 1 },
  ];
}

/** An open-plan floor of 10 desk seats (two 4-seat pods, one 2-seat pair)
 *  plus an attached break room on its own floor material: a sofa and coffee
 *  table, a kitchen counter with the coffee machine, a fridge, a bistro
 *  table and chairs, plants. */
export const TEAM_MODULE: ModuleTemplate = {
  floors: [
    { c0: 0, r0: 0, c1: 11, r1: 6, tile: PALE_TILE, color: SKY_TILE },
    { c0: 0, r0: 7, c1: 11, r1: 11, tile: CHECKER_COARSE, color: SUNSHINE_CHECKER },
  ],
  carpets: [BREAK_RUG],
  furniture: [
    ...deskPod(1, 1),
    ...deskPod(4, 1),
    ...deskPair(7, 1),
    { type: 'LARGE_PLANT', col: 10, row: 1 },
    { type: 'LARGE_PLANT', col: 10, row: 4 },
    { type: 'PLANT', col: 7, row: 4 },
    { type: 'BIN', col: 1, row: 6 },
    { type: 'FLOOR_LAMP', col: 10, row: 6 },
    { type: 'SOFA_FRONT', col: 1, row: 8 },
    { type: 'COFFEE_TABLE_FRONT', col: 1, row: 9 },
    { type: 'KITCHEN_COUNTER_FRONT', col: 4, row: 8 },
    { type: 'COFFEE_MACHINE_ON_1', col: 4, row: 8 },
    { type: 'FRIDGE_FRONT', col: 6, row: 8 },
    { type: 'SMALL_TABLE', col: 8, row: 9 },
    { type: 'WOODEN_CHAIR_RIGHT', col: 7, row: 9 },
    { type: 'WOODEN_CHAIR_LEFT', col: 9, row: 9 },
    { type: 'LARGE_PLANT', col: 9, row: 8 },
    { type: 'PLANT', col: 1, row: 10 },
  ],
  wallDecor: {
    north: [
      { type: 'WALL_SHELF_FRONT', offset: 2 },
      { type: 'CLOCK_FRONT', offset: 9 },
    ],
    west: [
      { type: 'SMALL_PAINTING_RIGHT', offset: 2 },
      { type: 'HANGING_PLANT_RIGHT', offset: 9 },
    ],
  },
};

/** A square executive office: a desk and chair facing the entrance, two
 *  visitor chairs, a couch and coffee table, plants, on a wood floor. */
export const CTO_MODULE: ModuleTemplate = {
  floors: [{ c0: 0, r0: 0, c1: 11, r1: 11, tile: PLANKS, color: HONEY_WOOD }],
  carpets: [CTO_RUG],
  furniture: [
    { type: 'EXEC_DESK_BACK', col: 4, row: 2 },
    { type: 'EXEC_CHAIR_FRONT', col: 5, row: 1 },
    { type: 'PC_BACK_OFF', col: 6, row: 3 },
    { type: 'COFFEE', col: 4, row: 2 },
    { type: 'WOODEN_CHAIR_BACK', col: 4, row: 4 },
    { type: 'WOODEN_CHAIR_BACK', col: 6, row: 4 },
    { type: 'SOFA_RIGHT', col: 9, row: 1 },
    { type: 'COFFEE_TABLE_RIGHT', col: 10, row: 1 },
    { type: 'LARGE_PLANT', col: 1, row: 1 },
    { type: 'LARGE_PLANT', col: 10, row: 4 },
    { type: 'PLANT', col: 1, row: 9 },
    { type: 'PLANT', col: 9, row: 9 },
    { type: 'FLOOR_LAMP', col: 1, row: 5 },
    { type: 'BIN', col: 1, row: 8 },
  ],
  wallDecor: {
    // CTO_SIGN must stay on the wall whose decor takes `_FRONT`: a `_RIGHT`
    // (mirrored) sign would read backwards.
    north: [
      { type: 'CTO_SIGN_FRONT', offset: 2 },
      { type: 'CLOCK_FRONT', offset: 9 },
    ],
    west: [
      { type: 'WALL_SHELF_RIGHT', offset: 2 },
      { type: 'SMALL_PAINTING_RIGHT', offset: 9 },
    ],
  },
};

export interface ComposeOfficeOptions {
  /** Number of team modules. Includes the centre module when `cto` is false. */
  teamModules: number;
  /** Centre the CTO's office; team modules ring around it. Default true. */
  cto?: boolean;
}

/** An inclusive tile rectangle in the composed grid. */
export interface TileRect {
  c0: number;
  r0: number;
  c1: number;
  r1: number;
}

/** The CTO module's own tile rectangle (inclusive) and a queue anchor just
 *  outside it, facing the office: `ctoOffice.ts` bounds the office and
 *  seats the door queue from this instead of a wall-doorway search, since a
 *  composed office no longer walls a CTO-to-team or team-to-team join. */
export interface CtoOfficeArea extends TileRect {
  queueCol: number;
  queueRow: number;
  queueFacing: number;
}

export interface ComposedOfficeLayout {
  cols: number;
  rows: number;
  tiles: number[];
  tileColors: (ModuleColor | null)[];
  carpetTiles: ({ variant: number; color: ModuleColor; accentColor: ModuleColor } | null)[];
  furniture: { uid: string; type: string; col: number; row: number }[];
  ctoOfficeArea?: CtoOfficeArea;
  /** Each team module's own tile rectangle, in ring order (the order
   *  `teamModules` grew them in): runtime growth uses this to tell whether
   *  the outermost module is empty before shrinking it away. */
  teamModuleAreas: TileRect[];
}

interface PlacedModule {
  gc: number;
  gr: number;
  template: ModuleTemplate;
  /** Stable furniture-uid prefix: `cto`, or `team1`, `team2`, ... in the
   *  order each was added, independent of how many more are added or
   *  removed later — runtime growth's seat ids stay put across a resize. */
  key: string;
}

/** The 4 cardinal lattice neighbours of the centre, nearest first (the first
 *  is always the "first team module" `ctoOfficeArea`'s queue anchor faces),
 *  then the diagonal corners, then each cardinal direction doubled, tripled,
 *  and so on outward. Only the first 4 are exercised today (one ring around
 *  a single centre module); the rest keeps `composeOffice` total for
 *  whatever team count runtime growth asks for later. */
function ringOffset(index: number): { dc: number; dr: number } {
  const CARDINALS = [
    { dc: 0, dr: 1 },
    { dc: 1, dr: 0 },
    { dc: -1, dr: 0 },
    { dc: 0, dr: -1 },
  ] as const;
  if (index < CARDINALS.length) return CARDINALS[index];
  const CORNERS = [
    { dc: 1, dr: 1 },
    { dc: -1, dr: 1 },
    { dc: 1, dr: -1 },
    { dc: -1, dr: -1 },
  ] as const;
  const cornerIndex = index - CARDINALS.length;
  if (cornerIndex < CORNERS.length) return CORNERS[cornerIndex];
  const outerIndex = cornerIndex - CORNERS.length;
  const tier = 2 + Math.floor(outerIndex / CARDINALS.length);
  const base = CARDINALS[outerIndex % CARDINALS.length];
  return { dc: base.dc * tier, dr: base.dr * tier };
}

function fillFloor(
  tiles: number[],
  tileColors: (ModuleColor | null)[],
  cols: number,
  originC: number,
  originR: number,
  fill: FloorFill,
): void {
  for (let r = originR + fill.r0; r <= originR + fill.r1; r++) {
    for (let c = originC + fill.c0; c <= originC + fill.c1; c++) {
      tiles[r * cols + c] = fill.tile;
      tileColors[r * cols + c] = fill.color;
    }
  }
}

/** A module's back walls (its local -row "north" and -col "west" edges) are
 *  the building's shell: solid where nothing is beyond them. Every other
 *  side — including a CTO-to-team or team-to-team join — stays fully open
 *  floor now: only the exterior shell gets a wall at all. */
function hasBackWall(
  m: PlacedModule,
  axis: 'north' | 'west',
  lattice: ReadonlyMap<string, PlacedModule>,
): boolean {
  const key = axis === 'north' ? `${m.gc},${m.gr - 1}` : `${m.gc - 1},${m.gr}`;
  return !lattice.has(key);
}

function drawBackWall(
  tiles: number[],
  tileColors: (ModuleColor | null)[],
  cols: number,
  originC: number,
  originR: number,
  axis: 'north' | 'west',
): void {
  for (let i = 0; i < MODULE_SIZE; i++) {
    if (i >= DOOR_LO && i <= DOOR_HI) continue;
    const col = axis === 'north' ? originC + i : originC;
    const row = axis === 'north' ? originR : originR + i;
    tiles[row * cols + col] = WALL;
    tileColors[row * cols + col] = WALL_COLOR;
  }
}

/** Compose team and CTO modules on the lattice into one layout grid. Centre:
 *  the CTO module when `cto` is enabled, else the first team module. The
 *  rest of the team modules ring around the centre, nearest cardinal
 *  neighbour first. */
export function composeOffice(opts: ComposeOfficeOptions): ComposedOfficeLayout {
  const cto = opts.cto ?? true;
  const teamCount = Math.max(0, Math.floor(opts.teamModules));
  if (!cto && teamCount < 1) {
    throw new Error('composeOffice: at least one team module is required when cto is disabled');
  }

  const placed: PlacedModule[] = [];
  placed.push({
    gc: 0,
    gr: 0,
    template: cto ? CTO_MODULE : TEAM_MODULE,
    key: cto ? 'cto' : 'team1',
  });
  const ringCount = cto ? teamCount : teamCount - 1;
  for (let i = 0; i < ringCount; i++) {
    const { dc, dr } = ringOffset(i);
    const teamNumber = cto ? i + 1 : i + 2;
    placed.push({ gc: dc, gr: dr, template: TEAM_MODULE, key: `team${teamNumber}` });
  }

  const lattice = new Map<string, PlacedModule>();
  for (const m of placed) lattice.set(`${m.gc},${m.gr}`, m);

  // The lattice always reserves the full ring (centre + its 4 cardinal and 4
  // diagonal neighbours, up to 8 team modules), regardless of how many are
  // actually placed: every module's absolute tile origin then stays fixed as
  // `teamModules` grows or shrinks within that ring, so runtime growth never
  // has to shift an already-seated character's tile or a persisted seat id.
  // Only the 9th+ team module (ring tier 2) still moves the origin.
  const RING1_SPAN = 1;
  const minGC = Math.min(-RING1_SPAN, ...placed.map((m) => m.gc));
  const maxGC = Math.max(RING1_SPAN, ...placed.map((m) => m.gc));
  const minGR = Math.min(-RING1_SPAN, ...placed.map((m) => m.gr));
  const maxGR = Math.max(RING1_SPAN, ...placed.map((m) => m.gr));

  const cols = (maxGC - minGC + 1) * MODULE_SIZE;
  const rows = (maxGR - minGR + 1) * MODULE_SIZE;

  const tiles = new Array<number>(cols * rows).fill(VOID_TILE);
  const tileColors = new Array<ModuleColor | null>(cols * rows).fill(null);
  const carpetTiles = new Array<{
    variant: number;
    color: ModuleColor;
    accentColor: ModuleColor;
  } | null>(cols * rows).fill(null);
  const furniture: { uid: string; type: string; col: number; row: number }[] = [];
  const teamModuleAreas: TileRect[] = [];

  for (const m of placed) {
    const originC = (m.gc - minGC) * MODULE_SIZE;
    const originR = (m.gr - minGR) * MODULE_SIZE;
    let nextIndex = 1;
    const put = (type: string, col: number, row: number): void => {
      furniture.push({ uid: `${m.key}-${nextIndex++}`, type, col, row });
    };

    for (const fill of m.template.floors)
      fillFloor(tiles, tileColors, cols, originC, originR, fill);
    for (const rug of m.template.carpets ?? []) {
      for (let r = originR + rug.r0; r <= originR + rug.r1; r++) {
        for (let c = originC + rug.c0; c <= originC + rug.c1; c++) {
          carpetTiles[r * cols + c] = {
            variant: 0,
            color: rug.color,
            accentColor: rug.accentColor,
          };
        }
      }
    }
    for (const f of m.template.furniture) put(f.type, originC + f.col, originR + f.row);

    const north = hasBackWall(m, 'north', lattice);
    const west = hasBackWall(m, 'west', lattice);
    if (north) {
      drawBackWall(tiles, tileColors, cols, originC, originR, 'north');
      for (const d of m.template.wallDecor.north) put(d.type, originC + d.offset, originR);
    }
    if (west) {
      drawBackWall(tiles, tileColors, cols, originC, originR, 'west');
      for (const d of m.template.wallDecor.west) put(d.type, originC, originR + d.offset);
    }

    if (m.template === TEAM_MODULE) {
      teamModuleAreas.push({
        c0: originC,
        r0: originR,
        c1: originC + MODULE_SIZE - 1,
        r1: originR + MODULE_SIZE - 1,
      });
    }
  }

  let ctoOfficeArea: CtoOfficeArea | undefined;
  if (cto) {
    const originC = (0 - minGC) * MODULE_SIZE;
    const originR = (0 - minGR) * MODULE_SIZE;
    ctoOfficeArea = {
      c0: originC,
      r0: originR,
      c1: originC + MODULE_SIZE - 1,
      r1: originR + MODULE_SIZE - 1,
      queueCol: originC + DOOR_LO,
      queueRow: originR + MODULE_SIZE,
      queueFacing: DIRECTION_UP,
    };
  }

  return { cols, rows, tiles, tileColors, carpetTiles, furniture, ctoOfficeArea, teamModuleAreas };
}
