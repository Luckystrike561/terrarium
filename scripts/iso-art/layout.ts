/**
 * Build the bundled default office layout.
 *
 *   npx tsx scripts/iso-art/layout.ts
 *
 * Writes webview-ui/public/assets/default-layout-<REVISION>.json and removes
 * older default-layout-*.json files. Bump REVISION whenever the layout
 * changes: the server replaces any saved layout with a lower revision.
 *
 * Rooms: open-plan work space (top left), CTO office (top right), meeting
 * room (bottom right), break room with kitchen and lounge (bottom left).
 * Solid walls run along row 0 and col 0; every other wall renders as a glass
 * partition.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const REVISION = 3;
const COLS = 22;
const ROWS = 16;

const WALL = 0;
const BIG_TILES = 2;
const TILES = 3;
const PLANKS = 5;

interface Color {
  h: number;
  s: number;
  b: number;
  c: number;
}

const WHITE_WALL: Color = { h: 40, s: 10, b: 75, c: 0 };
const OAK: Color = { h: 35, s: 35, b: 25, c: -60 };
const WALNUT: Color = { h: 25, s: 40, b: -25, c: -50 };
const CONCRETE: Color = { h: 210, s: 6, b: 30, c: -50 };
const STONE: Color = { h: 200, s: 10, b: 35, c: -55 };

const tiles: number[] = new Array(COLS * ROWS).fill(PLANKS);
const tileColors: (Color | null)[] = new Array(COLS * ROWS).fill(OAK);
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
  tileColors[r * COLS + c] = WHITE_WALL;
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

floor(15, 1, 21, 7, PLANKS, WALNUT);
floor(15, 9, 21, 15, BIG_TILES, STONE);
floor(1, 10, 13, 15, TILES, CONCRETE);

for (let c = 0; c < COLS; c++) wall(c, 0);
for (let r = 0; r < ROWS; r++) wall(0, r);
for (let r = 1; r < ROWS; r++) if (![4, 5, 11, 12].includes(r)) wall(14, r);
for (let c = 15; c < COLS; c++) wall(c, 8);
for (let c = 1; c < 14; c++) if (![6, 7].includes(c)) wall(c, 9);

rug(16, 2, 19, 6, { h: 220, s: 35, b: -30, c: 0 }, { h: 40, s: 50, b: 20, c: 0 });
rug(10, 11, 13, 14, { h: 170, s: 30, b: -10, c: 0 }, { h: 30, s: 20, b: 40, c: 0 });

const furniture: { uid: string; type: string; col: number; row: number }[] = [];
function put(type: string, col: number, row: number): void {
  furniture.push({ uid: `office-${furniture.length + 1}`, type, col, row });
}

// Open-plan work space: three pods of four desks.
for (const c0 of [2, 6, 10]) {
  put('DESK_BACK', c0, 3);
  put('DESK_FRONT', c0, 4);
  put('PC_BACK_OFF', c0, 3);
  put('PC_BACK_OFF', c0 + 1, 3);
  put('PC_FRONT_OFF', c0, 4);
  put('PC_FRONT_OFF', c0 + 1, 4);
  put('CUSHIONED_CHAIR_FRONT', c0, 2);
  put('CUSHIONED_CHAIR_FRONT', c0 + 1, 2);
  put('CUSHIONED_CHAIR_BACK', c0, 5);
  put('CUSHIONED_CHAIR_BACK', c0 + 1, 5);
}
put('COFFEE', 7, 4);
put('WALL_SHELF_FRONT', 2, 0);
put('KANBAN_BOARD_FRONT', 4, 0);
put('WALL_TV_FRONT_ON_1', 8, 0);
put('CLOCK_FRONT', 11, 0);
put('WHITEBOARD_RIGHT', 0, 2);
put('LARGE_PAINTING_RIGHT', 0, 5);
put('LARGE_PLANT', 1, 1);
put('LARGE_PLANT', 13, 1);
put('PLANT', 13, 8);
put('PLANT_2', 1, 8);
put('BIN', 5, 7);
put('RUG_PLANT_FRONT', 9, 7);

// CTO office.
put('EXEC_DESK_BACK', 16, 3);
put('EXEC_CHAIR_FRONT', 17, 2);
put('PC_BACK_OFF', 17, 3);
put('COFFEE', 18, 3);
put('WOODEN_CHAIR_BACK', 16, 5);
put('WOODEN_CHAIR_BACK', 18, 5);
put('CTO_SIGN_FRONT', 15, 0);
put('WALL_SHELF_FRONT', 17, 0);
put('SMALL_PAINTING_FRONT', 19, 0);
put('SMALL_PAINTING_2_FRONT', 20, 0);
put('FLOOR_LAMP', 15, 1);
put('LARGE_PLANT', 21, 1);
put('SOFA_LEFT', 21, 4);
put('COFFEE_TABLE_RIGHT', 20, 4);
put('PLANT', 21, 7);

// Meeting room.
put('MEETING_TABLE_FRONT', 16, 11);
for (const c of [16, 17, 18]) {
  put('WOODEN_CHAIR_FRONT', c, 10);
  put('WOODEN_CHAIR_BACK', c, 13);
}
put('PLANT_2', 21, 10);
put('PLANT', 21, 15);
put('WATER_COOLER', 15, 15);

// Break room: kitchen along the back wall, bistro tables, island, lounge.
put('KITCHEN_COUNTER_RIGHT', 1, 10);
put('KITCHEN_COUNTER_RIGHT', 1, 12);
put('COFFEE_MACHINE_ON_1', 1, 10);
put('COFFEE', 1, 11);
put('FRIDGE_RIGHT', 1, 14);
put('WATER_COOLER', 1, 15);
put('WALL_SHELF_RIGHT', 0, 11);
put('HANGING_PLANT_RIGHT', 0, 13);
put('SMALL_TABLE', 4, 12);
put('WOODEN_CHAIR_RIGHT', 3, 12);
put('WOODEN_CHAIR_LEFT', 5, 12);
put('SMALL_TABLE', 4, 14);
put('WOODEN_CHAIR_RIGHT', 3, 14);
put('WOODEN_CHAIR_LEFT', 5, 14);
put('KITCHEN_COUNTER_FRONT', 7, 11);
put('STOOL', 7, 12);
put('STOOL', 8, 12);
put('SOFA_FRONT', 11, 11);
put('COFFEE_TABLE_FRONT', 11, 12);
put('SOFA_BACK', 11, 14);
put('FLOOR_LAMP', 13, 11);
put('LARGE_PLANT', 13, 10);
put('PLANT', 13, 15);
put('PLANT_2', 9, 15);

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
