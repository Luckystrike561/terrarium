import * as fs from 'fs';
import type * as OsModule from 'os';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MultiplexedAgent, MultiplexerModule } from '../../core/src/provider.js';
import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { droidModule } from '../src/providers/droid/droid.js';
import { SESSION_POLL_INTERVAL_MS } from '../src/providers/sessionStore/constants.js';

// Droid's session store and the server's ~/.pixel-agents/ both resolve against the home directory.
let tmpHome: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof OsModule>('os');
  return { ...actual, homedir: () => tmpHome };
});

type Message = Record<string, unknown>;

const userPrompt = {
  type: 'message',
  message: { role: 'user', content: [{ type: 'text', text: 'go' }] },
};
const turnEnded = {
  type: 'message',
  message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
};
const sessionEnd = { type: 'session_end' };

function toolUse(toolId: string, toolName: string, input: Record<string, unknown>) {
  return {
    type: 'message',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id: toolId, name: toolName, input }],
    },
  };
}

function toolResult(toolId: string) {
  return {
    type: 'message',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: toolId, is_error: false, content: 'ok' }],
    },
  };
}

function jsonl(records: object[]): string {
  return records.map((r) => `${JSON.stringify(r)}\n`).join('');
}

/** Write a Droid transcript into Droid's session store under the test home, laid out as Droid writes it: a
 *  `session_start` header naming the session's own id and cwd, then the records. The file name is that same id,
 *  which is also what herdr reports as the session's `agent_session.value`. */
function droidSession(sessionId: string, cwd: string, records: object[]): string {
  const dir = path.join(tmpHome, '.factory', 'sessions', `-${path.basename(cwd)}`);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${sessionId}.jsonl`);
  fs.writeFileSync(file, jsonl([{ type: 'session_start', id: sessionId, cwd }, ...records]));
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
    agentKind: 'droid',
    status: 'working',
    cwd: path.join(os.tmpdir(), 'pxl-untracked-pane'),
    name: 'alpha',
    task: 'Ship the release',
    ...overrides,
  };
}

describe('droid provider module', () => {
  let store: AgentStateStore;
  let runtime: AgentRuntime | undefined;
  let messages: Message[];

  const ofType = (type: string) => messages.filter((m) => m.type === type);
  const onlyAgentId = (): number => {
    expect(store.size).toBe(1);
    return [...store.keys()][0];
  };

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-droid-'));
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

  describe('agent only: droid, no multiplexer', () => {
    it('a running droid session appears with its tool activity and goes idle when its turn ends', () => {
      const file = droidSession('11111111-1111-1111-1111-111111111111', '/work/monopoly', [
        userPrompt,
      ]);
      runtime = new AgentRuntime(store, { agents: [droidModule], multiplexers: [] });
      runtime.startModules();

      const id = onlyAgentId();
      expect(store.get(id)?.folderName).toBe('monopoly');

      fs.appendFileSync(
        file,
        jsonl([toolUse('call_1', 'Read', { file_path: '/work/monopoly/PLAN.md' })]),
      );
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentToolStart')).toContainEqual(
        expect.objectContaining({ id, status: 'Reading PLAN.md', toolName: 'Read' }),
      );

      fs.appendFileSync(file, jsonl([toolResult('call_1'), turnEnded]));
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentStatus').at(-1)).toMatchObject({ id, status: 'waiting' });

      fs.appendFileSync(file, jsonl([sessionEnd]));
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(store.size).toBe(0);
    });

    it('never replays history, and leaves sessions that already exited off the floor', () => {
      droidSession('22222222-2222-2222-2222-222222222222', '/work/old', [
        toolUse('old', 'Execute', { command: 'ls' }),
        sessionEnd,
      ]);
      droidSession('33333333-3333-3333-3333-333333333333', '/work/idle', [
        toolUse('old', 'Execute', { command: 'ls' }),
        turnEnded,
      ]);
      runtime = new AgentRuntime(store, { agents: [droidModule], multiplexers: [] });
      runtime.startModules();
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS * 3);

      const id = onlyAgentId();
      expect(store.get(id)?.folderName).toBe('idle');
      expect(ofType('agentToolStart')).toEqual([]);
    });

    it('skips host-injected context, thinking and state records', () => {
      const file = droidSession('44444444-4444-4444-4444-444444444444', '/work/quiet', [
        userPrompt,
      ]);
      runtime = new AgentRuntime(store, { agents: [droidModule], multiplexers: [] });
      runtime.startModules();
      const id = onlyAgentId();

      fs.appendFileSync(
        file,
        jsonl([
          {
            type: 'message',
            message: {
              role: 'user',
              visibility: 'llm_only',
              content: [{ type: 'text', text: 'reminder' }],
            },
          },
          { type: 'todo_state', todos: [] },
          { type: 'compaction_state' },
          {
            type: 'message',
            message: {
              role: 'assistant',
              content: [
                { type: 'thinking', thinking: 'hmm' },
                { type: 'text', text: 'done' },
              ],
            },
          },
        ]),
      );
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentStatus').at(-1)).toMatchObject({ id, status: 'waiting' });
      expect(ofType('agentToolStart')).toEqual([]);
    });
  });

  describe('both: herdr and droid', () => {
    it('a droid pane herdr names by session id is one character with its transcript tool activity', () => {
      const mux = fakeMultiplexer();
      const sessionId = '55555555-5555-5555-5555-555555555555';
      const file = droidSession(sessionId, '/work/alpha', [userPrompt]);
      runtime = new AgentRuntime(store, { agents: [droidModule], multiplexers: [mux.module] });
      runtime.startModules();

      mux.publish([pane({ sessionRef: sessionId })]);
      const id = onlyAgentId();
      expect(ofType('agentInfo').at(-1)).toMatchObject({
        id,
        name: 'alpha',
        task: 'Ship the release',
      });

      fs.appendFileSync(file, jsonl([toolUse('t1', 'Edit', { file_path: 'src/app.ts' })]));
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentToolStart')).toContainEqual(
        expect.objectContaining({ id, status: 'Editing app.ts' }),
      );

      mux.publish([pane({ sessionRef: sessionId, status: 'blocked' })]);
      expect(ofType('agentToolPermission')).toContainEqual({ type: 'agentToolPermission', id });
    });

    it('a pane reported before droid discovers its session still renders once, never two characters', () => {
      const mux = fakeMultiplexer();
      const sessionId = '66666666-6666-6666-6666-666666666666';
      runtime = new AgentRuntime(store, { agents: [droidModule], multiplexers: [mux.module] });
      runtime.startModules();
      expect(store.size).toBe(0);

      mux.publish([pane({ paneId: 'p9', name: 'gamma', sessionRef: sessionId })]);
      droidSession(sessionId, '/work/gamma', [userPrompt]);
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS * 5); // several discovery scans find the same file

      const id = onlyAgentId();
      expect(store.get(id)?.folderName).toBe('gamma');
    });
  });
});
