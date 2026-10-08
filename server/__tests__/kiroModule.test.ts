import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MultiplexedAgent, MultiplexerModule } from '../../core/src/provider.js';
import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { kiroModule } from '../src/providers/kiro/kiro.js';
import {
  SESSION_ACTIVE_WINDOW_MS,
  SESSION_DISCOVERY_INTERVAL_MS,
  SESSION_POLL_INTERVAL_MS,
} from '../src/providers/sessionStore/constants.js';

// Kiro's session store and the server's ~/.pixel-agents/ both resolve against the home directory.
let tmpHome: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof os>('os');
  return { ...actual, homedir: () => tmpHome };
});

type Message = Record<string, unknown>;

function jsonl(records: object[]): string {
  return records.map((r) => `${JSON.stringify(r)}\n`).join('');
}

const v2Prompt = {
  version: 'v1',
  kind: 'Prompt',
  data: {
    message_id: 'm1',
    content: [{ kind: 'text', data: 'fix the retry loop' }],
    meta: { timestamp: 1 },
  },
};

function v2ToolUse(toolId: string, name: string, input: Record<string, unknown>) {
  return {
    version: 'v1',
    kind: 'AssistantMessage',
    data: {
      message_id: 'm2',
      content: [{ kind: 'toolUse', data: { toolUseId: toolId, name, input } }],
    },
  };
}

const v2TurnEnd = {
  version: 'v1',
  kind: 'AssistantMessage',
  data: { message_id: 'm3', content: [{ kind: 'text', data: 'done' }] },
};

