import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MultiplexedAgent, MultiplexerModule } from '../../core/src/provider.js';
import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { codexModule } from '../src/providers/codex/codex.js';
import { SESSION_POLL_INTERVAL_MS } from '../src/providers/sessionStore/constants.js';

// Codex's session store and the server's ~/.pixel-agents/ both resolve against the home directory.
let tmpHome: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpHome };
});

type Message = Record<string, unknown>;

const SESSION_DATE = { year: '2026', month: '01', day: '01' };
const TIMESTAMP_PREFIX = `${SESSION_DATE.year}-${SESSION_DATE.month}-${SESSION_DATE.day}T00-00-00`;

const userMessage = {
  timestamp: '2026-01-01T00:00:01.000Z',
  type: 'response_item',
  payload: { type: 'message', role: 'user', content: [] },
};
const taskStarted = {
  timestamp: '2026-01-01T00:00:01.500Z',
  type: 'event_msg',
  payload: { type: 'task_started' },
};
const taskComplete = {
  timestamp: '2026-01-01T00:00:05.000Z',
  type: 'event_msg',
  payload: { type: 'task_complete' },
};
function functionCall(callId: string, name: string, args: Record<string, unknown>) {
  return {
    timestamp: '2026-01-01T00:00:02.000Z',
    type: 'response_item',
    payload: { type: 'function_call', call_id: callId, name, arguments: JSON.stringify(args) },
  };
}
function functionCallOutput(callId: string) {
  return {
    timestamp: '2026-01-01T00:00:03.000Z',
    type: 'response_item',
    payload: {
      type: 'function_call_output',
      call_id: callId,
      output: { content: 'ok', success: true },
    },
  };
}
function customToolCall(callId: string, name: string, inputText: string) {
  return {
    timestamp: '2026-01-01T00:00:02.000Z',
    type: 'response_item',
    payload: { type: 'custom_tool_call', call_id: callId, name, input: inputText },
  };
}

function jsonl(records: object[]): string {
  return records.map((r) => `${JSON.stringify(r)}\n`).join('');
}

/** Write a Codex rollout into Codex's session store under the test home, laid out as Codex writes it: the
 *  `session_meta` header line (carrying `cwd`), then the records, under the date-partitioned sessions directory. */
function codexSession(threadId: string, cwd: string, records: object[]): string {
  const dir = path.join(
    tmpHome,
    '.codex',
    'sessions',
    SESSION_DATE.year,
    SESSION_DATE.month,
    SESSION_DATE.day,
  );
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `rollout-${TIMESTAMP_PREFIX}-${threadId}.jsonl`);
  const sessionMeta = {
    timestamp: '2026-01-01T00:00:00.000Z',
    type: 'session_meta',
    payload: {
      id: threadId,
      session_id: threadId,
      cwd,
      timestamp: '2026-01-01T00:00:00.000Z',
      originator: 'codex_cli_rs',
      cli_version: '0.160.1',
    },
  };
  fs.writeFileSync(file, jsonl([sessionMeta, ...records]));
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
    agentKind: 'codex',
    status: 'working',
    cwd: path.join(os.tmpdir(), 'pxl-untracked-pane'),
    name: 'alpha',
    task: 'Ship the release',
    ...overrides,
  };
}

describe('codex module', () => {
  let store: AgentStateStore;
  let runtime: AgentRuntime | undefined;
  let messages: Message[];
  let priorCodexHome: string | undefined;

  const ofType = (type: string) => messages.filter((m) => m.type === type);
  const onlyAgentId = (): number => {
    expect(store.size).toBe(1);
    return [...store.keys()][0];
  };

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-codex-'));
    priorCodexHome = process.env.CODEX_HOME;
    delete process.env.CODEX_HOME;
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
    if (priorCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = priorCodexHome;
  });

  describe('agent only: codex, no multiplexer', () => {
    it('a running codex session appears with its tool activity and goes idle when its turn ends', () => {
      const threadId = 'aaaaaaaa-0000-4000-8000-000000000001';
      const file = codexSession(threadId, '/work/monopoly', [userMessage, taskStarted]);
      runtime = new AgentRuntime(store, { agents: [codexModule], multiplexers: [] });
      runtime.startModules();

      const id = onlyAgentId();
      expect(store.get(id)?.folderName).toBe('monopoly');

      fs.appendFileSync(file, jsonl([functionCall('call_1', 'exec_command', { cmd: 'ls -la' })]));
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentToolStart')).toContainEqual(
        expect.objectContaining({ id, status: 'Running: ls -la', toolName: 'exec_command' }),
      );

      fs.appendFileSync(file, jsonl([functionCallOutput('call_1'), taskComplete]));
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentStatus').at(-1)).toMatchObject({ id, status: 'waiting' });
    });

    it('never replays history: a session that already finished its turn starts idle with no tool activity', () => {
      codexSession('cccccccc-2222-4222-8222-000000000003', '/work/replay', [
        userMessage,
        taskStarted,
        functionCall('old', 'exec_command', { cmd: 'ls' }),
        functionCallOutput('old'),
        taskComplete,
      ]);
      runtime = new AgentRuntime(store, { agents: [codexModule], multiplexers: [] });
      runtime.startModules();

      const id = onlyAgentId();
      expect(store.get(id)?.folderName).toBe('replay');
      expect(ofType('agentToolStart')).toEqual([]);
      expect(ofType('agentStatus').at(-1)).toMatchObject({ id, status: 'waiting' });
    });
  });

  describe('both: herdr and codex', () => {
    it('a codex pane herdr names by thread id is one character, with transcript tool activity and the pane approval', () => {
      const mux = fakeMultiplexer();
      const threadId = 'bbbbbbbb-1111-4111-8111-000000000002';
      const file = codexSession(threadId, '/work/delta', [userMessage, taskStarted]);
      runtime = new AgentRuntime(store, { agents: [codexModule], multiplexers: [mux.module] });
      runtime.startModules();
      expect(store.size).toBe(1); // codex's own discovery already tracks this session

      mux.publish([pane({ sessionRef: threadId })]);
      expect(store.size).toBe(1); // the pane joins the same character by thread id, not a second one
      const id = onlyAgentId();
      expect(ofType('agentInfo').at(-1)).toMatchObject({ id, name: 'alpha' });

      const patch = '*** Begin Patch\n*** Update File: src/app.ts\n@@\n-old\n+new\n*** End Patch';
      fs.appendFileSync(file, jsonl([customToolCall('call_1', 'apply_patch', patch)]));
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentToolStart')).toContainEqual(
        expect.objectContaining({ id, status: 'Editing app.ts', toolName: 'apply_patch' }),
      );

      mux.publish([pane({ sessionRef: threadId, status: 'blocked' })]);
      expect(ofType('agentToolPermission')).toContainEqual({ type: 'agentToolPermission', id });

      // The pane vanishing ends herdr's view of it, but codex's own discovery still owns the session.
      mux.publish([]);
      expect(store.size).toBe(1);
    });
  });
});
