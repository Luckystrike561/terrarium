import type * as Os from 'node:os';
import { DatabaseSync } from 'node:sqlite';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MultiplexedAgent, MultiplexerModule } from '../../core/src/provider.js';
import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { mastracodeModule } from '../src/providers/mastracode/mastracode.js';
import {
  SESSION_DISCOVERY_INTERVAL_MS,
  SESSION_POLL_INTERVAL_MS,
} from '../src/providers/sessionStore/constants.js';

// mastracode's session database and the server's ~/.pixel-agents/ both resolve against the home directory.
let tmpHome: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof Os>('os');
  return { ...actual, homedir: () => tmpHome };
});

type Message = Record<string, unknown>;

let nextTimestamp = 0;
/** A strictly increasing ISO timestamp: `createdAt`/`updatedAt` order every fixture row the way mastracode's own
 *  inserts do, without depending on real wall-clock resolution between calls in the same test. */
function isoTick(): string {
  nextTimestamp += 1000;
  return new Date(nextTimestamp).toISOString();
}

/** Opens mastracode's session database at its default Linux path under the test home, creating the schema
 *  mastracode's own storage layer writes: `metadata` via `jsonb()`, `content` as plain JSON text, both
 *  `createdAt`/`updatedAt` as ISO strings. */
function openMastraDb(): DatabaseSync {
  const dir = path.join(tmpHome, '.local', 'share', 'mastracode');
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'mastra.db'));
  db.exec(
    'CREATE TABLE mastra_threads (id TEXT PRIMARY KEY, resourceId TEXT, title TEXT, metadata BLOB, createdAt TEXT, updatedAt TEXT)',
  );
  db.exec(
    'CREATE TABLE mastra_messages (id TEXT PRIMARY KEY, thread_id TEXT, content TEXT, role TEXT, type TEXT, createdAt TEXT, resourceId TEXT)',
  );
  return db;
}

function createThread(db: DatabaseSync, id: string, cwd: string): void {
  const now = isoTick();
  db.prepare(
    'INSERT INTO mastra_threads (id, resourceId, title, metadata, createdAt, updatedAt) VALUES (?,?,?,jsonb(?),?,?)',
  ).run(id, 'resource-1', id, JSON.stringify({ projectPath: cwd }), now, now);
}

function touchThread(db: DatabaseSync, id: string): void {
  db.prepare('UPDATE mastra_threads SET updatedAt = ? WHERE id = ?').run(isoTick(), id);
}

let nextMessageId = 0;

function userMessage(db: DatabaseSync, threadId: string, text: string): void {
  const content = JSON.stringify({ format: 2, parts: [{ type: 'text', text }] });
  db.prepare(
    'INSERT INTO mastra_messages (id, thread_id, content, role, type, createdAt, resourceId) VALUES (?,?,?,?,?,?,?)',
  ).run(`msg-${nextMessageId++}`, threadId, content, 'user', 'v2', isoTick(), 'resource-1');
  touchThread(db, threadId);
}

interface ToolCallFixture {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  state: string;
}

function assistantMessage(db: DatabaseSync, threadId: string, toolCalls: ToolCallFixture[]): void {
  const parts = toolCalls.map((t) => ({
    type: 'tool-invocation',
    toolInvocation: {
      toolCallId: t.toolCallId,
      toolName: t.toolName,
      args: t.args,
      state: t.state,
    },
  }));
  const content = JSON.stringify({ format: 2, parts });
  db.prepare(
    'INSERT INTO mastra_messages (id, thread_id, content, role, type, createdAt, resourceId) VALUES (?,?,?,?,?,?,?)',
  ).run(`msg-${nextMessageId++}`, threadId, content, 'assistant', 'v2', isoTick(), 'resource-1');
  touchThread(db, threadId);
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
    agentKind: 'mastracode',
    status: 'working',
    cwd: path.join(os.tmpdir(), 'pxl-untracked-pane'),
    name: 'alpha',
    task: 'Ship the release',
    ...overrides,
  };
}

