/**
 * `composeOffice`'s contract for runtime growth: a module's furniture uids
 * and tile positions never move, whether more team modules are composed
 * alongside it or fewer.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import { composeOffice, CTO_MODULE } from '../../core/src/officeModules.ts';

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

test('the CTO module regains its north wall decor once the north ring slot empties out again', () => {
  // team4 (ring index 3) sits north of the CTO module: while it is there,
  // both the CTO's north and west sides are open joins, not walls, so it
  // carries no wall decor at all. Removing team4 (4 → 3) restores the north
  // wall and its 2 decor items (CTO_SIGN_FRONT, CLOCK_FRONT); the west side
  // still joins team3, so it stays undecorated.
  const four = composeOffice({ teamModules: 4, cto: true });
  const three = composeOffice({ teamModules: 3, cto: true });
  assert.equal(furnitureByModule(four.furniture, 'cto').length, CTO_MODULE.furniture.length);
  assert.equal(furnitureByModule(three.furniture, 'cto').length, CTO_MODULE.furniture.length + 2);
  assert.deepEqual(
    furnitureByModule(three.furniture, 'cto')
      .map((f) => f.type)
      .filter((type) => type === 'CTO_SIGN_FRONT' || type === 'CLOCK_FRONT')
      .sort(),
    ['CLOCK_FRONT', 'CTO_SIGN_FRONT'],
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

test('team module areas are in ring order: south, east, west, north', () => {
  const { teamModuleAreas } = composeOffice({ teamModules: 4, cto: true });
  assert.equal(teamModuleAreas.length, 4);
  const cto = composeOffice({ teamModules: 4, cto: true }).ctoOfficeArea!;
  // team1 (south) sits directly below the CTO rect.
  assert.equal(teamModuleAreas[0].r0, cto.r1 + 1);
  assert.equal(teamModuleAreas[0].c0, cto.c0);
  // team2 (east) sits directly right of the CTO rect.
  assert.equal(teamModuleAreas[1].c0, cto.c1 + 1);
  assert.equal(teamModuleAreas[1].r0, cto.r0);
  // team3 (west) sits directly left of the CTO rect.
  assert.equal(teamModuleAreas[2].c1, cto.c0 - 1);
  // team4 (north) sits directly above the CTO rect.
  assert.equal(teamModuleAreas[3].r1, cto.r0 - 1);
});
