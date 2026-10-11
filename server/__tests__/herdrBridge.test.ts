import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MultiplexedAgent, MultiplexerLinkState } from '../../core/src/provider.js';
import {
  HERDR_EVENT_RECONNECT_MS,
  HERDR_RPC_TIMEOUT_MS,
  HERDR_SNAPSHOT_INTERVAL_MS,
} from '../src/providers/herdr/constants.js';
import { HerdrBridge, herdrRequest } from '../src/providers/herdr/herdrBridge.js';
import { defaultState, startFakeHerdr } from './fakeHerdr.js';

/** paneId-keyed view of a snapshot, for assertions that read a handful of known panes out of it. */
function byPaneId(agents: readonly MultiplexedAgent[]): Record<string, MultiplexedAgent> {
  return Object.fromEntries(agents.map((agent) => [agent.paneId, agent]));
}

/** Waits for a real event-loop tick regardless of whether timers are faked, so assertions can follow real socket
 *  I/O that a fake-timer advance only kicked off. */
async function waitUntil(predicate: () => boolean, attempts = 300): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error('condition was never met');
}

/** Lets any already-scheduled real socket I/O (connect/data/close) settle before a negative assertion. */
async function settle(rounds = 50): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

describe('HerdrBridge', () => {
  let tmpDir: string;
  let socketPath: string;
  let server: net.Server | undefined;
  let bridge: HerdrBridge | undefined;
  let snapshots: (readonly MultiplexedAgent[])[];
  let states: { state: MultiplexerLinkState; message?: string }[];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-herdr-'));
    socketPath = path.join(tmpDir, 'herdr.sock');
    snapshots = [];
    states = [];
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  });

  afterEach(async () => {
    bridge?.stop();
    vi.useRealTimers();
    await new Promise<void>((resolve) => {
      if (!server) {
        resolve();
        return;
      }
      server.close(() => resolve());
    });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function connectBridge(): HerdrBridge {
    bridge = new HerdrBridge({
      socketPath,
      watcher: {
        log: () => {},
        onSnapshot: (agents) => {
          snapshots = [...snapshots, agents];
        },
        onState: (state, message) => {
          states = [...states, { state, message }];
        },
      },
    });
    return bridge;
  }

  it('maps agent.list fields into MultiplexedAgent, including the herdr status levels', async () => {
    const state = defaultState();
    state.agents = [
      { pane_id: 'p-working', agent: 'omp', agent_status: 'working', cwd: '/w/alpha' },
      { pane_id: 'p-blocked', agent: 'claude', agent_status: 'blocked', cwd: '/w/beta' },
      { pane_id: 'p-idle', agent: 'codex', agent_status: 'idle', cwd: '/w/gamma' },
      { pane_id: 'p-done', agent: 'claude', agent_status: 'done', cwd: '/w/delta' },
      { pane_id: 'p-unknown', agent: 'claude', agent_status: 'unknown', cwd: '/w/epsilon' },
    ];
    ({ server } = await startFakeHerdr(socketPath, state));

    connectBridge().start();
    await waitUntil(() => states.some((s) => s.state === 'connected'));
    await waitUntil(() => snapshots.length > 0);

    const panes = byPaneId(snapshots[0]);
    expect(panes['p-working']?.status).toBe('working');
    expect(panes['p-blocked']?.status).toBe('blocked');
    expect(panes['p-idle']?.status).toBe('idle');
    // herdr's "done" (finished, waiting on the user) reads as idle, same bucket as an idle pane.
    expect(panes['p-done']?.status).toBe('idle');
    // A status herdr has no agent-facing meaning for ("unknown") is not an agent at all.
    expect(panes['p-unknown']).toBeUndefined();
    expect(panes['p-working']?.agentKind).toBe('omp');
    expect(panes['p-working']?.cwd).toBe('/w/alpha');
  });

  it('names a character from its workspace label, adding #tab only when the workspace hosts several agents', async () => {
    const state = defaultState();
    state.agents = [
      {
        pane_id: 'solo',
        agent: 'omp',
        agent_status: 'working',
        workspace_id: 'ws-solo',
        cwd: '/proj/solo-app',
      },
      {
        pane_id: 'shared-a',
        agent: 'claude',
        agent_status: 'working',
        workspace_id: 'ws-shared',
        tab_id: 'tab-a',
        cwd: '/proj/shared',
      },
      {
        pane_id: 'shared-b',
        agent: 'claude',
        agent_status: 'idle',
        workspace_id: 'ws-shared',
        tab_id: 'tab-b',
        cwd: '/proj/shared',
      },
    ];
    state.workspaces = [{ workspace_id: 'ws-shared', label: 'Shared Workspace' }];
    state.tabs = [
      { tab_id: 'tab-a', label: 'Tab A' },
      { tab_id: 'tab-b', label: 'Tab B' },
    ];
    ({ server } = await startFakeHerdr(socketPath, state));

    connectBridge().start();
    await waitUntil(() => snapshots.length > 0);

    const panes = byPaneId(snapshots[0]);
    // No workspace label and the lone agent in its workspace: falls back to the cwd's basename, no #tab suffix.
    expect(panes['solo']?.name).toBe('solo-app');
    expect(panes['shared-a']?.name).toBe('Shared Workspace #Tab A');
    expect(panes['shared-b']?.name).toBe('Shared Workspace #Tab B');
  });

  it('derives the task from the terminal title, stripping omp and other agents prefixes', async () => {
    const state = defaultState();
    state.agents = [
      {
        pane_id: 'omp-pane',
        agent: 'omp',
        agent_status: 'working',
        terminal_title_stripped: 'π ⠋ ship the release',
      },
      {
        pane_id: 'claude-pane',
        agent: 'claude',
        agent_status: 'working',
        terminal_title_stripped: '● fixing the bug',
      },
    ];
    ({ server } = await startFakeHerdr(socketPath, state));

    connectBridge().start();
    await waitUntil(() => snapshots.length > 0);

    const panes = byPaneId(snapshots[0]);
    expect(panes['omp-pane']?.task).toBe('ship the release');
    expect(panes['claude-pane']?.task).toBe('fixing the bug');
  });

  it('drops a pane whose title has gone back to a shell prompt', async () => {
    const state = defaultState();
    state.agents = [
      {
        pane_id: 'still-agent',
        agent: 'claude',
        agent_status: 'idle',
        terminal_title_stripped: '✓ done',
      },
      {
        pane_id: 'back-to-shell',
        agent: 'claude',
        agent_status: 'idle',
        terminal_title_stripped: 'me@laptop:~/project',
      },
    ];
    ({ server } = await startFakeHerdr(socketPath, state));

    connectBridge().start();
    await waitUntil(() => snapshots.length > 0);

    const paneIds = snapshots[0].map((agent) => agent.paneId);
    expect(paneIds).toContain('still-agent');
    expect(paneIds).not.toContain('back-to-shell');
  });

  it('resolves a path-kind session to the real transcript path and keeps other kinds as the raw session id', async () => {
    const transcriptPath = path.join(tmpDir, 'session.jsonl');
    fs.writeFileSync(transcriptPath, '{}\n');
    const state = defaultState();
    state.agents = [
      {
        pane_id: 'pi-pane',
        agent: 'pi',
        agent_status: 'working',
        agent_session: { kind: 'path', value: transcriptPath },
      },
      {
        pane_id: 'codex-pane',
        agent: 'codex',
        agent_status: 'working',
        agent_session: { kind: 'id', value: 'sess-abc123' },
      },
      { pane_id: 'no-session-pane', agent: 'cline', agent_status: 'working', agent_session: null },
    ];
    ({ server } = await startFakeHerdr(socketPath, state));

    connectBridge().start();
    await waitUntil(() => snapshots.length > 0);

    const panes = byPaneId(snapshots[0]);
    expect(panes['pi-pane']?.sessionRef).toBe(fs.realpathSync(transcriptPath));
    expect(panes['codex-pane']?.sessionRef).toBe('sess-abc123');
    expect(panes['no-session-pane']?.sessionRef).toBeUndefined();
  });

  it('does not publish an empty snapshot for a malformed, refused or unanswered poll, and resumes once a poll succeeds', async () => {
    const state = defaultState();
    state.agents = [{ pane_id: 'p1', agent: 'omp', agent_status: 'working' }];
    ({ server } = await startFakeHerdr(socketPath, state));
    const activeBridge = connectBridge();

    activeBridge.start();
    await waitUntil(() => snapshots.length > 0);
    expect(snapshots).toHaveLength(1);

    // Malformed: the reply exists but has no `agents` array.
    state.agentListMode = 'malformed';
    await vi.advanceTimersByTimeAsync(HERDR_SNAPSHOT_INTERVAL_MS);
    await settle();
    expect(snapshots).toHaveLength(1);

    // Refused: no listener at all for the duration of this poll.
    state.agentListMode = 'ok';
    server.close();
    server = undefined;
    await vi.advanceTimersByTimeAsync(HERDR_SNAPSHOT_INTERVAL_MS);
    await settle();
    expect(snapshots).toHaveLength(1);

    // Unanswered: a listener accepts the connection but never replies to agent.list, so the poll only ends via
    // its own RPC timeout. herdr is allowed to recover before that timeout fires, which is what lets the retry
    // immediately following the timeout pick up a good reply: this covers "unanswered" and "resumes" together.
    ({ server } = await startFakeHerdr(socketPath, state));
    state.agentListMode = 'hang';
    await vi.advanceTimersByTimeAsync(HERDR_SNAPSHOT_INTERVAL_MS);
    expect(snapshots).toHaveLength(1);
    state.agentListMode = 'ok';
    await vi.advanceTimersByTimeAsync(HERDR_RPC_TIMEOUT_MS);
    await waitUntil(() => snapshots.length > 1);
    expect(snapshots[1].map((agent) => agent.paneId)).toEqual(['p1']);
  });

  it('reports herdr as unreachable when its socket does not exist, and recovers once it starts up', async () => {
    const activeBridge = connectBridge(); // no server listening yet

    activeBridge.start();
    await waitUntil(() => states.some((s) => s.state === 'error'));
    expect(states).toEqual([
      { state: 'connecting', message: undefined },
      { state: 'error', message: `no herdr socket at ${socketPath} (is herdr running?)` },
    ]);
    expect(snapshots).toHaveLength(0);

    const state = defaultState();
    state.agents = [{ pane_id: 'p1', agent: 'omp', agent_status: 'working' }];
    ({ server } = await startFakeHerdr(socketPath, state));

    await vi.advanceTimersByTimeAsync(HERDR_EVENT_RECONNECT_MS);
    await waitUntil(() => snapshots.length > 0);

    expect(snapshots[0].map((agent) => agent.paneId)).toEqual(['p1']);
    expect(states.at(-1)?.state).toBe('connected');
  });

  it('stops polling and closes its socket on dispose', async () => {
    const state = defaultState();
    state.agents = [{ pane_id: 'p1', agent: 'omp', agent_status: 'working' }];
    const fake = await startFakeHerdr(socketPath, state);
    server = fake.server;
    const activeBridge = connectBridge();

    activeBridge.start();
    await waitUntil(() => snapshots.length > 0);
    await waitUntil(() => fake.liveConnections() === 1); // only the long-lived events socket remains open

    activeBridge.stop();
    await waitUntil(() => fake.liveConnections() === 0);

    const snapshotCountAtStop = snapshots.length;
    state.agents = [
      { pane_id: 'p1', agent: 'omp', agent_status: 'working' },
      { pane_id: 'p2', agent: 'omp', agent_status: 'working' },
    ];
    await vi.advanceTimersByTimeAsync(HERDR_EVENT_RECONNECT_MS);
    await vi.advanceTimersByTimeAsync(HERDR_EVENT_RECONNECT_MS);
    await settle();
    expect(snapshots).toHaveLength(snapshotCountAtStop);
  });

  it('reads as connected only once herdr answers the subscription, not when the socket merely accepts', async () => {
    const state = defaultState();
    state.subscribeMode = 'hangUp';
    ({ server } = await startFakeHerdr(socketPath, state));

    connectBridge().start();
    await waitUntil(() => states.length > 1);

    expect(states).toEqual([
      { state: 'connecting', message: undefined },
      { state: 'error', message: 'herdr closed the connection without answering' },
    ]);
    expect(snapshots).toHaveLength(0);
  });

  it("reports a refused subscription with herdr's own error text", async () => {
    const state = defaultState();
    state.subscribeMode = 'refuse';
    ({ server } = await startFakeHerdr(socketPath, state));

    connectBridge().start();
    await waitUntil(() => states.length > 1);

    expect(states.at(-1)).toEqual({
      state: 'error',
      message: 'herdr refused the request: no events here',
    });
  });

  it('reads as reconnecting when a working connection is lost, and connected again once herdr is back', async () => {
    const state = defaultState();
    state.agents = [{ pane_id: 'p1', agent: 'omp', agent_status: 'working' }];
    const fake = await startFakeHerdr(socketPath, state);
    server = fake.server;
    connectBridge().start();
    await waitUntil(() => snapshots.length > 0);

    fake.closeAll();
    await new Promise<void>((resolve) => fake.server.close(() => resolve()));
    await waitUntil(() => states.at(-1)?.state === 'reconnecting');
    expect(states.at(-1)?.message).toBe('herdr closed the connection');

    ({ server } = await startFakeHerdr(socketPath, state));
    await vi.advanceTimersByTimeAsync(HERDR_EVENT_RECONNECT_MS);
    await waitUntil(() => states.at(-1)?.state === 'connected');
  });
});

describe('herdrRequest', () => {
  let tmpDir: string;
  let socketPath: string;
  let server: net.Server | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-herdr-rpc-'));
    socketPath = path.join(tmpDir, 'herdr.sock');
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns herdr's result for an answered request", async () => {
    ({ server } = await startFakeHerdr(socketPath, defaultState()));

    expect(await herdrRequest(socketPath, 'ping', HERDR_RPC_TIMEOUT_MS)).toEqual({
      result: { type: 'pong' },
    });
  });

  it('explains a missing socket instead of resolving with nothing', async () => {
    expect(await herdrRequest(socketPath, 'ping', HERDR_RPC_TIMEOUT_MS)).toEqual({
      error: `no herdr socket at ${socketPath} (is herdr running?)`,
    });
  });

  it('gives up on a request herdr never answers', async () => {
    const state = defaultState();
    state.agentListMode = 'hang';
    ({ server } = await startFakeHerdr(socketPath, state));
    const timeoutMs = 50;

    expect(await herdrRequest(socketPath, 'agent.list', timeoutMs)).toEqual({
      error: `herdr did not answer agent.list within ${timeoutMs} ms`,
    });
  });
});