/** Write a Kiro CLI V2 (`kiro-cli chat`) session: `cli/<uuid>.jsonl` beside a `.json` sidecar carrying `cwd`. */
function kiroV2Session(uuid: string, cwd: string, records: object[]): string {
  const dir = path.join(tmpHome, '.kiro', 'sessions', 'cli');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${uuid}.jsonl`);
  fs.writeFileSync(file, jsonl(records));
  fs.writeFileSync(path.join(dir, `${uuid}.json`), JSON.stringify({ session_id: uuid, cwd }));
  return file;
}

const v3User = {
  id: 'u0',
  timestamp: '2026-10-01T10:00:00.000Z',
  payload: { type: 'user', content: 'go' },
};

function v3ToolCall(
  toolId: string,
  toolName: string,
  args: Record<string, unknown>,
  status = 'executing',
) {
  return {
    id: `${toolId}-${status}`,
    timestamp: '2026-10-01T10:00:01.000Z',
    payload: { type: 'tool_call', toolCallId: toolId, toolName, args, status },
  };
}

const v3TurnEnd = {
  id: 'te1',
  timestamp: '2026-10-01T10:00:02.000Z',
  payload: { type: 'turn_end', stopReason: 'end_turn' },
};

/** Write a Kiro 3 (`--v3`) session: `sessions/<hash>/sess_<uuid>/messages.jsonl` beside a `session.json` sidecar
 *  carrying `workspacePaths`, matching the id Kiro self-reports to herdr. */
function kiroV3Session(sessionId: string, cwd: string, records: object[]): string {
  const dir = path.join(tmpHome, '.kiro', 'sessions', 'workspacehash1234', sessionId);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'messages.jsonl');
  fs.writeFileSync(file, jsonl(records));
  fs.writeFileSync(
    path.join(dir, 'session.json'),
    JSON.stringify({ id: sessionId, workspacePaths: [cwd] }),
  );
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
    agentKind: 'kiro',
    status: 'working',
    cwd: path.join(os.tmpdir(), 'pxl-untracked-pane'),
    name: 'alpha',
    task: 'Ship the release',
    ...overrides,
  };
}

describe('kiro agent module', () => {
  let store: AgentStateStore;
  let runtime: AgentRuntime | undefined;
  let messages: Message[];

  const ofType = (type: string) => messages.filter((m) => m.type === type);
  const onlyAgentId = (): number => {
    expect(store.size).toBe(1);
    return [...store.keys()][0];
  };

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-kiro-'));
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

  describe('V2 store (`kiro-cli chat`)', () => {
    it('a live session appears with its folder name, shows tool activity, and goes idle at turn end', () => {
      const file = kiroV2Session('11111111-1111-1111-1111-111111111111', '/work/monopoly', [
        v2Prompt,
      ]);
      runtime = new AgentRuntime(store, { agents: [kiroModule], multiplexers: [] });
      runtime.startModules();

      const id = onlyAgentId();
      expect(store.get(id)?.folderName).toBe('monopoly');

      fs.appendFileSync(
        file,
        jsonl([
          v2ToolUse('t1', 'read', {
            operations: [{ mode: 'File', path: '/work/monopoly/PLAN.md' }],
          }),
        ]),
      );
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentToolStart')).toContainEqual(
        expect.objectContaining({ id, status: 'Reading PLAN.md', toolName: 'read' }),
      );

      fs.appendFileSync(file, jsonl([v2TurnEnd]));
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentStatus').at(-1)).toMatchObject({ id, status: 'waiting' });
    });

    it('retires a session through the shared active window, since V2 records no explicit exit', () => {
      const file = kiroV2Session('22222222-2222-2222-2222-222222222222', '/work/old', [v2Prompt]);
      runtime = new AgentRuntime(store, { agents: [kiroModule], multiplexers: [] });
      runtime.startModules();
      onlyAgentId();

      const staleSeconds = (Date.now() - SESSION_ACTIVE_WINDOW_MS - 1000) / 1000;
      fs.utimesSync(file, staleSeconds, staleSeconds);
      vi.advanceTimersByTime(SESSION_DISCOVERY_INTERVAL_MS);
      expect(store.size).toBe(0);
    });

    it('herdr reports no session ref for Kiro V2: a pane in the same cwd joins the discovered session', () => {
      const mux = fakeMultiplexer();
      kiroV2Session('33333333-3333-3333-3333-333333333333', '/work/alpha', [v2Prompt]);
      runtime = new AgentRuntime(store, { agents: [kiroModule], multiplexers: [mux.module] });
      runtime.startModules();
      expect(store.size).toBe(1);

      mux.publish([pane({ cwd: '/work/alpha', name: 'alpha-pane' })]);
      expect(store.size).toBe(1);
      expect(ofType('agentInfo').at(-1)).toMatchObject({ name: 'alpha-pane' });
    });
  });

  describe('V3 store (`kiro-cli --v3`)', () => {
    it('a live session appears with its folder name and shows tool activity', () => {
      const sessionId = 'sess_44444444-4444-4444-4444-444444444444';
      const file = kiroV3Session(sessionId, '/work/beta', [v3User]);
      runtime = new AgentRuntime(store, { agents: [kiroModule], multiplexers: [] });
      runtime.startModules();

      const id = onlyAgentId();
      expect(store.get(id)?.folderName).toBe('beta');

      fs.appendFileSync(
        file,
        jsonl([v3ToolCall('c1', 'execute_bash', { command: 'go test ./retry' })]),
      );
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentToolStart')).toContainEqual(
        expect.objectContaining({
          id,
          status: 'Running: go test ./retry',
          toolName: 'execute_bash',
        }),
      );

      fs.appendFileSync(file, jsonl([v3TurnEnd]));
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentStatus').at(-1)).toMatchObject({ id, status: 'waiting' });
    });

    it('an awaiting_approval tool_call asks for permission', () => {
      const sessionId = 'sess_55555555-5555-5555-5555-555555555555';
      const file = kiroV3Session(sessionId, '/work/gamma', [v3User]);
      runtime = new AgentRuntime(store, { agents: [kiroModule], multiplexers: [] });
      runtime.startModules();
      const id = onlyAgentId();

      fs.appendFileSync(
        file,
        jsonl([v3ToolCall('c2', 'execute_bash', { command: 'rm -rf /' }, 'awaiting_approval')]),
      );
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentToolPermission')).toContainEqual({ type: 'agentToolPermission', id });
    });

    it('a herdr pane self-reporting the sess_<uuid> id Kiro 3 writes is one character, not two', () => {
      const mux = fakeMultiplexer();
      const sessionId = 'sess_66666666-6666-6666-6666-666666666666';
      kiroV3Session(sessionId, '/work/delta', [v3User]);
      runtime = new AgentRuntime(store, { agents: [kiroModule], multiplexers: [mux.module] });
      runtime.startModules();
      const id = onlyAgentId();

      mux.publish([pane({ cwd: '/work/delta', sessionRef: sessionId, name: 'delta-pane' })]);
      expect(store.size).toBe(1);
      expect(onlyAgentId()).toBe(id);
      expect(ofType('agentInfo').at(-1)).toMatchObject({ id, name: 'delta-pane' });
    });

    it('a pane reported before Kiro discovers its V3 session still renders once', () => {
      const mux = fakeMultiplexer();
      runtime = new AgentRuntime(store, { agents: [kiroModule], multiplexers: [mux.module] });
      runtime.startModules();
      expect(store.size).toBe(0);

      const sessionId = 'sess_77777777-7777-7777-7777-777777777777';
      kiroV3Session(sessionId, '/work/epsilon', [v3User]);
      mux.publish([pane({ paneId: 'p9', name: 'epsilon', sessionRef: sessionId })]);
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS * 5); // several discovery scans find the same session

      const id = onlyAgentId();
      expect(store.get(id)?.folderName).toBe('epsilon');
    });
  });
});
