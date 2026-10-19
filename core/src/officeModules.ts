/**
 * Office modules: fixed-size room templates tiled on a lattice and composed
 * into one layout grid. Pure data and pure functions (no node `fs`), so
 * `scripts/iso-art/layout.ts` and the webview can both import it directly.
 *
 * Every module owns one `MODULE_SIZE` square lattice cell, so any two cells
 * line up edge to edge on any side with no overhang. A template's footprint
 * is the part of its cell it actually floors: the whole cell for a team
 * module, only the south half for the CTO's office. Each template reserves
 * a 1-tile margin on all four sides of its footprint for the wall line the
 * composer may draw there; furniture never sits on that margin.
 */

const WALL = 0;
const VOID_TILE = 255;
/** Numeric encoding matching `office/types.ts`'s `Direction.UP`: core has no
 *  webview dependency, so the composer emits the same plain number instead
 *  of importing the enum. */
const DIRECTION_UP = 3;

export const MODULE_SIZE = 12;
const DOOR_WIDTH = 2;

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
  /** Stands flush against a back wall, like a kitchen unit: the wall tile
   *  behind it gets no window, which would otherwise open behind the unit. */
  againstWall?: boolean;
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
  /** The floored part of the module's cell, in local cell coordinates. The
   *  rest of the cell stays void. */
  footprint: TileRect;
  floors: readonly FloorFill[];
  carpets?: readonly CarpetFill[];
  furniture: readonly ModuleFurniturePlacement[];
  /** `_FRONT` items for the north wall (the footprint's first row, runs
   *  along cols) and `_RIGHT` items (front mirrored) for the west wall (the
   *  footprint's first col, runs along rows), each offset a local cell
   *  index, at least 2 tiles apart and clear of the door gap and the window
   *  columns/rows. */
  wallDecor: { north: readonly WallDecorItem[]; west: readonly WallDecorItem[] };
}

const PALE_TILE = 2;
const PLANKS = 5;
const CHECKER_COARSE = 9;

const SKY_TILE: ModuleColor = { h: -8, s: 4, b: 0, c: 0 };
const HONEY_WOOD: ModuleColor = { h: 0, s: 0, b: 0, c: 0 };
const SUNSHINE_CHECKER: ModuleColor = { h: 10, s: 6, b: 3, c: 0 };

const BREAK_RUG: CarpetFill = {
  c0: 8,
  r0: 8,
  c1: 9,
  r1: 9,
  color: { h: 175, s: 42, b: -4, c: 0 },
  accentColor: { h: 42, s: 48, b: 26, c: 0 },
};
const POD_RUG_COLOR: ModuleColor = { h: 215, s: 28, b: -6, c: 0 };
const POD_RUG_ACCENT: ModuleColor = { h: 205, s: 38, b: 14, c: 0 };
const WEST_POD_RUG: CarpetFill = {
  c0: 1,
  r0: 2,
  c1: 4,
  r1: 5,
  color: POD_RUG_COLOR,
  accentColor: POD_RUG_ACCENT,
};
const EAST_POD_RUG: CarpetFill = { ...WEST_POD_RUG, c0: 6, c1: 9 };
const CTO_RUG: CarpetFill = {
  c0: 3,
  r0: 7,
  c1: 7,
  r1: 10,
  color: { h: 42, s: 65, b: 6, c: 0 },
  accentColor: { h: 24, s: 48, b: -18, c: 0 },
};

