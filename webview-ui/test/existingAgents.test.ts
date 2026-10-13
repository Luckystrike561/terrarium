/**
 * Unit tests for the pure `reconcileExistingAgents` decision (issue #334).
 *
 * A restored agent must become a character regardless of whether the
 * `existingAgents` message arrives before or after `layoutLoaded`:
 *   - layout NOT ready → buffer (flushed later by layoutLoaded)
 *   - layout ready     → add immediately (else the agent is stranded, because no
 *                        further layoutLoaded arrives to flush the buffer)
 *
 * Extracted from useExtensionMessages so it is testable without React, mirroring
 * officeCanvasCursor.test.ts (the deliberate e2e-over-unit policy forbids unit
 * tests against the React message handler itself).
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import type {
  ExistingAgentsBuilding,
  ExistingAgentsSnapshot,
  PendingAgent,
} from '../src/office/engine/existingAgents.js';
import { reconcileExistingAgents } from '../src/office/engine/existingAgents.js';

// ── Helpers ────────────────────────────────────────────────────

interface AddAgentCall {
  machineId: string;
  id: number;
  palette?: number;
  hueShift?: number;
  seatId?: string;
  skipSpawnEffect?: boolean;
  folderName?: string;
}

/** A fake building that records addAgent calls, mirroring how officeCanvasCursor
 *  tests inject closures instead of constructing a real Building. */
function fakeBuilding(existing: number[] = []): ExistingAgentsBuilding & { calls: AddAgentCall[] } {
  const ids = new Set(existing);
  const calls: AddAgentCall[] = [];
  return {
    calls,
    getCharacter: (id: number) => (ids.has(id) ? {} : undefined),
    addAgent: (machineId, id, palette, hueShift, seatId, skipSpawnEffect, folderName) => {
      ids.add(id);
      calls.push({ machineId, id, palette, hueShift, seatId, skipSpawnEffect, folderName });
    },
  };
}

function snapshot(
  agents: number[],
  fields: Partial<Omit<ExistingAgentsSnapshot, 'agents'>> = {},
): ExistingAgentsSnapshot {
  return { agents, meta: {}, folderNames: {}, machineIds: {}, ...fields };
}

// ── layout ready → add immediately (the #334 regression) ────────

test('layout ready: adds restored agents immediately with their seat metadata', () => {
  const building = fakeBuilding();
  const pending: PendingAgent[] = [];

  const addedDirectly = reconcileExistingAgents(
    building,
    snapshot([5], {
      meta: { 5: { palette: 2, hueShift: 90, seatId: 'seat-a' } },
      folderNames: { 5: 'alpha' },
      machineIds: { 5: 'local' },
    }),
    true,
    pending,
  );

  assert.equal(addedDirectly, true);
  assert.equal(pending.length, 0, 'nothing should be buffered once the layout is ready');
  assert.deepEqual(building.calls, [
    // skipSpawnEffect must be true so restored agents don't replay the matrix effect.
    {
      machineId: 'local',
      id: 5,
      palette: 2,
      hueShift: 90,
      seatId: 'seat-a',
      skipSpawnEffect: true,
      folderName: 'alpha',
    },
  ]);
});

test('each restored agent lands on the floor of the machine it runs on', () => {
  const building = fakeBuilding();

  reconcileExistingAgents(
    building,
    snapshot([1, 2], { machineIds: { 1: 'local', 2: 'ssh:pi' } }),
    true,
    [],
  );

  assert.deepEqual(
    building.calls.map((c) => [c.id, c.machineId]),
    [
      [1, 'local'],
      [2, 'ssh:pi'],
    ],
  );
});

// ── layout not ready → buffer (preserved original behavior) ─────

test('layout not ready: buffers restored agents for the later layoutLoaded flush', () => {
  const building = fakeBuilding();
  const pending: PendingAgent[] = [];

  const addedDirectly = reconcileExistingAgents(
    building,
    snapshot([5], {
      meta: { 5: { palette: 2, hueShift: 90, seatId: 'seat-a' } },
      folderNames: { 5: 'alpha' },
      machineIds: { 5: 'ssh:vps' },
    }),
    false,
    pending,
  );

  assert.equal(addedDirectly, false);
  assert.equal(building.calls.length, 0, 'no agent should be added before the layout is ready');
  assert.deepEqual(pending, [
    {
      id: 5,
      machineId: 'ssh:vps',
      palette: 2,
      hueShift: 90,
      seatId: 'seat-a',
      folderName: 'alpha',
    },
  ]);
});

// ── idempotence / dedup ─────────────────────────────────────────

test('layout ready: skips an agent that already exists and reports nothing added', () => {
  const building = fakeBuilding([5]); // agent 5 already has a character
  const pending: PendingAgent[] = [];

  const addedDirectly = reconcileExistingAgents(building, snapshot([5]), true, pending);

  assert.equal(addedDirectly, false);
  assert.equal(building.calls.length, 0);
  assert.equal(pending.length, 0);
});

test('layout ready: a mixed roster adds only the missing agent', () => {
  const building = fakeBuilding([5]);

  const addedDirectly = reconcileExistingAgents(building, snapshot([5, 6]), true, []);

  assert.equal(addedDirectly, true);
  assert.deepEqual(
    building.calls.map((c) => c.id),
    [6],
  );
});

// ── missing metadata is tolerated (undefined seat fields) ───────

test('layout ready: agent with no metadata is still added, on the first floor', () => {
  const building = fakeBuilding();

  const addedDirectly = reconcileExistingAgents(building, snapshot([7]), true, []);

  assert.equal(addedDirectly, true);
  assert.deepEqual(building.calls, [
    {
      machineId: 'local',
      id: 7,
      palette: undefined,
      hueShift: undefined,
      seatId: undefined,
      skipSpawnEffect: true,
      folderName: undefined,
    },
  ]);
});
