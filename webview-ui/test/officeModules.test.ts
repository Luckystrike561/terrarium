/**
 * `composeOffice`'s contract for runtime growth: a module's furniture uids
 * and tile positions never move, whether more team modules are composed
 * alongside it or fewer.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import { composeOffice } from '../../core/src/officeModules.ts';
import { TileType } from '../src/office/types.ts';

function furnitureByModule(
  furniture: { uid: string; type: string; col: number; row: number }[],
  prefix: string,
): { uid: string; type: string; col: number; row: number }[] {
  return furniture
    .filter((f) => f.uid.startsWith(`${prefix}-`))
    .sort((a, b) => a.uid.localeCompare(b.uid, undefined, { numeric: true }));
}

test('every furniture uid is prefixed by its module: cto-N or teamK-N', () => {
  const { furniture } = composeOffice({ teamModules: 3, cto: true });
  for (const f of furniture) assert.match(f.uid, /^(cto|team[1-9]\d*)-\d+$/);
});

test('a team module keeps the exact same furniture (uid, type, position) as more team modules are added', () => {
  const one = composeOffice({ teamModules: 1, cto: true });
  const two = composeOffice({ teamModules: 2, cto: true });
  const four = composeOffice({ teamModules: 4, cto: true });
  assert.deepEqual(
    furnitureByModule(two.furniture, 'team1'),
    furnitureByModule(one.furniture, 'team1'),
  );
  assert.deepEqual(
    furnitureByModule(four.furniture, 'team1'),
    furnitureByModule(one.furniture, 'team1'),
  );
  assert.deepEqual(
    furnitureByModule(four.furniture, 'team2'),
    furnitureByModule(two.furniture, 'team2'),
  );
});

test('the CTO module keeps the same furniture while its own neighbouring ring slots stay empty', () => {
  // Growing south (team1) then east (team2) never fills the CTO's own back
  // (north, west) ring slots, so its wall decor is unaffected.
  const noTeam = composeOffice({ teamModules: 0, cto: true });
  const southEast = composeOffice({ teamModules: 2, cto: true });
  assert.deepEqual(
    furnitureByModule(southEast.furniture, 'cto'),
    furnitureByModule(noTeam.furniture, 'cto'),
  );
});

test('removing the outermost team module leaves every remaining team module byte-identical', () => {
  const four = composeOffice({ teamModules: 4, cto: true });
  const three = composeOffice({ teamModules: 3, cto: true });
  for (const key of ['team1', 'team2', 'team3']) {
    assert.deepEqual(
      furnitureByModule(three.furniture, key),
      furnitureByModule(four.furniture, key),
    );
  }
  assert.equal(furnitureByModule(three.furniture, 'team4').length, 0);
  assert.ok(furnitureByModule(four.furniture, 'team4').length > 0);
});

test('every team module area keeps the same tile rectangle regardless of how many are composed', () => {
  const one = composeOffice({ teamModules: 1, cto: true });
  const four = composeOffice({ teamModules: 4, cto: true });
  assert.deepEqual(four.teamModuleAreas[0], one.teamModuleAreas[0]);
});

test('the CTO office area keeps the same tile rectangle regardless of team module count', () => {
  const one = composeOffice({ teamModules: 1, cto: true });
  const four = composeOffice({ teamModules: 4, cto: true });
  assert.deepEqual(four.ctoOfficeArea, one.ctoOfficeArea);
});

test('the grid dimensions stay constant across 1 to 8 team modules (the fixed ring-1 reservation)', () => {
  const sizes = [1, 2, 3, 4, 5, 6, 7, 8].map((teamModules) => {
    const { cols, rows } = composeOffice({ teamModules, cto: true });
    return `${cols}x${rows}`;
  });
  assert.equal(
    new Set(sizes).size,
    1,
    `expected one grid size, got ${[...new Set(sizes)].join(', ')}`,
  );
});

test('team modules ring the CTO south, east and west, then the corners, north last', () => {
  const { teamModuleAreas, ctoOfficeArea } = composeOffice({ teamModules: 8, cto: true });
  const cto = ctoOfficeArea!;
  const [south, east, west, , , , , north] = teamModuleAreas;
  assert.equal(south.r0, cto.r1 + 1);
  assert.equal(south.c0, cto.c0);
  assert.equal(east.c0, cto.c1 + 1);
  assert.equal(east.r1, cto.r1);
  assert.equal(west.c1, cto.c0 - 1);
  assert.equal(west.r1, cto.r1);
  assert.equal(north.c0, cto.c0);
  assert.ok(north.r1 < cto.r0 - 1, 'the north module does not touch the half-depth CTO office');
});

test('every team module is reachable on foot from the CTO office, whatever the count', () => {
  for (let teamModules = 1; teamModules <= 12; teamModules++) {
    const { cols, rows, tiles, ctoOfficeArea, teamModuleAreas } = composeOffice({
      teamModules,
      cto: true,
    });
    const reached = new Set<number>();
    const start = ctoOfficeArea!.r1 * cols + ctoOfficeArea!.c0;
    const stack = [start];
    reached.add(start);
    while (stack.length > 0) {
      const index = stack.pop()!;
      const col = index % cols;
      const row = Math.floor(index / cols);
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const c = col + dc;
        const r = row + dr;
        if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
        const next = r * cols + c;
        if (reached.has(next) || tiles[next] === TileType.WALL || tiles[next] === TileType.VOID)
          continue;
        reached.add(next);
        stack.push(next);
      }
    }
    teamModuleAreas.forEach((area, i) => {
      const centre =
        Math.floor((area.r0 + area.r1) / 2) * cols + Math.floor((area.c0 + area.c1) / 2);
      assert.ok(reached.has(centre), `team${i + 1} is cut off with ${teamModules} team modules`);
    });
  }
});

test('the wall behind the kitchen run is listed windowless, and only real wall tiles ever are', () => {
  const one = composeOffice({ teamModules: 1, cto: true });
  const team1 = one.teamModuleAreas[0];
  const kitchenWall = [7, 8, 9, 10].map((row) => `${team1.c0},${team1.r0 + row}`);
  for (const key of kitchenWall) assert.ok(one.windowlessWalls.includes(key), key);

  for (let teamModules = 1; teamModules <= 8; teamModules++) {
    const { cols, tiles, windowlessWalls } = composeOffice({ teamModules, cto: true });
    for (const key of windowlessWalls) {
      const [col, row] = key.split(',').map(Number);
      assert.equal(tiles[row * cols + col], TileType.WALL, `${key} with ${teamModules} modules`);
    }
  }
});
