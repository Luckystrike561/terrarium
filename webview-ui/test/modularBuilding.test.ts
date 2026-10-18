/**
 * The self-composing office on a real Building with the bundled furniture:
 * a restored agent gets its persisted desk back, and a repeated layoutLoaded
 * keeps the office the size its agents need.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, test } from 'vitest';

import { buildFurnitureCatalog } from '../../core/src/assets/build.ts';
import { decodeAllFurniture } from '../../core/src/assets/loader.ts';
import { Building } from '../src/office/engine/building.js';
import { buildDynamicCatalog } from '../src/office/layout/furnitureCatalog.js';

const ASSETS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/assets');

beforeAll(() => {
  const catalog = buildFurnitureCatalog(ASSETS_DIR);
  buildDynamicCatalog({ catalog, sprites: decodeAllFurniture(ASSETS_DIR, catalog) });
});

function modularBuilding(): Building {
  const building = new Building();
  building.setFloors([{ id: 'local', name: 'local' }]);
  building.enableModularOffice();
  return building;
}

function seatsOf(building: Building, ids: number[]): Map<number, string | null | undefined> {
  return new Map(ids.map((id) => [id, building.ground.characters.get(id)?.seatId]));
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

test('a restored agent gets its persisted desk in a module the office has not grown yet', () => {
  const source = modularBuilding();
  for (const id of range(1, 12)) source.addAgent('local', id);
  const persisted = seatsOf(source, range(1, 12));
  assert.ok([...persisted.values()].some((seat) => seat?.startsWith('team2-')));

  const restored = modularBuilding();
  for (const id of range(1, 12).reverse()) {
    restored.addAgent('local', id, undefined, undefined, persisted.get(id) ?? undefined, true);
  }

  assert.deepEqual(seatsOf(restored, range(1, 12)), persisted);
});

test('a repeated layoutLoaded keeps every agent at its desk', () => {
  const building = modularBuilding();
  for (const id of range(1, 25)) building.addAgent('local', id);
  const before = seatsOf(building, range(1, 25));

  building.enableModularOffice();

  assert.equal(building.floors[0].teamModules, 3);
  assert.deepEqual(seatsOf(building, range(1, 25)), before);
});
