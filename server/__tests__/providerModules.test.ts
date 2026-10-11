import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MultiplexedAgent, MultiplexerModule } from '../../core/src/provider.js';
import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { FILE_WATCHER_POLL_INTERVAL_MS, TRANSCRIPT_FOLLOW_RETRY_MS } from '../src/constants.js';
import { claudeModule } from '../src/providers/claude/claude.js';
import { ompModule } from '../src/providers/omp/omp.js';
import { SESSION_POLL_INTERVAL_MS } from '../src/providers/sessionStore/constants.js';
import { PixelAgentsServer } from '../src/server.js';

// omp's session store and the server's ~/.pixel-agents/ both resolve against the home directory.
let tmpHome: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpHome };
});

type Message = Record<string, unknown>;

const userPrompt = { type: 'message', message: { role: 'user' } };
const turnEnded = { type: 'message', message: { role: 'assistant', stopReason: 'stop' } };
const sessionExit = { type: 'custom', customType: 'session_exit', data: { reason: 'dispose' } };
function toolStart(toolCallId: string, toolName: string, args: Record<string, unknown>) {
  return {
    type: 'custom',
    customType: 'tool_execution_start',
    data: { toolCallId, toolName, args },
  };
}

function jsonl(records: object[]): string {
  return records.map((r) => `${JSON.stringify(r)}\n`).join('');
}

/** Write an omp transcript into omp's session store under the test home, laid out as omp writes it: a padded
 *  `title` record (rewritten in place), then the `session` header, then the records. */