describe('mastracode module', () => {
  let store: AgentStateStore;
  let runtime: AgentRuntime | undefined;
  let messages: Message[];
  let db: DatabaseSync | undefined;
  let savedEnv: Record<string, string | undefined>;

  const ofType = (type: string) => messages.filter((m) => m.type === type);
  const onlyAgentId = (): number => {
    expect(store.size).toBe(1);
    return [...store.keys()][0];
  };

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-mastracode-'));
    savedEnv = {
      XDG_DATA_HOME: process.env.XDG_DATA_HOME,
      MASTRA_DB_PATH: process.env.MASTRA_DB_PATH,
      MASTRA_APP_DATA_DIR: process.env.MASTRA_APP_DATA_DIR,
    };
    delete process.env.XDG_DATA_HOME;
    delete process.env.MASTRA_DB_PATH;
    delete process.env.MASTRA_APP_DATA_DIR;
    nextTimestamp = Date.now();
    nextMessageId = 0;
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    store = new AgentStateStore();
    messages = [];
    store.on('broadcast', (m) => messages.push(m as Message));
  });

  afterEach(() => {
    runtime?.dispose();
    runtime = undefined;
    db?.close();
    db = undefined;
    vi.useRealTimers();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  describe('agent only: mastracode, no multiplexer', () => {
    it('a running mastracode session appears with its tool activity and goes idle when its turn ends', () => {
      db = openMastraDb();
      createThread(db, 'thread-live', '/work/monopoly');
      userMessage(db, 'thread-live', 'look at the plan');
      runtime = new AgentRuntime(store, { agents: [mastracodeModule], multiplexers: [] });
      runtime.startModules();

      const id = onlyAgentId();
      expect(store.get(id)?.folderName).toBe('monopoly');

      assistantMessage(db, 'thread-live', [
        {
          toolCallId: 't1',
          toolName: 'view',
          args: { path: '/work/monopoly/PLAN.md' },
          state: 'result',
        },
      ]);
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentToolStart')).toContainEqual(
        expect.objectContaining({ id, status: 'Reading PLAN.md', toolName: 'view' }),
      );
      expect(ofType('agentStatus').at(-1)).toMatchObject({ id, status: 'waiting' });
    });

    it('never replays history, and starts each session from its last recorded state', () => {
      db = openMastraDb();
      createThread(db, 'thread-idle', '/work/idle');
      userMessage(db, 'thread-idle', 'old prompt');
      assistantMessage(db, 'thread-idle', [
        {
          toolCallId: 'old',
          toolName: 'execute_command',
          args: { command: 'ls' },
          state: 'result',
        },
      ]);
      createThread(db, 'thread-busy', '/work/busy');
      userMessage(db, 'thread-busy', 'start a long task');
      assistantMessage(db, 'thread-busy', [
        {
          toolCallId: 'pending',
          toolName: 'execute_command',
          args: { command: 'npm test' },
          state: 'call',
        },
      ]);

      runtime = new AgentRuntime(store, { agents: [mastracodeModule], multiplexers: [] });
      runtime.startModules();
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS * 3);

      expect(store.size).toBe(2);
      expect(ofType('agentToolStart')).toEqual([]);
      const idleId = [...store].find(([, a]) => a.folderName === 'idle')?.[0];
      const busyId = [...store].find(([, a]) => a.folderName === 'busy')?.[0];
      expect(ofType('agentStatus')).toContainEqual(
        expect.objectContaining({ id: idleId, status: 'waiting' }),
      );
      expect(ofType('agentStatus')).toContainEqual(
        expect.objectContaining({ id: busyId, status: 'active' }),
      );
    });
  });

  describe('both: herdr and mastracode', () => {
    it('a mastracode session in a pane is one character, with its tool activity, name and approval, gone with the pane', () => {
      db = openMastraDb();
      const mux = fakeMultiplexer();
      runtime = new AgentRuntime(store, { agents: [mastracodeModule], multiplexers: [mux.module] });
      runtime.startModules();
      expect(store.size).toBe(0);

      createThread(db, 'thread-pane', '/work/alpha');
      userMessage(db, 'thread-pane', 'go');
      mux.publish([pane({ sessionRef: 'thread-pane' })]);
      const id = onlyAgentId();
      expect(ofType('agentInfo').at(-1)).toMatchObject({ id, name: 'alpha' });

      assistantMessage(db, 'thread-pane', [
        {
          toolCallId: 't1',
          toolName: 'string_replace_lsp',
          args: { path: 'src/app.ts' },
          state: 'result',
        },
      ]);
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentToolStart')).toContainEqual(
        expect.objectContaining({ id, status: 'Editing app.ts' }),
      );

      mux.publish([pane({ sessionRef: 'thread-pane', status: 'blocked' })]);
      expect(ofType('agentToolPermission')).toContainEqual({ type: 'agentToolPermission', id });

      // mastracode's session database never records a clean exit (AgentController only ever flushes a completed
      // or suspended turn): the pane disappearing is the only exit signal this combination can observe.
      mux.publish([]);
      expect(store.size).toBe(0);
    });

    it('a pane reported before mastracode discovers its session still renders once', () => {
      db = openMastraDb();
      createThread(db, 'thread-gamma', '/work/gamma');
      userMessage(db, 'thread-gamma', 'go');
      const mux = fakeMultiplexer();
      runtime = new AgentRuntime(store, { agents: [mastracodeModule], multiplexers: [mux.module] });
      runtime.startModules();
      expect(store.size).toBe(1); // mastracode's own discovery already found it

      mux.publish([pane({ paneId: 'p9', name: 'gamma', sessionRef: 'thread-gamma' })]);
      vi.advanceTimersByTime(SESSION_DISCOVERY_INTERVAL_MS * 2);

      const id = onlyAgentId();
      expect(store.get(id)?.folderName).toBe('gamma');
      expect(ofType('agentInfo').at(-1)).toMatchObject({ id, name: 'gamma' });
    });
  });
});
