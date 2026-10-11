import * as fs from 'fs';
import type * as OsModule from 'os';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AgentEvent,
  ModuleHost,
  MultiplexedAgent,
  MultiplexerEndpoint,
  MultiplexerModule,
  MultiplexerWatcher,
} from '../../core/src/provider.js';

let tmpHome: string;

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof OsModule>('os');
  return { ...actual, homedir: () => tmpHome };
});

const { MultiplexerConnections } = await import('../src/multiplexerConnections.js');
const { parseNewConnection, parseStoredConnection } = await import('../src/connectionSettings.js');
const { readConnections } = await import('../src/configPersistence.js');

/** A multiplexer with one controllable link per endpoint id. */
function fakeMultiplexer(probeError?: (endpoint: MultiplexerEndpoint) => string | undefined): {
  module: MultiplexerModule;
  links: Map<string, MultiplexerWatcher>;
  probed: MultiplexerEndpoint[];
} {
  const links = new Map<string, MultiplexerWatcher>();
  const probed: MultiplexerEndpoint[] = [];
  return {
    module: {
      kind: 'multiplexer',
      id: 'herdr',
      displayName: 'Fake herdr',
      connect: (endpoint, watcher) => {
        links.set(endpoint.id, watcher);
        watcher.onState('connecting');
        return { stop: () => links.delete(endpoint.id) };
      },
      probe: (endpoint) => {
        probed.push(endpoint);
        return Promise.resolve(probeError?.(endpoint));
      },
    },
    links,
    probed,
  };
}

function pane(paneId: string, name = 'alpha'): MultiplexedAgent {
  return { paneId, agentKind: 'codex', status: 'working', cwd: '/w', name, task: '' };
}

function setUp(probeError?: (endpoint: MultiplexerEndpoint) => string | undefined) {
  const mux = fakeMultiplexer(probeError);
  const emitted: { sessionId: string; event: AgentEvent }[] = [];
  const host: ModuleHost = {
    emit: (sessionId, event) => emitted.push({ sessionId, event }),
    log: () => {},
  };
  const connections = new MultiplexerConnections({
    multiplexers: [mux.module],
    hostFor: () => host,
    agentModules: new Map(),
  });
  let changes = 0;
  connections.onChange(() => changes++);
  connections.start();
  return { mux, emitted, connections, changes: () => changes };
}

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-conn-'));
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe('MultiplexerConnections', () => {
  it("listens to this machine's default herdr session when none were ever configured", () => {
    const { mux, connections } = setUp();

    expect(connections.list()).toEqual([
      expect.objectContaining({ id: 'local', kind: 'local', enabled: true, state: 'connecting' }),
    ]);
    expect([...mux.links.keys()]).toEqual(['local']);
  });

  it("reports each link's state and error text, and tells listeners only when it changes", () => {
    const { mux, connections, changes } = setUp();
    const link = mux.links.get('local');

    link?.onState('error', 'no herdr socket');
    link?.onState('error', 'no herdr socket');

    expect(connections.list()[0]).toMatchObject({ state: 'error', message: 'no herdr socket' });
    expect(changes()).toBe(1);
  });

  it('saves and starts a connection only once its probe answered', async () => {
    const { mux, connections } = setUp();

    const error = await connections.add({ label: 'Build box', kind: 'ssh', target: 'buildbox' });

    expect(error).toBeUndefined();
    const added = connections.list()[1];
    expect(mux.probed).toEqual([
      { id: added.id, kind: 'ssh', target: 'buildbox', session: undefined },
    ]);
    expect(mux.links.has(added.id)).toBe(true);
    expect(readConnections().map((c) => c.id)).toEqual(['local', added.id]);
  });

  it('saves nothing when the probe fails, and returns its error text', async () => {
    const { mux, connections } = setUp(() => 'ssh: Could not resolve hostname nowhere');

    const error = await connections.add({ label: 'Nowhere', kind: 'ssh', target: 'nowhere' });

    expect(error).toBe('ssh: Could not resolve hostname nowhere');
    expect(connections.list()).toHaveLength(1);
    expect(mux.links.size).toBe(1);
    expect(fs.existsSync(path.join(tmpHome, '.pixel-agents', 'config.json'))).toBe(false);
  });

  it('refuses a second connection to the same herdr server without probing it', async () => {
    const { mux, connections } = setUp();

    const error = await connections.add({ label: 'Again', kind: 'local' });

    expect(error).toBe('Already listening to that herdr server as "This machine"');
    expect(mux.probed).toEqual([]);
  });

  it('turning a connection off ends its characters and its link, turning it on starts it again', () => {
    const { mux, connections, emitted } = setUp();
    mux.links.get('local')?.onState('connected');
    mux.links.get('local')?.onSnapshot([pane('w1:p1')]);

    expect(connections.update('local', { enabled: false })).toBeUndefined();

    expect(mux.links.has('local')).toBe(false);
    expect(emitted.at(-1)).toEqual({
      sessionId: 'herdr-local-w1:p1',
      event: { kind: 'sessionEnd', reason: 'exit' },
    });
    expect(connections.list()[0]).toMatchObject({ enabled: false, state: 'disabled' });

    connections.update('local', { enabled: true });
    expect(mux.links.has('local')).toBe(true);
  });

  it('renames the characters of a running connection that names its machine', async () => {
    const { mux, connections, emitted } = setUp();
    await connections.add({ label: 'Build box', kind: 'ssh', target: 'buildbox' });
    const id = connections.list()[1].id;
    const link = mux.links.get(id);
    link?.onState('connected');
    link?.onSnapshot([pane('w1:p1')]);

    connections.update(id, { label: 'CI' });
    link?.onSnapshot([pane('w1:p1')]);

    const names = emitted.flatMap((e) => (e.event.kind === 'sessionInfo' ? [e.event.name] : []));
    expect(names).toEqual(['alpha @Build box', 'alpha @CI']);
  });

  it('rejects an invalid label and an unknown id without changing anything', () => {
    const { connections } = setUp();

    expect(connections.update('local', { label: '   ' })).toBe('Give the connection a label');
    expect(connections.update('nope', { enabled: false })).toBe('No connection nope');
    expect(connections.remove('nope')).toBe('No connection nope');
    expect(connections.list()[0]).toMatchObject({ label: 'This machine', enabled: true });
  });

  it('removing a connection stops it and forgets it for good', () => {
    const { mux, connections } = setUp();

    expect(connections.remove('local')).toBeUndefined();

    expect(mux.links.size).toBe(0);
    expect(connections.list()).toEqual([]);
    expect(readConnections()).toEqual([]);
  });

  it('reads connections back after a restart, starting only the enabled ones', async () => {
    const first = setUp();
    await first.connections.add({ label: 'Night', kind: 'local', session: 'night' });
    first.connections.update('local', { enabled: false });
    first.connections.stop();

    const second = setUp();

    expect(second.connections.list()).toEqual([
      expect.objectContaining({ id: 'local', enabled: false, state: 'disabled' }),
      expect.objectContaining({ label: 'Night', session: 'night', enabled: true }),
    ]);
    expect([...second.mux.links.keys()]).toEqual([second.connections.list()[1].id]);
  });
});

