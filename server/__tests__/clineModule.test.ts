import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MultiplexedAgent, MultiplexerModule } from '../../core/src/provider.js';
import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { clineModule } from '../src/providers/cline/cline.js';
import { SESSION_POLL_INTERVAL_MS } from '../src/providers/sessionStore/constants.js';

// Cline's session store and the server's ~/.pixel-agents/ both resolve against the home directory.
let tmpHome: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpHome };
});

type Message = Record<string, unknown>;

function userPrompt(text = 'do it') {
  return { id: 'u1', role: 'user', content: [{ type: 'text', text }] };
}
function toolUse(toolId: string, name: string, input: Record<string, unknown>) {
  return {
    id: 'a1',
    role: 'assistant',
    ts: 1,
    content: [{ type: 'tool_use', id: toolId, name, input }],
  };
}
function toolResult(toolId: string) {
  return {
    id: 'u2',
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: toolId, content: 'ok', is_error: false }],
  };
}
function turnDone(text = 'done') {
  return {
    id: 'a2',
    role: 'assistant',
    ts: 2,
    metrics: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0 },
    content: [{ type: 'text', text }],
  };
}

function sessionDir(sessionId: string): string {
  return path.join(tmpHome, '.cline', 'data', 'sessions', sessionId);
}

function writeManifest(sessionId: string, cwd: string, status = 'running'): void {
  const dir = sessionDir(sessionId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${sessionId}.json`),
    JSON.stringify({
      version: 1,
      session_id: sessionId,
      source: 'cli',
      status,
      cwd,
      workspace_root: cwd,
    }),
  );
}

function writeMessages(sessionId: string, messages: object[]): string {
  const dir = sessionDir(sessionId);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${sessionId}.messages.json`);
  fs.writeFileSync(file, JSON.stringify({ version: 1, sessionId, agent: 'lead', messages }));
  return file;
}

/** Write a Cline session into its session store under the test home: a manifest beside a whole-file transcript,
 *  laid out as Cline writes them. */
function clineSession(
  sessionId: string,
  cwd: string,
  messages: object[],
  status = 'running',
): string {
  writeManifest(sessionId, cwd, status);
  return writeMessages(sessionId, messages);
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
    agentKind: 'cline',
    status: 'working',
    cwd: path.join(os.tmpdir(), 'pxl-untracked-pane'),
    name: 'alpha',
    task: 'Ship the release',
    ...overrides,
  };
}

describe('cline module', () => {
  let store: AgentStateStore;
  let runtime: AgentRuntime | undefined;
  let messages: Message[];

  const ofType = (type: string) => messages.filter((m) => m.type === type);
  const onlyAgentId = (): number => {
    expect(store.size).toBe(1);
    return [...store.keys()][0];
  };

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-cline-'));
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

  describe('agent only: cline, no multiplexer', () => {
    it('a running session appears by folder name, shows tool activity, goes idle at turn end, and clears on a terminal manifest status', () => {
      const file = clineSession('sess-live', '/work/monopoly', [userPrompt()]);
      runtime = new AgentRuntime(store, { agents: [clineModule], multiplexers: [] });
      runtime.startModules();

      const id = onlyAgentId();
      expect(store.get(id)?.folderName).toBe('monopoly');

      fs.writeFileSync(
        file,
        JSON.stringify({
          version: 1,
          sessionId: 'sess-live',
          agent: 'lead',
          messages: [
            userPrompt(),
            toolUse('t1', 'read_files', { files: [{ path: '/work/monopoly/PLAN.md' }] }),
          ],
        }),
      );
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentToolStart')).toContainEqual(
        expect.objectContaining({ id, status: 'Reading PLAN.md', toolName: 'read_files' }),
      );

      fs.writeFileSync(
        file,
        JSON.stringify({
          version: 1,
          sessionId: 'sess-live',
          agent: 'lead',
          messages: [
            userPrompt(),
            toolUse('t1', 'read_files', { files: [{ path: '/work/monopoly/PLAN.md' }] }),
            toolResult('t1'),
            turnDone(),
          ],
        }),
      );
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentStatus').at(-1)).toMatchObject({ id, status: 'waiting' });

      writeManifest('sess-live', '/work/monopoly', 'completed');
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(store.size).toBe(0);
    });

    it('never replays history, and leaves sessions whose manifest already reports a terminal status off the floor', () => {
      clineSession(
        'sess-exited',
        '/work/old',
        [toolUse('t0', 'run_commands', { commands: ['ls'] }), toolResult('t0'), turnDone()],
        'completed',
      );
      clineSession(
        'sess-idle',
        '/work/idle',
        [toolUse('t0', 'run_commands', { commands: ['ls'] }), toolResult('t0'), turnDone()],
        'running',
      );
      runtime = new AgentRuntime(store, { agents: [clineModule], multiplexers: [] });
      runtime.startModules();
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS * 3);

      const id = onlyAgentId();
      expect(store.get(id)?.folderName).toBe('idle');
      expect(ofType('agentToolStart')).toEqual([]);
    });
  });

  describe('both: herdr and cline, no session ref', () => {
    it('a pane with no session ref joins the one live cline session already running in the same cwd', () => {
      const mux = fakeMultiplexer();
      clineSession('sess-join', '/work/alpha', [userPrompt()]);
      runtime = new AgentRuntime(store, { agents: [clineModule], multiplexers: [mux.module] });
      runtime.startModules();
      expect(store.size).toBe(1);

      mux.publish([pane({ cwd: '/work/alpha' })]);
      expect(store.size).toBe(1);
      const id = onlyAgentId();
      expect(ofType('agentInfo').at(-1)).toMatchObject({
        id,
        name: 'alpha',
        task: 'Ship the release',
      });

      mux.publish([pane({ cwd: '/work/alpha', status: 'blocked' })]);
      expect(ofType('agentToolPermission')).toContainEqual({ type: 'agentToolPermission', id });

      // The module's own discovery still holds the session: losing the pane does not end the character.
      mux.publish([]);
      expect(store.size).toBe(1);
    });

    it('a pane in an untracked directory with no matching session renders from status alone, a second character', () => {
      const mux = fakeMultiplexer();
      clineSession('sess-elsewhere', '/work/alpha', [userPrompt()]);
      runtime = new AgentRuntime(store, { agents: [clineModule], multiplexers: [mux.module] });
      runtime.startModules();
      expect(store.size).toBe(1);

      mux.publish([pane({ cwd: path.join(os.tmpdir(), 'pxl-untracked-pane') })]);
      expect(store.size).toBe(2);
    });
  });
});
