/**
 * Build the bundled default office layout.
 *
 *   npx tsx scripts/iso-art/layout.ts
 *
 * Writes webview-ui/public/assets/default-layout-<REVISION>.json and removes
 * older default-layout-*.json files. Bump REVISION whenever the layout
 * changes. The server serves this default only when no layout.json exists.
 *
 * A Habbo-style room plan: four rooms around one open-plan work floor, each
 * with its own bright floor material and colour, connected by glass
 * partitions with short doorway gaps. Rooms: open-plan work area (top left),
 * CTO office (top right), lounge and break corner (bottom left), meeting
 * room (bottom right). Solid walls run along row 0 and col 0 only; every
 * other wall renders as a glass partition.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const REVISION = 4;
const COLS = 22;
const ROWS = 16;

const WALL = 0;
/** floor_1: large pale tile, bright seam. The work floor's own colour, and
 *  the default fill so every doorway gap between rooms reads as this tile
 *  rather than a seam of the wrong material. */
const PALE_TILE = 2;
/** floor_2: large tile, dark grout. */
const GROUT_TILE = 3;
/** floor_3: small square tile, dark grout. */
const SMALL_TILE = 4;
/** floor_4: wood planks. */
const PLANKS = 5;
/** floor_8: coarse checkerboard. */
const CHECKER_COARSE = 9;

interface Color {
  h: number;
  s: number;
  b: number;
  c: number;
}

/** Light blue-grey wallpaper, Habbo's default room wall. */
const WALL_COLOR: Color = { h: 220, s: 30, b: 46, c: 0 };
/** Pale sky-blue tile, the open work floor. */
const SKY_TILE: Color = { h: 206, s: 34, b: 18, c: -10 };
/** Honey wood planks, the CTO's prestige floor. */
const HONEY_WOOD: Color = { h: 32, s: 55, b: 4, c: -15 };
/** Rich harbour blue, the meeting room's grouted tile. */
const HARBOUR_BLUE: Color = { h: 211, s: 55, b: -2, c: -10 };
/** Soft teal, the lounge's small tile. */
const LAGOON_TILE: Color = { h: 175, s: 36, b: 14, c: -15 };
/** Soft butter yellow against white, the break corner's checkerboard. */
const SUNSHINE_CHECKER: Color = { h: 46, s: 26, b: 55, c: -40 };

const tiles: number[] = new Array(COLS * ROWS).fill(PALE_TILE);
const tileColors: (Color | null)[] = new Array(COLS * ROWS).fill(SKY_TILE);
const carpetTiles: ({ variant: number; color: Color; accentColor: Color } | null)[] = new Array(
  COLS * ROWS,
).fill(null);

function floor(c0: number, r0: number, c1: number, r1: number, tile: number, color: Color): void {
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      tiles[r * COLS + c] = tile;
      tileColors[r * COLS + c] = color;
    }
  }
}

function wall(c: number, r: number): void {
  tiles[r * COLS + c] = WALL;
  tileColors[r * COLS + c] = WALL_COLOR;
}

function rug(
  c0: number,
  r0: number,
  c1: number,
  r1: number,
  color: Color,
  accentColor: Color,
): void {
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) carpetTiles[r * COLS + c] = { variant: 0, color, accentColor };
  }
}

// CTO office (top right), meeting room (bottom right), lounge + break corner
// (bottom left, col 13 carried into the break corner so its doorway gap
// reads as checkerboard instead of the work floor's default tile).
floor(14, 1, 21, 8, PLANKS, HONEY_WOOD);
floor(14, 10, 21, 15, GROUT_TILE, HARBOUR_BLUE);
floor(1, 10, 7, 15, SMALL_TILE, LAGOON_TILE);
floor(8, 10, 13, 15, CHECKER_COARSE, SUNSHINE_CHECKER);

for (let c = 0; c < COLS; c++) wall(c, 0);
for (let r = 0; r < ROWS; r++) wall(0, r);
for (let r = 1; r <= 15; r++) if (![4, 5, 12, 13].includes(r)) wall(13, r);
for (let c = 14; c <= 21; c++) wall(c, 9);
for (let c = 1; c <= 12; c++) if (![6, 7].includes(c)) wall(c, 9);

rug(2, 6, 11, 7, { h: 10, s: 30, b: 10, c: 0 }, { h: 46, s: 42, b: 24, c: 0 });
rug(18, 1, 20, 3, { h: 42, s: 65, b: 6, c: 0 }, { h: 24, s: 48, b: -18, c: 0 });
rug(1, 10, 4, 13, { h: 175, s: 42, b: -4, c: 0 }, { h: 42, s: 48, b: 26, c: 0 });

const furniture: { uid: string; type: string; col: number; row: number }[] = [];
function put(type: string, col: number, row: number): void {
  furniture.push({ uid: `office-${furniture.length + 1}`, type, col, row });
}

