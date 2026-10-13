import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StateAdapter } from '../../core/src/adapter.js';
import { CHAR_COUNT } from '../../core/src/assets/constants.js';
import type {
  AgentModule,
  ModuleHost,
  RestoredSession,
  RunningAgentModule,
} from '../../core/src/provider.js';
import type { PersistedAgent } from '../../core/src/schemas.js';
import { AgentEventHandler } from '../src/agentEventHandler.js';
import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';

function createMockAdapter(initial: PersistedAgent[] = []): StateAdapter & {
  saved: PersistedAgent[][];
} {
  let current = initial;
  const saved: PersistedAgent[][] = [];
  return {
    saved,
    loadAgents: () => current,
    saveAgents: (agents) => {
      current = agents;
      saved.push(agents);
    },
    loadSeats: () => ({}),
    saveSeats: () => {},
    getSetting: <T>(_key: string, defaultValue: T): T => defaultValue,
    setSetting: vi.fn<(key: string, value: unknown) => void>(),
  };
}

/** An agent module that resumes every session handed back to it, except the refs listed as gone. */
function resumingModule(gone: ReadonlySet<string> = new Set()): {
  module: AgentModule;
  restored: RestoredSession[];
} {
  const restored: RestoredSession[] = [];
  let next = 0;
  const module: AgentModule = {
    kind: 'agent',
    id: 'fake-cli',
    displayName: 'Fake CLI',
    protocolVersion: AgentEventHandler.SUPPORTED_PROTOCOL_VERSION,
    formatToolStatus: (toolName) => toolName,
    permissionExemptTools: new Set(),
    subagentToolNames: new Set(),
    readingTools: new Set(),
    start(host: ModuleHost): RunningAgentModule {
      return {
        followSession: () => ({ stop: () => {} }),
        restoreSession(session) {
          restored.push(session);
          if (gone.has(session.sessionRef)) return;
          host.emit(`fake-${next++}`, {
            kind: 'sessionStart',
            live: true,
            sessionRef: session.sessionRef,
          });
        },
        stop: () => {},
      };
    },
  };
  return { module, restored };
}

/**
 * Restored agents keep their id (and so their seat), palette and hueShift across server restarts: the runtime hands
 * each persisted agent back to its module, and the session the module resumes gets the persisted agent back.
 */
describe('AgentRuntime -- restore through the agent module', () => {
  let runtime: AgentRuntime | undefined;

  afterEach(() => {
    runtime?.dispose();
    runtime = undefined;
  });

  function startWith(persisted: PersistedAgent[], gone?: ReadonlySet<string>) {
    const store = new AgentStateStore();
    const adapter = createMockAdapter(persisted);
    store.setAdapter(adapter);
    const { module, restored } = resumingModule(gone);
    runtime = new AgentRuntime(store, { agents: [module], multiplexers: [] });
    runtime.startModules();
    return { store, adapter, restored };
  }

  it('gives a resumed session its persisted id, palette and hueShift', () => {
    const { store } = startWith([
      { id: 7, providerId: 'fake-cli', sessionRef: 'sess-restore', palette: 3, hueShift: 90 },
    ]);

    const agent = store.get(7);
    expect(agent?.sessionRef).toBe('sess-restore');
    expect(agent?.palette).toBe(3);
    expect(agent?.hueShift).toBe(90);
  });

  it('persist() writes palette/hueShift onto the record the next start restores', () => {
    const first = startWith([]);
    first.store.set(42, {
      id: 42,
      sessionId: 'k',
      providerId: 'fake-cli',
      sessionRef: 'sess-rt',
      machineId: 'local',
      activeToolIds: new Set(),
      activeToolStatuses: new Map(),
      activeToolNames: new Map(),
      activeSubagentToolIds: new Map(),
      backgroundToolIds: new Set(),
      teammateSpawnToolIds: new Set(),
      isWaiting: false,
      permissionSent: false,
      contextTokens: 0,
      maxContextTokens: 200_000,
      palette: 5,
      hueShift: 270,
    });
    first.store.persist();
    runtime!.dispose();
    runtime = undefined;

    const persisted = first.adapter.loadAgents();
    const { store } = startWith(persisted);
    const restored = store.get(42);
    expect(restored?.palette).toBe(5);
    expect(restored?.hueShift).toBe(270);
  });

  it('assigns a fresh palette when the persisted record has no palette', () => {
    const { store } = startWith([{ id: 9, providerId: 'fake-cli', sessionRef: 'sess-fresh' }]);

    const agent = store.get(9);
    expect(agent?.palette).toBeGreaterThanOrEqual(0);
    expect(agent?.palette).toBeLessThan(CHAR_COUNT);
    expect(agent?.hueShift).toBe(0);
  });

  it('hands leads back before their teammates, naming the lead by its session ref', () => {
    const { restored } = startWith([
      {
        id: 2,
        providerId: 'fake-cli',
        sessionRef: '/mate.jsonl',
        team: { teamName: 'crew', agentName: 'scout', leadAgentId: 1 },
        backgroundToolIds: ['bg'],
      },
      {
        id: 1,
        providerId: 'fake-cli',
        sessionRef: 'lead',
        team: { teamName: 'crew', isTeamLead: true },
      },
    ]);
    expect(restored).toEqual([
      {
        sessionRef: 'lead',
        team: { teamName: 'crew', isTeamLead: true, leadSessionRef: undefined },
        backgroundToolIds: [],
      },
      {
        sessionRef: '/mate.jsonl',
        team: { teamName: 'crew', agentName: 'scout', leadSessionRef: 'lead' },
        backgroundToolIds: ['bg'],
      },
    ]);
  });

  it('drops agents whose session is gone or whose module is not running, and never reuses their ids', () => {
    const { store } = startWith(
      [
        { id: 3, providerId: 'fake-cli', sessionRef: 'ended' },
        { id: 5, providerId: 'not-enabled', sessionRef: 'other' },
      ],
      new Set(['ended']),
    );
    expect(store.size).toBe(0);
    expect(store.nextAgentId.current).toBe(6);
  });

  it('restores persisted agents when another module persists a session it discovers while starting', () => {
    const store = new AgentStateStore();
    store.setAdapter(
      createMockAdapter([{ id: 4, providerId: 'fake-cli', sessionRef: 'kept', palette: 2 }]),
    );
    const { module: resuming } = resumingModule();
    const eager: AgentModule = {
      ...resuming,
      id: 'eager-cli',
      displayName: 'Eager CLI',
      start(host: ModuleHost): RunningAgentModule {
        host.emit('eager-0', { kind: 'sessionStart', live: true, sessionRef: 'eager-ref' });
        return { followSession: () => ({ stop: () => {} }), stop: () => {} };
      },
    };
    runtime = new AgentRuntime(store, { agents: [eager, resuming], multiplexers: [] });
    runtime.startModules();

    expect(store.get(4)).toMatchObject({ sessionRef: 'kept', palette: 2 });
    expect([...store.values()].find((a) => a.sessionRef === 'eager-ref')?.id).toBe(5);
  });

  it('dispose keeps the persisted agents for the next start', () => {
    const { adapter } = startWith([{ id: 4, providerId: 'fake-cli', sessionRef: 'kept' }]);
    runtime!.dispose();
    runtime = undefined;
    expect(adapter.loadAgents()).toEqual([
      expect.objectContaining({ id: 4, providerId: 'fake-cli', sessionRef: 'kept' }),
    ]);
  });
});
