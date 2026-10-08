import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MultiplexedAgent, MultiplexerModule } from '../../core/src/provider.js';
import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { grokModule } from '../src/providers/grok/grok.js';
import { SESSION_POLL_INTERVAL_MS } from '../src/providers/sessionStore/constants.js';

// grok's session store and the server's ~/.pixel-agents/ both resolve against the home directory.
let tmpHome: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpHome };
});

type Message = Record<string, unknown>;

function envelope(update: Record<string, unknown>): Record<string, unknown> {
  return { timestamp: 0, method: 'session/update', params: { sessionId: 'session', update } };
}

const userMessageChunk = envelope({
  sessionUpdate: 'user_message_chunk',
  content: { type: 'text', text: 'go' },
});

function toolCall(id: string, name: string, rawInput: Record<string, unknown>) {
  return envelope({
    sessionUpdate: 'tool_call',
    toolCallId: id,
    title: name,
    rawInput,
    _meta: { 'x.ai/tool': { name } },
  });
}

function toolCallUpdate(id: string, status: 'completed' | 'failed' = 'completed') {
  return envelope({ sessionUpdate: 'tool_call_update', toolCallId: id, status });
}

const turnCompleted = envelope({
  sessionUpdate: 'turn_completed',
  prompt_id: 'p1',
  stop_reason: 'end_turn',
});

function jsonl(records: object[]): string {
  return records.map((r) => `${JSON.stringify(r)}\n`).join('');
}

/** Write a grok session into grok's session store under the test home, laid out as grok writes it: a sibling
 *  `summary.json` carrying the recorded cwd, and `updates.jsonl` as the ACP envelope stream. */
function grokSession(uuid: string, cwd: string, records: object[]): string {
  const dir = path.join(tmpHome, '.grok', 'sessions', encodeURIComponent(cwd), uuid);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({ info: { id: uuid, cwd } }));
  const file = path.join(dir, 'updates.jsonl');
  fs.writeFileSync(file, jsonl(records));
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
    agentKind: 'grok',
    status: 'working',
    cwd: path.join(os.tmpdir(), 'pxl-untracked-pane'),
    name: 'alpha',
    task: 'Ship the release',
    ...overrides,
  };
}

describe('grok module', () => {
  let store: AgentStateStore;
  let runtime: AgentRuntime | undefined;
  let messages: Message[];

  const ofType = (type: string) => messages.filter((m) => m.type === type);
  const onlyAgentId = (): number => {
    expect(store.size).toBe(1);
    return [...store.keys()][0];
  };

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-grok-'));
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

  describe('agent only: grok, no multiplexer', () => {
    it('a running grok session appears with its tool activity and goes idle when its turn ends', () => {
      const uuid = '11111111-2222-3333-4444-555555555555';
      const file = grokSession(uuid, '/work/monopoly', [userMessageChunk]);
      runtime = new AgentRuntime(store, { agents: [grokModule], multiplexers: [] });
      runtime.startModules();

      const id = onlyAgentId();
      expect(store.get(id)?.folderName).toBe('monopoly');

      fs.appendFileSync(
        file,
        jsonl([toolCall('t1', 'read_file', { target_file: '/work/monopoly/PLAN.md' })]),
      );
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentToolStart')).toContainEqual(
        expect.objectContaining({ id, status: 'Reading PLAN.md', toolName: 'read_file' }),
      );

      fs.appendFileSync(file, jsonl([toolCallUpdate('t1'), turnCompleted]));
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentStatus').at(-1)).toMatchObject({ id, status: 'waiting' });
    });

    it('never replays history: a session already idle at open starts idle with no replayed tool activity', () => {
      const uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      grokSession(uuid, '/work/idle', [
        toolCall('old', 'run_terminal_command', { command: 'ls' }),
        turnCompleted,
      ]);
      runtime = new AgentRuntime(store, { agents: [grokModule], multiplexers: [] });
      runtime.startModules();

      const id = onlyAgentId();
      expect(store.get(id)?.folderName).toBe('idle');
      expect(ofType('agentToolStart')).toEqual([]);
      expect(ofType('agentStatus').at(-1)).toMatchObject({ id, status: 'waiting' });
    });
  });

  describe('both: herdr and grok', () => {
    it('a grok pane herdr names by session id is one character with its transcript tool activity and the pane name, task and approval', () => {
      const mux = fakeMultiplexer();
      const uuid = '0b5e7c1e-4a2d-4c36-9f0e-1d2c3b4a5f60';
      const file = grokSession(uuid, '/work/delta', [userMessageChunk]);
      runtime = new AgentRuntime(store, { agents: [grokModule], multiplexers: [mux.module] });
      runtime.startModules();

      const id = onlyAgentId();
      expect(store.get(id)?.folderName).toBe('delta');

      mux.publish([pane({ name: 'delta', sessionRef: uuid })]);
      expect(store.size).toBe(1);
      expect(ofType('agentInfo').at(-1)).toMatchObject({ id, name: 'delta' });

      fs.appendFileSync(
        file,
        jsonl([toolCall('t1', 'read_file', { target_file: '/work/delta/a.ts' })]),
      );
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentToolStart')).toContainEqual(
        expect.objectContaining({ id, status: 'Reading a.ts', toolName: 'read_file' }),
      );

      mux.publish([pane({ sessionRef: uuid, status: 'blocked' })]);
      expect(ofType('agentToolPermission')).toContainEqual(
        expect.objectContaining({ type: 'agentToolPermission', id }),
      );
    });
  });
});