function ompSession(name: string, cwd: string, records: object[]): string {
  const dir = path.join(tmpHome, '.omp', 'agent', 'sessions', `-${path.basename(cwd)}`);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.jsonl`);
  const title = { type: 'title', v: 1, title: name, source: 'auto', pad: ' '.repeat(64) };
  fs.writeFileSync(file, jsonl([title, { type: 'session', id: name, cwd }, ...records]));
  return file;
}

/** A multiplexer whose snapshots the test publishes. */
function fakeMultiplexer(): {
  module: MultiplexerModule;
  publish(agents: MultiplexedAgent[]): void;
} {
  let onSnapshot: (agents: readonly MultiplexedAgent[]) => void = () => {};
  return {
    module: {
      kind: 'multiplexer',
      id: 'herdr',
      displayName: 'Fake herdr',
      connect(callback) {
        onSnapshot = callback;
        return { connected: Promise.resolve(true), stop: () => {} };
      },
    },
    publish: (agents) => onSnapshot(agents),
  };
}

function pane(overrides: Partial<MultiplexedAgent> = {}): MultiplexedAgent {
  return {
    paneId: 'p1',
    agentKind: 'omp',
    status: 'working',
    cwd: path.join(os.tmpdir(), 'pxl-untracked-pane'),
    name: 'alpha',
    task: 'Ship the release',
    ...overrides,
  };
}

describe('provider modules', () => {
  let store: AgentStateStore;
  let runtime: AgentRuntime | undefined;
  let messages: Message[];

  const ofType = (type: string) => messages.filter((m) => m.type === type);
  const onlyAgentId = (): number => {
    expect(store.size).toBe(1);
    return [...store.keys()][0];
  };

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-modules-'));
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    store = new AgentStateStore();
    messages = [];
    store.on('broadcast', (m) => messages.push(m as Message));
  });

  afterEach(() => {
    runtime?.dispose();
    runtime = undefined;
    vi.useRealTimers();
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  describe('agent only: omp, no multiplexer', () => {
    it('a running omp session appears with its tool activity and goes idle when its turn ends', () => {
      const file = ompSession('live', '/work/monopoly', [userPrompt]);
      runtime = new AgentRuntime(store, { agents: [ompModule], multiplexers: [] });
      runtime.startModules();

      const id = onlyAgentId();
      expect(store.get(id)?.folderName).toBe('monopoly');

      fs.appendFileSync(file, jsonl([toolStart('t1', 'read', { path: '/work/monopoly/PLAN.md' })]));
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentToolStart')).toContainEqual(
        expect.objectContaining({ id, status: 'Reading PLAN.md', toolName: 'read' }),
      );

      fs.appendFileSync(file, jsonl([turnEnded]));
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentStatus').at(-1)).toMatchObject({ id, status: 'waiting' });

      fs.appendFileSync(file, jsonl([sessionExit]));
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(store.size).toBe(0);
    });

    it('never replays history, and leaves sessions that already exited off the floor', () => {
      ompSession('exited', '/work/old', [toolStart('old', 'bash', { command: 'ls' }), sessionExit]);
      ompSession('idle', '/work/idle', [toolStart('old', 'bash', { command: 'ls' }), turnEnded]);
      runtime = new AgentRuntime(store, { agents: [ompModule], multiplexers: [] });
      runtime.startModules();
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS * 3);

      const id = onlyAgentId();
      expect(store.get(id)?.folderName).toBe('idle');
      expect(ofType('agentToolStart')).toEqual([]);
    });
  });

  describe('multiplexer only: herdr, omp module disabled', () => {
    it('every hosted agent appears with its status, name and task, and never with tool activity', () => {
      const mux = fakeMultiplexer();
      const file = ompSession('in-pane', '/work/alpha', [userPrompt]);
      runtime = new AgentRuntime(store, { agents: [], multiplexers: [mux.module] });
      runtime.startModules();

      mux.publish([pane({ sessionRef: file })]);
      const id = onlyAgentId();
      expect(ofType('agentInfo').at(-1)).toMatchObject({
        id,
        name: 'alpha',
        task: 'Ship the release',
      });
      expect(ofType('agentStatus').at(-1)).toMatchObject({ id, status: 'active' });

      fs.appendFileSync(file, jsonl([toolStart('t1', 'read', { path: 'PLAN.md' })]));
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS * 3);
      expect(ofType('agentToolStart')).toEqual([]);

      mux.publish([pane({ sessionRef: file, status: 'blocked' })]);
      expect(ofType('agentToolPermission')).toContainEqual({ type: 'agentToolPermission', id });
      mux.publish([pane({ sessionRef: file, status: 'idle' })]);
      expect(ofType('agentStatus').at(-1)).toMatchObject({ id, status: 'waiting' });

      mux.publish([]);
      expect(store.size).toBe(0);
    });
  });

  describe('both: herdr and omp', () => {
    it('an omp session in a pane is one character with omp tool activity and the pane name, task and approval', () => {
      const mux = fakeMultiplexer();
      const inPane = ompSession('in-pane', '/work/alpha', [userPrompt]);
      const outside = ompSession('outside', '/work/beta', [turnEnded]);
      runtime = new AgentRuntime(store, { agents: [ompModule], multiplexers: [mux.module] });
      runtime.startModules();
      expect(store.size).toBe(2);

      mux.publish([pane({ sessionRef: inPane })]);
      expect(store.size).toBe(2);
      const paneAgent = [...store].find(([, a]) => a.sessionRef === fs.realpathSync(inPane));
      const outsideAgent = [...store].find(([, a]) => a.sessionRef === fs.realpathSync(outside));
      expect(outsideAgent).toBeDefined();
      const id = paneAgent![0];
      expect(ofType('agentInfo').at(-1)).toMatchObject({ id, name: 'alpha' });

      fs.appendFileSync(inPane, jsonl([toolStart('t1', 'edit', { path: 'src/app.ts' })]));
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentToolStart')).toEqual([
        expect.objectContaining({ id, status: 'Editing app.ts' }),
      ]);

      mux.publish([pane({ sessionRef: inPane, status: 'blocked' })]);
      expect(ofType('agentToolPermission')).toEqual([{ type: 'agentToolPermission', id }]);
    });

    it('a pane reported before omp discovers its session still renders once', () => {
      const mux = fakeMultiplexer();
      runtime = new AgentRuntime(store, { agents: [ompModule], multiplexers: [mux.module] });
      runtime.startModules();
      expect(store.size).toBe(0);

      const file = ompSession('fresh', '/work/gamma', [userPrompt]);
      mux.publish([pane({ paneId: 'p9', name: 'gamma', sessionRef: file })]);
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS * 5); // several discovery scans find the same file

      const id = onlyAgentId();
      expect(store.get(id)?.folderName).toBe('gamma');
    });
  });

  describe('both: herdr and claude', () => {
    it('a Claude pane herdr names by session id is one character with its transcript tool activity, gone with the pane', () => {
      const mux = fakeMultiplexer();
      const sessionId = '0b5e7c1e-4a2d-4c36-9f0e-1d2c3b4a5f60';
      const dir = path.join(tmpHome, '.claude', 'projects', '-work-delta');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${sessionId}.jsonl`);
      runtime = new AgentRuntime(store, { agents: [claudeModule], multiplexers: [mux.module] });
      runtime.startModules();

      // Claude creates the transcript only once its first record is written, after the pane appeared.
      mux.publish([pane({ agentKind: 'claude', name: 'delta', sessionRef: sessionId })]);
      fs.writeFileSync(file, jsonl([{ type: 'user', message: { role: 'user', content: 'go' } }]));
      vi.advanceTimersByTime(TRANSCRIPT_FOLLOW_RETRY_MS);
      mux.publish([pane({ agentKind: 'claude', name: 'delta', sessionRef: sessionId })]);
      const id = onlyAgentId();
      expect(store.get(id)?.jsonlFile).toBe(fs.realpathSync(file));
      expect(ofType('agentInfo').at(-1)).toMatchObject({ id, name: 'delta' });

      fs.appendFileSync(
        file,
        jsonl([
          {
            type: 'assistant',
            message: {
              role: 'assistant',
              content: [
                { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/w/a.ts' } },
              ],
            },
          },
        ]),
      );
      vi.advanceTimersByTime(FILE_WATCHER_POLL_INTERVAL_MS * 2);
      expect(onlyAgentId()).toBe(id);
      expect(ofType('agentToolStart')).toContainEqual(
        expect.objectContaining({ id, status: 'Reading a.ts', toolName: 'Read' }),
      );

      mux.publish([pane({ agentKind: 'claude', sessionRef: sessionId, status: 'blocked' })]);
      expect(ofType('agentToolPermission')).toContainEqual(
        expect.objectContaining({ type: 'agentToolPermission', id }),
      );

      mux.publish([]);
      expect(store.size).toBe(0);
    });
  });

  describe('Claude beside other modules', () => {
    it('a hook posted to /api/hooks/claude is normalized by Claude whichever modules are enabled beside it', async () => {
      vi.useRealTimers();
      const mux = fakeMultiplexer();
      runtime = new AgentRuntime(store, {
        agents: [claudeModule, ompModule],
        multiplexers: [mux.module],
      });
      const server = new PixelAgentsServer();
      const activeRuntime = runtime;
      server.onHookEvent((providerId, event) => activeRuntime.handleHookEvent(providerId, event));
      const config = await server.start({ store, runtime });
      const post = (providerId: string, body: Message) =>
        fetch(`http://127.0.0.1:${config.port}/api/hooks/${providerId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` },
          body: JSON.stringify(body),
        });
      const readHook = (sessionId: string) => ({
        hook_event_name: 'PreToolUse',
        session_id: sessionId,
        tool_name: 'Read',
        tool_input: { file_path: '/work/delta/notes.md' },
      });
      try {
        // omp has no hook API: a payload on its route is dropped, not handed to another normalizer.
        await post('omp', {
          hook_event_name: 'SessionStart',
          session_id: 'on-omp',
          cwd: '/work/delta',
        });
        await post('omp', readHook('on-omp'));
        expect(store.size).toBe(0);

        await post('claude', {
          hook_event_name: 'SessionStart',
          session_id: 'claude-1',
          cwd: '/work/delta',
        });
        await post('claude', readHook('claude-1'));
        const id = onlyAgentId();
        expect(ofType('agentToolStart')).toContainEqual(
          expect.objectContaining({ id, status: 'Reading notes.md', toolName: 'Read' }),
        );
      } finally {
        server.stop();
      }
    });
  });
});
