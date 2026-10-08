import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MultiplexedAgent, MultiplexerModule } from '../../core/src/provider.js';
import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { copilotModule } from '../src/providers/copilot/copilot.js';
import { SESSION_POLL_INTERVAL_MS } from '../src/providers/sessionStore/constants.js';

// Copilot's session store and the server's ~/.pixel-agents/ both resolve against the home directory.
let tmpHome: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpHome };
});

type Message = Record<string, unknown>;

const userMessage = { type: 'user.message', data: { content: 'go' } };
const turnEnded = { type: 'assistant.turn_end', data: { turnId: '0' } };
const sessionShutdown = { type: 'session.shutdown', data: { shutdownType: 'routine' } };

function toolStart(toolCallId: string, toolName: string, args: Record<string, unknown>) {
  return { type: 'tool.execution_start', data: { toolCallId, toolName, arguments: args } };
}

function jsonl(records: object[]): string {
  return records.map((r) => `${JSON.stringify(r)}\n`).join('');
}

/** Write a Copilot transcript into its session store under the test home, laid out as Copilot writes it: one
 *  `<sessionId>` directory under `session-state/`, named with the session's own id, holding `events.jsonl` headed
 *  by its `session.start` record. */
function copilotSession(sessionId: string, cwd: string, records: object[]): string {
  const dir = path.join(tmpHome, '.copilot', 'session-state', sessionId);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'events.jsonl');
  const header = { type: 'session.start', data: { sessionId, context: { cwd } } };
  fs.writeFileSync(file, jsonl([header, ...records]));
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
    agentKind: 'copilot',
    status: 'working',
    cwd: path.join(os.tmpdir(), 'pxl-untracked-pane'),
    name: 'alpha',
    task: 'Ship the release',
    ...overrides,
  };
}

describe('copilot provider module', () => {
  let store: AgentStateStore;
  let runtime: AgentRuntime | undefined;
  let messages: Message[];

  const ofType = (type: string) => messages.filter((m) => m.type === type);
  const onlyAgentId = (): number => {
    expect(store.size).toBe(1);
    return [...store.keys()][0];
  };

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-copilot-'));
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

  describe('agent only: copilot, no multiplexer', () => {
    it('a running session appears with its folder name, shows tool activity, goes idle at turn end, and clears at shutdown', () => {
      const sessionId = '09371a50-9a50-484a-8743-5c696de1623a';
      const file = copilotSession(sessionId, '/work/monopoly', [userMessage]);
      runtime = new AgentRuntime(store, { agents: [copilotModule], multiplexers: [] });
      runtime.startModules();

      const id = onlyAgentId();
      expect(store.get(id)?.folderName).toBe('monopoly');

      fs.appendFileSync(
        file,
        jsonl([toolStart('t1', 'edit', { path: '/work/monopoly/src/app.ts' })]),
      );
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentToolStart')).toContainEqual(
        expect.objectContaining({ id, status: 'Editing app.ts', toolName: 'edit' }),
      );

      fs.appendFileSync(
        file,
        jsonl([
          { type: 'tool.execution_complete', data: { toolCallId: 't1', success: true } },
          turnEnded,
        ]),
      );
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentStatus').at(-1)).toMatchObject({ id, status: 'waiting' });

      fs.appendFileSync(file, jsonl([sessionShutdown]));
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(store.size).toBe(0);
    });

    it('a tool.execution_start for ask_user raises a permission request instead of ordinary tool activity', () => {
      const sessionId = '4c4f3f20-7f54-4c53-9f5d-19c0c4a9ab01';
      const file = copilotSession(sessionId, '/work/ask', [userMessage]);
      runtime = new AgentRuntime(store, { agents: [copilotModule], multiplexers: [] });
      runtime.startModules();
      const id = onlyAgentId();

      fs.appendFileSync(file, jsonl([toolStart('t1', 'ask_user', { question: 'Deploy now?' })]));
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentToolPermission')).toContainEqual({ type: 'agentToolPermission', id });
      expect(ofType('agentToolStart')).toEqual([]);
    });

    it('never replays history, and leaves sessions that already exited off the floor', () => {
      copilotSession('exited', '/work/old', [
        toolStart('old', 'bash', { command: 'ls' }),
        sessionShutdown,
      ]);
      copilotSession('idle', '/work/idle', [
        toolStart('old', 'bash', { command: 'ls' }),
        turnEnded,
      ]);
      runtime = new AgentRuntime(store, { agents: [copilotModule], multiplexers: [] });
      runtime.startModules();
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS * 3);

      const id = onlyAgentId();
      expect(store.get(id)?.folderName).toBe('idle');
      expect(ofType('agentToolStart')).toEqual([]);
    });
  });

  describe('both: herdr and copilot', () => {
    it('a herdr pane naming the session by its kind-id sessionRef is one character with transcript tool activity and the pane approval', () => {
      const mux = fakeMultiplexer();
      const sessionId = '7a1d9e40-2c3b-4f6a-8e71-9b5a3c2d1f40';
      const file = copilotSession(sessionId, '/work/alpha', [userMessage]);
      runtime = new AgentRuntime(store, { agents: [copilotModule], multiplexers: [mux.module] });
      runtime.startModules();
      expect(store.size).toBe(1);

      mux.publish([pane({ sessionRef: sessionId })]);
      expect(store.size).toBe(1);
      const id = onlyAgentId();
      expect(ofType('agentInfo').at(-1)).toMatchObject({ id, name: 'alpha' });

      fs.appendFileSync(file, jsonl([toolStart('t1', 'view', { path: 'README.md' })]));
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentToolStart')).toContainEqual(
        expect.objectContaining({ id, status: 'Reading README.md' }),
      );

      mux.publish([pane({ sessionRef: sessionId, status: 'blocked' })]);
      expect(ofType('agentToolPermission')).toContainEqual({ type: 'agentToolPermission', id });
    });
  });
});