const FULL_CELL: TileRect = { c0: 0, r0: 0, c1: MODULE_SIZE - 1, r1: MODULE_SIZE - 1 };
const CTO_FOOTPRINT: TileRect = {
  c0: 0,
  r0: MODULE_SIZE / 2,
  c1: MODULE_SIZE - 1,
  r1: MODULE_SIZE - 1,
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

/** An open-plan floor of 8 desk seats in two 4-seat pods, each on its own
 *  rug, plus an attached break room on its own floor material: a kitchen run
 *  against the west wall (fridge, cooker, sink, a counter holding the coffee
 *  machine, upper cupboards above), a dining table with six chairs, and a
 *  sofa corner with a coffee table: eight rest seats, one for each desk
 *  agent. */
export const TEAM_MODULE: ModuleTemplate = {
  footprint: FULL_CELL,
  floors: [
    { c0: 0, r0: 0, c1: 11, r1: 6, tile: PALE_TILE, color: SKY_TILE },
    { c0: 0, r0: 7, c1: 11, r1: 11, tile: CHECKER_COARSE, color: SUNSHINE_CHECKER },
  ],
  carpets: [WEST_POD_RUG, EAST_POD_RUG, BREAK_RUG],
  furniture: [
    ...deskPod(2, 2),
    ...deskPod(7, 2),
    { type: 'BIN', col: 1, row: 6 },
    { type: 'FRIDGE_RIGHT', col: 1, row: 7, againstWall: true },
    { type: 'STOVE_RIGHT', col: 1, row: 8, againstWall: true },
    { type: 'KITCHEN_CABINET_RIGHT', col: 1, row: 8, againstWall: true },
    { type: 'KITCHEN_SINK_RIGHT', col: 1, row: 9, againstWall: true },
    { type: 'KITCHEN_CABINET_RIGHT', col: 1, row: 9, againstWall: true },
    { type: 'KITCHEN_COUNTER_RIGHT', col: 1, row: 10, againstWall: true },
    { type: 'COFFEE_MACHINE_RIGHT_ON_1', col: 1, row: 10 },
    { type: 'WATER_COOLER', col: 1, row: 11, againstWall: true },
    { type: 'KITCHEN_TABLE_FRONT', col: 4, row: 9 },
    { type: 'WOODEN_CHAIR_FRONT', col: 4, row: 8 },
    { type: 'WOODEN_CHAIR_FRONT', col: 5, row: 8 },
    { type: 'WOODEN_CHAIR_BACK', col: 4, row: 10 },
    { type: 'WOODEN_CHAIR_BACK', col: 5, row: 10 },
    { type: 'WOODEN_CHAIR_RIGHT', col: 3, row: 9 },
    { type: 'WOODEN_CHAIR_LEFT', col: 6, row: 9 },
    { type: 'SOFA_FRONT', col: 8, row: 8 },
    { type: 'COFFEE_TABLE_FRONT', col: 8, row: 9 },
  ],
  wallDecor: {
    north: [{ type: 'WALL_SHELF_FRONT', offset: 2 }],
    west: [],
  },
};

/** A small executive office on the south half of its cell, flush with the
 *  first team module below it: a desk and chair facing the entrance, two
 *  visitor chairs, a couch and coffee table, on a wood floor. */
export const CTO_MODULE: ModuleTemplate = {
  footprint: CTO_FOOTPRINT,
  floors: [{ ...CTO_FOOTPRINT, tile: PLANKS, color: HONEY_WOOD }],
  carpets: [CTO_RUG],
  furniture: [
    { type: 'EXEC_DESK_BACK', col: 4, row: 8 },
    { type: 'EXEC_CHAIR_FRONT', col: 5, row: 7 },
    { type: 'PC_BACK_OFF', col: 6, row: 9 },
    { type: 'COFFEE', col: 4, row: 8 },
    { type: 'WOODEN_CHAIR_BACK', col: 4, row: 10 },
    { type: 'WOODEN_CHAIR_BACK', col: 6, row: 10 },
    { type: 'SOFA_FRONT', col: 8, row: 7 },
    { type: 'COFFEE_TABLE_FRONT', col: 8, row: 8 },
    { type: 'BIN', col: 1, row: 10 },
  ],
  wallDecor: { north: [], west: [] },
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
  /** `"col,row"` keys of back-wall tiles with a unit standing against them,
   *  which the wall renderer leaves without a window. */
  windowlessWalls: string[];
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

/** The centre's lattice neighbours: south, east and west first (the first is
 *  always the "first team module" `ctoOfficeArea`'s queue anchor faces),
 *  then the 4 diagonal corners, then north last: the CTO's footprint is only
 *  the south half of its cell, so a north module touches nothing until a
 *  north corner is in place to connect it. Beyond that ring, each cardinal
 *  direction doubled, tripled, and so on outward, which keeps
 *  `composeOffice` total for whatever team count runtime growth asks for. */
function ringOffset(index: number): { dc: number; dr: number } {
  const RING_1 = [
    { dc: 0, dr: 1 },
    { dc: 1, dr: 0 },
    { dc: -1, dr: 0 },
    { dc: 1, dr: 1 },
    { dc: -1, dr: 1 },
    { dc: 1, dr: -1 },
    { dc: -1, dr: -1 },
    { dc: 0, dr: -1 },
  ] as const;
  if (index < RING_1.length) return RING_1[index];
  const CARDINALS = [
    { dc: 0, dr: 1 },
    { dc: 1, dr: 0 },
    { dc: -1, dr: 0 },
    { dc: 0, dr: -1 },
  ] as const;
  const outerIndex = index - RING_1.length;
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

/** First local index of the `DOOR_WIDTH` gap centred on the run `lo..hi`. */
function doorStart(lo: number, hi: number): number {
  return lo + Math.floor((hi - lo + 1 - DOOR_WIDTH) / 2);
}

/** A module's back walls (the north and west edges of its footprint) are the
 *  building's shell: a wall tile stands wherever nothing lies beyond it. A
 *  side with nothing at all beyond it keeps a door gap centred on its run.
 *  A side that only partly borders another module is walled exactly where
 *  it is exposed. Every other side, including a CTO-to-team or team-to-team
 *  join, stays open floor. Reads the tiles beyond, so it must run after
 *  every module's floor is filled. Returns the local offsets it walled. */
function drawBackWall(
  tiles: number[],
  tileColors: (ModuleColor | null)[],
  cols: number,
  originC: number,
  originR: number,
  footprint: TileRect,
  axis: 'north' | 'west',
): Set<number> {
  const lo = axis === 'north' ? footprint.c0 : footprint.r0;
  const hi = axis === 'north' ? footprint.c1 : footprint.r1;
  const exposed: { offset: number; index: number }[] = [];
  for (let offset = lo; offset <= hi; offset++) {
    const col = axis === 'north' ? originC + offset : originC + footprint.c0;
    const row = axis === 'north' ? originR + footprint.r0 : originR + offset;
    const beyondCol = axis === 'north' ? col : col - 1;
    const beyondRow = axis === 'north' ? row - 1 : row;
    if (beyondCol < 0 || beyondRow < 0 || tiles[beyondRow * cols + beyondCol] === VOID_TILE) {
      exposed.push({ offset, index: row * cols + col });
    }
  }

  const hasDoor = exposed.length === hi - lo + 1;
  const door = doorStart(lo, hi);
  const walled = new Set<number>();
  for (const { offset, index } of exposed) {
    if (hasDoor && offset >= door && offset < door + DOOR_WIDTH) continue;
    tiles[index] = WALL;
    tileColors[index] = WALL_COLOR;
    walled.add(offset);
  }
  return walled;
}

/** Compose team and CTO modules on the lattice into one layout grid. Centre:
 *  the CTO module when `cto` is enabled, else the first team module. The
 *  rest of the team modules ring around the centre in `ringOffset` order. */
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
  let ctoOfficeArea: CtoOfficeArea | undefined;

  const nextIndex = new Map<string, number>();
  const put = (m: PlacedModule, type: string, col: number, row: number): void => {
    const index = nextIndex.get(m.key) ?? 1;
    nextIndex.set(m.key, index + 1);
    furniture.push({ uid: `${m.key}-${index}`, type, col, row });
  };

  for (const m of placed) {
    const originC = (m.gc - minGC) * MODULE_SIZE;
    const originR = (m.gr - minGR) * MODULE_SIZE;
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
    for (const f of m.template.furniture) put(m, f.type, originC + f.col, originR + f.row);

    const { footprint } = m.template;
    const area: TileRect = {
      c0: originC + footprint.c0,
      r0: originR + footprint.r0,
      c1: originC + footprint.c1,
      r1: originR + footprint.r1,
    };
    if (m.template === TEAM_MODULE) teamModuleAreas.push(area);
    if (m.template === CTO_MODULE) {
      ctoOfficeArea = {
        ...area,
        queueCol: originC + doorStart(footprint.c0, footprint.c1),
        queueRow: area.r1 + 1,
        queueFacing: DIRECTION_UP,
      };
    }
  }

  const windowlessWalls: string[] = [];
  for (const m of placed) {
    const originC = (m.gc - minGC) * MODULE_SIZE;
    const originR = (m.gr - minGR) * MODULE_SIZE;
    const { footprint, wallDecor } = m.template;
    const north = drawBackWall(tiles, tileColors, cols, originC, originR, footprint, 'north');
    for (const d of wallDecor.north) {
      if (north.has(d.offset)) put(m, d.type, originC + d.offset, originR + footprint.r0);
    }
    const west = drawBackWall(tiles, tileColors, cols, originC, originR, footprint, 'west');
    for (const d of wallDecor.west) {
      if (west.has(d.offset)) put(m, d.type, originC + footprint.c0, originR + d.offset);
    }
    for (const f of m.template.furniture) {
      if (!f.againstWall) continue;
      if (f.col - 1 === footprint.c0 && west.has(f.row)) {
        windowlessWalls.push(`${originC + footprint.c0},${originR + f.row}`);
      }
      if (f.row - 1 === footprint.r0 && north.has(f.col)) {
        windowlessWalls.push(`${originC + f.col},${originR + footprint.r0}`);
      }
    }
  }

  return {
    cols,
    rows,
    tiles,
    tileColors,
    carpetTiles,
    furniture,
    windowlessWalls,
    ctoOfficeArea,
    teamModuleAreas,
  };
}