// Open-plan work area: four back-to-back desk pods, two PCs and two chairs
// per side.
for (const c0 of [1, 4, 7, 10]) {
  put('CUSHIONED_CHAIR_FRONT', c0, 2);
  put('CUSHIONED_CHAIR_FRONT', c0 + 1, 2);
  put('DESK_BACK', c0, 3);
  put('PC_BACK_OFF', c0, 3);
  put('PC_BACK_OFF', c0 + 1, 3);
  put('DESK_FRONT', c0, 4);
  put('PC_FRONT_OFF', c0, 4);
  put('PC_FRONT_OFF', c0 + 1, 4);
  put('CUSHIONED_CHAIR_BACK', c0, 5);
  put('CUSHIONED_CHAIR_BACK', c0 + 1, 5);
}
put('DOUBLE_BOOKSHELF_FRONT', 1, 0);
put('KANBAN_BOARD_FRONT', 3, 0);
put('WALL_TV_FRONT_ON_1', 6, 0);
put('CLOCK_FRONT', 9, 0);
put('WHITEBOARD_FRONT', 12, 0);
put('LARGE_PAINTING_RIGHT', 0, 1);
put('HANGING_PLANT_RIGHT', 0, 4);
put('SMALL_PAINTING_RIGHT', 0, 7);
put('LARGE_PLANT', 1, 1);
put('LARGE_PLANT', 12, 1);
put('RUG_PLANT_FRONT', 5, 7);
put('BIN', 12, 7);

// CTO office: executive desk and chair, two visitor chairs, a couch and
// coffee table in the corner, room for the queue at the col-13 door.
put('EXEC_DESK_BACK', 15, 3);
put('EXEC_CHAIR_FRONT', 16, 2);
put('PC_BACK_OFF', 16, 3);
put('COFFEE', 17, 3);
put('WOODEN_CHAIR_BACK', 15, 5);
put('WOODEN_CHAIR_BACK', 17, 5);
put('COFFEE_TABLE_RIGHT', 18, 2);
put('SOFA_RIGHT', 19, 2);
put('CTO_SIGN_FRONT', 15, 0);
put('WALL_SHELF_FRONT', 19, 0);
put('SMALL_PAINTING_FRONT', 20, 0);
put('SMALL_PAINTING_2_FRONT', 21, 0);
put('FLOOR_LAMP', 14, 1);
put('LARGE_PLANT', 21, 1);
put('PLANT', 21, 7);

// Meeting room.
put('MEETING_TABLE_FRONT', 16, 11);
for (const c of [16, 17, 18]) {
  put('WOODEN_CHAIR_FRONT', c, 10);
  put('WOODEN_CHAIR_BACK', c, 13);
}
put('WATER_COOLER', 14, 15);
put('CACTUS', 15, 11);
put('PLANT_2', 21, 10);
put('PLANT', 21, 15);
put('FLOOR_LAMP', 20, 14);

// Lounge: two sofas around a coffee table and a bench, all facing away from
// electronics so they stay rest seats.
put('SOFA_FRONT', 2, 10);
put('COFFEE_TABLE_FRONT', 2, 11);
put('SOFA_BACK', 2, 13);
put('CUSHIONED_BENCH_FRONT', 5, 14);
put('LARGE_PLANT', 1, 10);
put('FLOOR_LAMP', 7, 10);
put('PLANT', 1, 15);
put('POT', 6, 15);
put('HANGING_PLANT_RIGHT', 0, 11);
put('WALL_SHELF_RIGHT', 0, 14);

// Break corner: kitchen counter with the coffee machine, a bistro table.
put('KITCHEN_COUNTER_FRONT', 8, 10);
put('KITCHEN_COUNTER_FRONT', 10, 10);
put('COFFEE_MACHINE_ON_1', 8, 10);
put('COFFEE', 10, 10);
put('FRIDGE_FRONT', 12, 10);
put('SMALL_TABLE', 9, 13);
put('STOOL', 8, 13);
put('STOOL', 10, 13);
put('WATER_COOLER', 12, 14);
put('PLANT_2', 12, 15);
put('BIN', 8, 15);

const layout = {
  version: 1,
  cols: COLS,
  rows: ROWS,
  layoutRevision: REVISION,
  tiles,
  tileColors,
  carpetTiles,
  furniture,
};

const assets = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../webview-ui/public/assets',
);
for (const file of fs.readdirSync(assets)) {
  if (/^default-layout-\d+\.json$/.test(file)) fs.rmSync(path.join(assets, file));
}
fs.writeFileSync(
  path.join(assets, `default-layout-${REVISION}.json`),
  `${JSON.stringify(layout)}\n`,
);
console.log(`[iso-art] default-layout-${REVISION}.json: ${furniture.length} items`);
