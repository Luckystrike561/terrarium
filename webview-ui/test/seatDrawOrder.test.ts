/**
 * Seats layer like Habbo Hotel's: a sitter draws over a seat facing the
 * viewer, and a seat facing away draws its backrest over its sitter.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, test } from 'vitest';

import { buildFurnitureCatalog } from '../../core/src/assets/build.ts';
import { decodeAllFurniture } from '../../core/src/assets/loader.ts';
import type { SortBox } from '../src/office/engine/isoSort.js';
import { isoDrawOrder, SortLayer } from '../src/office/engine/isoSort.js';
import { buildDynamicCatalog } from '../src/office/layout/furnitureCatalog.js';
import {
  layoutToFurnitureInstances,
  layoutToSeats,
} from '../src/office/layout/layoutSerializer.js';

const ASSETS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/assets');

beforeAll(() => {
  const catalog = buildFurnitureCatalog(ASSETS_DIR);
  buildDynamicCatalog({ catalog, sprites: decodeAllFurniture(ASSETS_DIR, catalog) });
});

function sitterBox(col: number, row: number): SortBox {
  const half = 0.01;
  return {
    minCol: col + 0.5 - half,
    minRow: row + 0.5 - half,
    maxCol: col + 0.5 + half,
    maxRow: row + 0.5 + half,
    layer: SortLayer.ACTOR,
  };
}

const SEATS_FACING_VIEWER = ['WOODEN_CHAIR_FRONT', 'WOODEN_CHAIR_RIGHT', 'SOFA_FRONT'];
const SEATS_FACING_AWAY = [
  'WOODEN_CHAIR_BACK',
  'WOODEN_CHAIR_LEFT',
  'CUSHIONED_CHAIR_BACK',
  'EXEC_CHAIR_BACK',
  'SOFA_BACK',
];

function drawOrders(type: string): number[][] {
  const placed = [{ uid: 'seat', type, col: 4, row: 4 }];
  const [instance] = layoutToFurnitureInstances(placed);
  const seats = [...layoutToSeats(placed).values()];
  assert.ok(seats.length > 0);
  return seats.map((seat) => isoDrawOrder([instance.sort, sitterBox(seat.seatCol, seat.seatRow)]));
}

for (const type of SEATS_FACING_VIEWER) {
  test(`a character seated on ${type} draws over it`, () => {
    for (const order of drawOrders(type)) assert.deepEqual(order, [0, 1]);
  });
}

for (const type of SEATS_FACING_AWAY) {
  test(`${type} draws its backrest over its sitter`, () => {
    for (const order of drawOrders(type)) assert.deepEqual(order, [1, 0]);
  });
}
