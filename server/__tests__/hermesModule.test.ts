import { DatabaseSync } from 'node:sqlite';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MultiplexedAgent, MultiplexerModule } from '../../core/src/provider.js';
import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { hermesModule } from '../src/providers/hermes/hermes.js';
import { SESSION_POLL_INTERVAL_MS } from '../src/providers/sessionStore/constants.js';

// hermes' session store and the server's ~/.pixel-agents/ both resolve against the home directory.
let tmpHome: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpHome };
});

type Message = Record<string, unknown>;

function hermesDbPath(): string {
  return path.join(tmpHome, '.hermes', 'state.db');
}

/** A subset of hermes_state_common.py's SCHEMA_SQL: only the columns the module's SqliteFormat reads. */
function openHermesDb(): DatabaseSync {
  const file = hermesDbPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      started_at REAL NOT NULL,
      ended_at REAL,
      end_reason TEXT,
      cwd TEXT,
      last_activity_at REAL,
      hidden INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      tool_call_id TEXT,
      tool_calls TEXT,
      finish_reason TEXT,
      timestamp REAL NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );
  `);
  return db;
}

function appendMessage(db: DatabaseSync, sessionId: string, row: Message): void {
  const now = Date.now() / 1000;
  db.prepare(
    `INSERT INTO messages (session_id, role, tool_call_id, tool_calls, finish_reason, timestamp, active)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
  ).run(
    sessionId,
    row['role'] as string,
    (row['tool_call_id'] as string | undefined) ?? null,
    row['tool_calls'] ? JSON.stringify(row['tool_calls']) : null,
    (row['finish_reason'] as string | undefined) ?? null,
    now,
  );
  db.prepare('UPDATE sessions SET last_activity_at = ? WHERE id = ?').run(now, sessionId);
}

/** Create a hermes session row, laid out as hermes writes it: a `sessions` row, then its `messages` rows. */
function hermesSession(db: DatabaseSync, id: string, cwd: string, rows: Message[]): void {
  const now = Date.now() / 1000;
  db.prepare(
    'INSERT INTO sessions (id, source, started_at, cwd, last_activity_at, hidden) VALUES (?, ?, ?, ?, ?, 0)',
  ).run(id, 'cli', now, cwd, now);
  for (const row of rows) appendMessage(db, id, row);
}

function endSession(db: DatabaseSync, id: string, reason: string): void {
  db.prepare('UPDATE sessions SET ended_at = ?, end_reason = ? WHERE id = ?').run(
    Date.now() / 1000,
    reason,
    id,
  );
}

const userPrompt: Message = { role: 'user' };
const turnEnded: Message = { role: 'assistant', finish_reason: 'stop' };
function toolStart(toolCallId: string, toolName: string, args: Record<string, unknown>): Message {
  return {
    role: 'assistant',
    tool_calls: [{ id: toolCallId, function: { name: toolName, arguments: JSON.stringify(args) } }],
  };
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
    agentKind: 'hermes',
    status: 'working',
    cwd: path.join(os.tmpdir(), 'pxl-untracked-pane'),
    name: 'alpha',
    task: 'Ship the release',
    ...overrides,
  };
}

describe('hermes module', () => {
  let store: AgentStateStore;
  let runtime: AgentRuntime | undefined;
  let messages: Message[];

  const ofType = (type: string) => messages.filter((m) => m.type === type);
  const onlyAgentId = (): number => {
    expect(store.size).toBe(1);
    return [...store.keys()][0];
  };

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-hermes-'));
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

  describe('agent only: hermes, no multiplexer', () => {
    it('a running hermes session appears with its tool activity, goes idle when its turn ends, and disappears on a clean exit', () => {
      const db = openHermesDb();
      hermesSession(db, 'live', '/work/monopoly', [userPrompt]);
      runtime = new AgentRuntime(store, { agents: [hermesModule], multiplexers: [] });
      runtime.startModules();

      const id = onlyAgentId();
      expect(store.get(id)?.folderName).toBe('monopoly');

      appendMessage(db, 'live', toolStart('t1', 'read_file', { path: '/work/monopoly/PLAN.md' }));
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentToolStart')).toContainEqual(
        expect.objectContaining({ id, status: 'Reading PLAN.md', toolName: 'read_file' }),
      );

      appendMessage(db, 'live', turnEnded);
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentStatus').at(-1)).toMatchObject({ id, status: 'waiting' });

      endSession(db, 'live', 'user_exit');
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(store.size).toBe(0);
    });

    it('never replays history, and leaves sessions that already exited off the floor', () => {
      const db = openHermesDb();
      hermesSession(db, 'exited', '/work/old', [toolStart('old', 'terminal', { command: 'ls' })]);
      endSession(db, 'exited', 'user_exit');
      hermesSession(db, 'idle', '/work/idle', [
        toolStart('old', 'terminal', { command: 'ls' }),
        turnEnded,
      ]);
      runtime = new AgentRuntime(store, { agents: [hermesModule], multiplexers: [] });
      runtime.startModules();
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS * 3);

      const id = onlyAgentId();
      expect(store.get(id)?.folderName).toBe('idle');
      expect(ofType('agentToolStart')).toEqual([]);
    });
  });

  describe('both: herdr and hermes', () => {
    it('a hermes session herdr names by its own session id is one character with its tool activity and the pane name, task and approval', () => {
      const db = openHermesDb();
      const mux = fakeMultiplexer();
      hermesSession(db, 'in-pane', '/work/alpha', [userPrompt]);
      runtime = new AgentRuntime(store, { agents: [hermesModule], multiplexers: [mux.module] });
      runtime.startModules();

      mux.publish([pane({ sessionRef: 'in-pane', cwd: '/work/alpha' })]);
      const id = onlyAgentId();
      expect(ofType('agentInfo').at(-1)).toMatchObject({ id, name: 'alpha' });

      appendMessage(db, 'in-pane', toolStart('t1', 'patch', { path: 'src/app.ts' }));
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentToolStart')).toEqual([
        expect.objectContaining({ id, status: 'Editing app.ts' }),
      ]);

      mux.publish([pane({ sessionRef: 'in-pane', cwd: '/work/alpha', status: 'blocked' })]);
      expect(ofType('agentToolPermission')).toEqual([{ type: 'agentToolPermission', id }]);
    });
  });
});
