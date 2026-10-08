import { DatabaseSync } from 'node:sqlite';

import * as fs from 'fs';
import type * as NodeOs from 'os';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MultiplexedAgent, MultiplexerModule } from '../../core/src/provider.js';
import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { devinModule } from '../src/providers/devin/devin.js';
import { SESSION_POLL_INTERVAL_MS } from '../src/providers/sessionStore/constants.js';

let tmpHome: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof NodeOs>('os');
  return { ...actual, homedir: () => tmpHome };
});

type Message = Record<string, unknown>;

/** Devin's session store, built to the schema the module reads: `sessions` + `message_nodes`, with
 *  `main_chain_id` kept pointing at the latest node, the way the CLI itself advances it. */
function openDevinDb(): DatabaseSync {
  const dir = path.join(tmpHome, '.local', 'share', 'devin', 'cli');
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'sessions.db'));
  db.exec(`CREATE TABLE sessions (
    id TEXT PRIMARY KEY, working_directory TEXT, model TEXT, main_chain_id INTEGER,
    last_activity_at INTEGER, hidden INTEGER DEFAULT 0, created_at INTEGER)`);
  db.exec(`CREATE TABLE message_nodes (
    row_id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, node_id INTEGER,
    parent_node_id INTEGER, chat_message TEXT, created_at INTEGER)`);
  return db;
}

let nextNodeId = 1;

function createDevinSession(db: DatabaseSync, id: string, cwd: string): void {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO sessions (id, working_directory, model, main_chain_id, last_activity_at, created_at)
     VALUES (?, ?, 'devin-model', NULL, ?, ?)`,
  ).run(id, cwd, now, now);
}

/** Append one message node to a session's active chain, advancing `main_chain_id` the way Devin does. */
function appendDevinNode(db: DatabaseSync, sessionId: string, message: Message): void {
  const nodeId = nextNodeId++;
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO message_nodes (session_id, node_id, parent_node_id, chat_message, created_at)
     VALUES (?, ?, NULL, ?, ?)`,
  ).run(sessionId, nodeId, JSON.stringify(message), now);
  db.prepare(`UPDATE sessions SET main_chain_id = ?, last_activity_at = ? WHERE id = ?`).run(
    nodeId,
    now,
    sessionId,
  );
}

const userPrompt: Message = { role: 'user', content: 'add a login page' };
const assistantToolCall = (
  toolCallId: string,
  name: string,
  args: Record<string, unknown>,
): Message => ({
  role: 'assistant',
  content: '',
  tool_calls: [{ id: toolCallId, name, arguments: args }],
});
const toolResult = (toolCallId: string): Message => ({
  role: 'tool',
  tool_call_id: toolCallId,
  content: 'ok',
});
const turnEnded: Message = { role: 'assistant', content: 'Done.', tool_calls: [] };

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
    agentKind: 'devin',
    status: 'working',
    cwd: path.join(os.tmpdir(), 'pxl-untracked-devin-pane'),
    name: 'cobalt-fruit',
    task: 'Add a login page',
    ...overrides,
  };
}

describe('devin module', () => {
  let store: AgentStateStore;
  let runtime: AgentRuntime | undefined;
  let messages: Message[];
  let db: DatabaseSync | undefined;
  let previousXdgDataHome: string | undefined;

  const ofType = (type: string) => messages.filter((m) => m.type === type);
  const onlyAgentId = (): number => {
    expect(store.size).toBe(1);
    return [...store.keys()][0];
  };

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-devin-'));
    previousXdgDataHome = process.env['XDG_DATA_HOME'];
    delete process.env['XDG_DATA_HOME'];
    nextNodeId = 1;
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
    if (previousXdgDataHome === undefined) delete process.env['XDG_DATA_HOME'];
    else process.env['XDG_DATA_HOME'] = previousXdgDataHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  describe('agent only: devin, no multiplexer', () => {
    it('a live Devin session appears once with its folder name from cwd, reports tool activity, and goes idle when its turn ends', () => {
      db = openDevinDb();
      createDevinSession(db, 'cobalt-fruit', '/work/monopoly');
      appendDevinNode(db, 'cobalt-fruit', userPrompt);

      runtime = new AgentRuntime(store, { agents: [devinModule], multiplexers: [] });
      runtime.startModules();

      const id = onlyAgentId();
      expect(store.get(id)?.folderName).toBe('monopoly');
      expect(ofType('agentStatus').at(-1)).toMatchObject({ id, status: 'active' });

      appendDevinNode(
        db,
        'cobalt-fruit',
        assistantToolCall('call_1', 'read', { file_path: '/work/monopoly/PLAN.md' }),
      );
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentToolStart')).toContainEqual(
        expect.objectContaining({ id, status: 'Reading PLAN.md', toolName: 'read' }),
      );

      appendDevinNode(db, 'cobalt-fruit', toolResult('call_1'));
      appendDevinNode(db, 'cobalt-fruit', turnEnded);
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentStatus').at(-1)).toMatchObject({ id, status: 'waiting' });
    });

    it('never replays history: a session discovered mid-turn starts active with no backfilled tool activity', () => {
      db = openDevinDb();
      createDevinSession(db, 'already-running', '/work/old');
      appendDevinNode(db, 'already-running', userPrompt);
      appendDevinNode(
        db,
        'already-running',
        assistantToolCall('call_old', 'exec', { command: 'ls' }),
      );

      runtime = new AgentRuntime(store, { agents: [devinModule], multiplexers: [] });
      runtime.startModules();
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS * 3);

      const id = onlyAgentId();
      expect(store.get(id)?.folderName).toBe('old');
      expect(ofType('agentStatus').at(-1)).toMatchObject({ id, status: 'active' });
      expect(ofType('agentToolStart')).toEqual([]);
    });
  });

  describe('both: herdr and devin', () => {
    it('a Devin pane herdr names by session id is one character with its store tool activity', () => {
      const mux = fakeMultiplexer();
      db = openDevinDb();
      createDevinSession(db, 'cobalt-fruit', '/work/delta');
      appendDevinNode(db, 'cobalt-fruit', userPrompt);

      runtime = new AgentRuntime(store, { agents: [devinModule], multiplexers: [mux.module] });
      runtime.startModules();

      mux.publish([pane({ name: 'delta', sessionRef: 'cobalt-fruit' })]);
      const id = onlyAgentId();
      expect(ofType('agentInfo').at(-1)).toMatchObject({ id, name: 'delta' });

      appendDevinNode(
        db,
        'cobalt-fruit',
        assistantToolCall('call_2', 'str_replace', { file_path: '/work/delta/app.ts' }),
      );
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(onlyAgentId()).toBe(id);
      expect(ofType('agentToolStart')).toContainEqual(
        expect.objectContaining({ id, status: 'Editing app.ts', toolName: 'str_replace' }),
      );

      mux.publish([pane({ sessionRef: 'cobalt-fruit', status: 'blocked' })]);
      expect(ofType('agentToolPermission')).toContainEqual(
        expect.objectContaining({ type: 'agentToolPermission', id }),
      );

      // devin's own store discovery still tracks the session once herdr's pane is gone: still one character.
      mux.publish([]);
      expect(onlyAgentId()).toBe(id);
    });
  });
});