describe('connection settings validation', () => {
  it('accepts an SSH target in every form OpenSSH takes', () => {
    for (const target of ['buildbox', 'luc@buildbox', 'ssh://luc@buildbox:2222', '192.168.1.20']) {
      expect(parseNewConnection({ label: 'x', kind: 'ssh', target })).toEqual({
        label: 'x',
        kind: 'ssh',
        target,
        session: undefined,
      });
    }
  });

  it('refuses targets ssh would read as an option or split, and session names that leave their directory', () => {
    expect(parseNewConnection({ label: 'x', kind: 'ssh', target: '-oProxyCommand=sh' })).toEqual({
      error: 'SSH targets cannot start with "-"',
    });
    expect(parseNewConnection({ label: 'x', kind: 'ssh', target: 'a b' })).toEqual({
      error: 'SSH targets cannot contain spaces or control characters',
    });
    expect(parseNewConnection({ label: 'x', kind: 'ssh', target: '' })).toMatchObject({
      error: expect.stringContaining('Enter an SSH target'),
    });
    expect(parseNewConnection({ label: 'x', kind: 'local', session: '../evil' })).toMatchObject({
      error: expect.stringContaining('herdr session names use'),
    });
    expect(parseNewConnection({ label: 'x', kind: 'tcp' })).toEqual({
      error: 'Pick SSH or a local herdr session',
    });
  });

  it('drops a persisted entry whose id could leave the socket directory', () => {
    expect(
      parseStoredConnection({ id: '../x', label: 'x', kind: 'local', enabled: true }),
    ).toBeUndefined();
    expect(parseStoredConnection({ id: 'ok', label: 'x', kind: 'local', enabled: 'yes' })).toBe(
      undefined,
    );
    expect(parseStoredConnection({ id: 'ok', label: 'x', kind: 'local', enabled: true })).toEqual({
      id: 'ok',
      label: 'x',
      kind: 'local',
      session: undefined,
      enabled: true,
    });
  });
});
