import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MultiplexedAgent } from '../../core/src/provider.js';
import {
  HERDR_EVENT_RECONNECT_MS,
  HERDR_RPC_TIMEOUT_MS,
  HERDR_SNAPSHOT_INTERVAL_MS,
} from '../src/providers/herdr/constants.js';
import { HerdrBridge } from '../src/providers/herdr/herdrBridge.js';

interface RawAgentSession {
  kind?: string;
  value?: string;
}

interface RawAgent {
  name?: string;
  agent?: string;
  agent_status?: string;
  cwd?: string;
  foreground_cwd?: string;
  workspace_id?: string;
  tab_id?: string;
  pane_id?: string;
  terminal_title_stripped?: string;
  agent_session?: RawAgentSession | null;
}

interface RawLabeled {
  workspace_id?: string;
  tab_id?: string;
  label?: string;
}

type AgentListMode = 'ok' | 'malformed' | 'hang';

interface FakeHerdrState {
  agents: RawAgent[];
  workspaces: RawLabeled[];
  tabs: RawLabeled[];
  agentListMode: AgentListMode;
}

function defaultState(): FakeHerdrState {
  return { agents: [], workspaces: [], tabs: [], agentListMode: 'ok' };
}

/** paneId-keyed view of a snapshot, for assertions that read a handful of known panes out of it. */
function byPaneId(agents: readonly MultiplexedAgent[]): Record<string, MultiplexedAgent> {
  return Object.fromEntries(agents.map((agent) => [agent.paneId, agent]));
}

/** A herdr stand-in: a JSON-RPC 2.0 server over a unix socket, matching the real one-shot-vs-subscription
 *  connection semantics the bridge depends on. Resolves only once the socket is actually bound, so a caller that
 *  immediately fires a reconnect attempt against it never races the bind. */
async function startFakeHerdr(
  socketPath: string,
  state: FakeHerdrState,
): Promise<{ server: net.Server; liveConnections: () => number }> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {}); // a client that resets mid-reply is not a bridge concern here
    socket.setEncoding('utf8');
    let buffered = '';
    socket.on('data', (chunk: string) => {
      buffered += chunk;
      let idx: number;
      while ((idx = buffered.indexOf('\n')) >= 0) {
        const line = buffered.slice(0, idx);
        buffered = buffered.slice(idx + 1);
        if (!line.trim()) continue;
        let request: { id?: string; method?: string };
        try {
          request = JSON.parse(line) as { id?: string; method?: string };
        } catch {
          continue;
        }
        if (request.method === 'events.subscribe') continue; // long-lived: never replied to, never closed
        const reply = (result: unknown): void => {
          socket.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`);
          socket.end();
        };
        if (request.method === 'agent.list') {
          if (state.agentListMode === 'hang') continue; // simulate an unanswered poll
          reply(
            state.agentListMode === 'malformed' ? { notAgents: true } : { agents: state.agents },
          );
        } else if (request.method === 'workspace.list') {
          reply({ workspaces: state.workspaces });
        } else if (request.method === 'tab.list') {
          reply({ tabs: state.tabs });
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  return { server, liveConnections: () => sockets.size };
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

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-herdr-'));
    socketPath = path.join(tmpDir, 'herdr.sock');
    snapshots = [];
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
      log: () => {},
      onSnapshot: (agents) => {
        snapshots = [...snapshots, agents];
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

    const connected = await connectBridge().start();
    expect(connected).toBe(true);
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

    await connectBridge().start();
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

    await connectBridge().start();
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

    await connectBridge().start();
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

    await connectBridge().start();
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

    await activeBridge.start();
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

    const firstAttempt = await activeBridge.start();
    expect(firstAttempt).toBe(false);
    expect(snapshots).toHaveLength(0);
    await settle(5); // let the 'close' handler (which runs after 'error') schedule the reconnect

    const state = defaultState();
    state.agents = [{ pane_id: 'p1', agent: 'omp', agent_status: 'working' }];
    ({ server } = await startFakeHerdr(socketPath, state));

    await vi.advanceTimersByTimeAsync(HERDR_EVENT_RECONNECT_MS);
    await waitUntil(() => snapshots.length > 0);

    expect(snapshots[0].map((agent) => agent.paneId)).toEqual(['p1']);
  });

  it('stops polling and closes its socket on dispose', async () => {
    const state = defaultState();
    state.agents = [{ pane_id: 'p1', agent: 'omp', agent_status: 'working' }];
    const fake = await startFakeHerdr(socketPath, state);
    server = fake.server;
    const activeBridge = connectBridge();

    await activeBridge.start();
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
});
