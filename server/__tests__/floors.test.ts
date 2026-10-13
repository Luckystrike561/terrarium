import * as fs from 'fs';
import type * as OsModule from 'os';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  MultiplexedAgent,
  MultiplexerModule,
  MultiplexerWatcher,
} from '../../core/src/provider.js';

let tmpHome: string;

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof OsModule>('os');
  return { ...actual, homedir: () => tmpHome };
});

// Loaded after vi.mock('os') like the other config-touching suites, so their config.json lands in tmpHome.
const { machineIdOf, listFloors } = await import('../src/floors.js');
const { AgentRuntime } = await import('../src/agentRuntime.js');
const { AgentStateStore } = await import('../src/agentStateStore.js');

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-floors-'));
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

/** The floor id of an SSH connection to `target`. */
function sshFloor(target: string): string {
  return machineIdOf({ kind: 'ssh', target });
}

describe('machineIdOf', () => {
  it('puts every local connection on this machine, whatever its herdr session', () => {
    expect(machineIdOf({ kind: 'local' })).toBe('local');
  });

  it.each([['luc@pi'], ['PI'], ['ssh://pi'], ['ssh://luc@pi:2222'], ['jump@corp@pi']])(
    'reads %s as the host pi',
    (target) => {
      expect(sshFloor(target)).toBe(sshFloor('pi'));
    },
  );

  it('keeps a bare and a bracketed IPv6 address apart from their port', () => {
    expect(sshFloor('ssh://luc@[fe80::1]:2222')).toBe(sshFloor('fe80::1'));
    expect(sshFloor('fe80::1')).not.toBe(sshFloor('fe80::'));
  });

  it('tells two hosts apart', () => {
    expect(sshFloor('pi')).not.toBe(sshFloor('vps'));
  });

  it('never names the host, since every socket sees the id', () => {
    const id = sshFloor('luc@pi.example.com');
    expect(id).not.toMatch(/pi|example/);
  });
});

describe('listFloors', () => {
  it('is this machine alone with only local connections', () => {
    expect(
      listFloors(
        [
          { kind: 'local', label: 'This machine' },
          { kind: 'local', label: 'Night' },
        ],
        'laptop',
      ),
    ).toEqual([{ id: 'local', name: 'laptop' }]);
  });

  it('stacks one floor per other host, in the order its first connection was added, named after it', () => {
    expect(
      listFloors(
        [
          { kind: 'local', label: 'This machine' },
          { kind: 'ssh', target: 'vps', label: 'VPS' },
          { kind: 'ssh', target: 'luc@pi', label: 'Raspberry Pi' },
          { kind: 'ssh', target: 'ssh://pi:2222', label: 'Pi again' },
        ],
        'laptop',
      ),
    ).toEqual([
      { id: 'local', name: 'laptop' },
      { id: sshFloor('vps'), name: 'VPS' },
      { id: sshFloor('pi'), name: 'Raspberry Pi' },
    ]);
  });
});

/** A herdr whose links the test drives: one watcher per connected endpoint id. */
function fakeHerdr(): { module: MultiplexerModule; links: Map<string, MultiplexerWatcher> } {
  const links = new Map<string, MultiplexerWatcher>();
  return {
    module: {
      kind: 'multiplexer',
      id: 'herdr',
      displayName: 'Fake herdr',
      connect: (endpoint, watcher) => {
        links.set(endpoint.id, watcher);
        return { stop: () => links.delete(endpoint.id) };
      },
      probe: () => Promise.resolve(undefined),
    },
    links,
  };
}

function pane(paneId: string): MultiplexedAgent {
  return { paneId, agentKind: 'codex', status: 'working', cwd: '/w', name: paneId, task: '' };
}

describe('AgentRuntime floors', () => {
  function startRuntime() {
    const herdr = fakeHerdr();
    const store = new AgentStateStore();
    const broadcasts: Record<string, unknown>[] = [];
    store.on('broadcast', (message) => broadcasts.push(message));
    const runtime = new AgentRuntime(store, { agents: [], multiplexers: [herdr.module] });
    runtime.startModules();
    const connections = runtime.connections!;
    const floorBroadcasts = () => broadcasts.filter((m) => m.type === 'floorsLoaded');
    /** Bring a connection's link up and show one pane on it. */
    const showPane = (connectionId: string, paneId: string) => {
      const link = herdr.links.get(connectionId)!;
      link.onState('connected');
      link.onSnapshot([pane(paneId)]);
    };
    return { runtime, store, connections, floorBroadcasts, showPane };
  }

  it('adds a floor for a new host, shares it with a second connection there, and drops it with the last one', async () => {
    const { runtime, store, connections, floorBroadcasts, showPane } = startRuntime();
    expect(runtime.floors()).toEqual([{ id: 'local', name: os.hostname() }]);

    await connections.add({ label: 'Pi', kind: 'ssh', target: 'pi' });
    await connections.add({ label: 'Pi night', kind: 'ssh', target: 'luc@pi', session: 'night' });
    const [, first, second] = connections.list();
    expect(floorBroadcasts()).toEqual([
      {
        type: 'floorsLoaded',
        floors: [
          { id: 'local', name: os.hostname() },
          { id: sshFloor('pi'), name: 'Pi' },
        ],
      },
    ]);

    showPane(first.id, 'p1');
    showPane(second.id, 'p2');
    expect([...store.values()].map((agent) => agent.machineId)).toEqual([
      sshFloor('pi'),
      sshFloor('pi'),
    ]);

    connections.remove(first.id);
    expect(floorBroadcasts().at(-1)).toMatchObject({
      floors: [{ id: 'local' }, { id: sshFloor('pi'), name: 'Pi night' }],
    });
    connections.remove(second.id);
    expect(store.size).toBe(0);
    expect(floorBroadcasts().at(-1)).toEqual({
      type: 'floorsLoaded',
      floors: [{ id: 'local', name: os.hostname() }],
    });
    runtime.dispose();
  });

  it("keeps this machine's herdr panes on the first floor", () => {
    const { runtime, store, showPane } = startRuntime();
    showPane('local', 'p1');
    expect([...store.values()].map((agent) => agent.machineId)).toEqual(['local']);
    runtime.dispose();
  });

  it('renames a floor with the connection it is named after', async () => {
    const { runtime, connections, floorBroadcasts } = startRuntime();
    await connections.add({ label: 'VPS', kind: 'ssh', target: 'vps' });
    connections.update(connections.list()[1].id, { label: 'Hermes box' });
    expect(floorBroadcasts().at(-1)).toMatchObject({
      floors: [{ id: 'local' }, { id: sshFloor('vps'), name: 'Hermes box' }],
    });
    runtime.dispose();
  });
});
