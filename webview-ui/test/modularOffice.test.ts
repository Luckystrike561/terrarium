/**
 * Runtime office growth: how many team modules a floor needs, and when it
 * actually grows or shrinks to that count.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import { TEAM_MODULE } from '../../core/src/officeModules.ts';
import {
  AGENTS_PER_TEAM_MODULE,
  neededTeamModules,
  nextTeamModuleCount,
} from '../src/office/engine/modularOffice.ts';

test('neededTeamModules: at least 1, then ceil(agents / 8)', () => {
  assert.equal(neededTeamModules(0), 1);
  assert.equal(neededTeamModules(1), 1);
  assert.equal(neededTeamModules(8), 1);
  assert.equal(neededTeamModules(9), 2);
  assert.equal(neededTeamModules(16), 2);
  assert.equal(neededTeamModules(17), 3);
  assert.equal(neededTeamModules(24), 3);
  assert.equal(neededTeamModules(25), 4);
});

test('a team module seats exactly AGENTS_PER_TEAM_MODULE agents at its desks', () => {
  const deskChairs = TEAM_MODULE.furniture.filter((f) => f.type.startsWith('CUSHIONED_CHAIR'));
  assert.equal(deskChairs.length, AGENTS_PER_TEAM_MODULE);
});

test('grows straight to whatever is needed, one module per crossed threshold', () => {
  const neverEmpty = () => false;
  assert.equal(nextTeamModuleCount(1, 9, neverEmpty), 2, 'the 9th agent attaches a module');
  assert.equal(nextTeamModuleCount(2, 17, neverEmpty), 3, 'the 17th agent attaches another');
  assert.equal(nextTeamModuleCount(1, 20, neverEmpty), 3, 'a bulk restore jumps straight to 3');
});

test('does not grow while still under the current capacity', () => {
  assert.equal(
    nextTeamModuleCount(2, 15, () => false),
    2,
  );
  assert.equal(
    nextTeamModuleCount(3, 17, () => false),
    3,
  );
});

test('shrinks one module at a time, outermost (highest ring index) first, only while empty', () => {
  // Ring indexes 3 and 2 (team4, team3) are empty; ring index 1 (team2) is not.
  const emptyIndexes = new Set([3, 2]);
  const isEmpty = (ringIndex: number) => emptyIndexes.has(ringIndex);
  // 4 modules active, only 1 needed by headcount (8 agents), but team2 is
  // occupied, so the line stops there instead of reaching the headcount.
  assert.equal(nextTeamModuleCount(4, 8, isEmpty), 2);
});

test('shrink stops as soon as the next outermost module is occupied', () => {
  // ring index 3 (team4) empty, ring index 2 (team3) occupied: only one module goes.
  const isEmpty = (ringIndex: number) => ringIndex === 3;
  assert.equal(nextTeamModuleCount(4, 8, isEmpty), 3);
});

test('shrink removes every surplus module when each is empty in turn', () => {
  const isEmpty = () => true;
  assert.equal(nextTeamModuleCount(4, 5, isEmpty), 1);
});

test('shrink never goes below what the headcount needs, even if everything is empty', () => {
  const isEmpty = () => true;
  assert.equal(nextTeamModuleCount(4, 12, isEmpty), 2);
});

test('a module with someone seated or resting in it is never removed', () => {
  assert.equal(
    nextTeamModuleCount(2, 5, () => false),
    2,
    'team2 occupied, stays at 2 modules',
  );
});
