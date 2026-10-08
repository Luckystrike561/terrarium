import { DatabaseSync } from 'node:sqlite';

import * as fs from 'fs';
import type * as NodeOs from 'os';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MultiplexedAgent, MultiplexerModule } from '../../core/src/provider.js';
import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { kiloModule } from '../src/providers/kilo/kilo.js';
import { SESSION_POLL_INTERVAL_MS } from '../src/providers/sessionStore/constants.js';

let tmpHome: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof NodeOs>('os');
  return { ...actual, homedir: () => tmpHome };
});

type Message = Record<string, unknown>;

/** Kilo's session store, built to the schema the module reads: `session` + `message` + `part`, OpenCode's SQLite
 *  layout (confirmed against a live `kilo.db`: all three tables exist with these columns). A tool call is one
 *  `part` row upserted in place as its `state.status` moves pending -> completed, the way Kilo writes it. */
function openKiloDb(): DatabaseSync {
  const dir = path.join(tmpHome, '.local', 'share', 'kilo');
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'kilo.db'));
  db.exec(
    'CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, time_created INTEGER, time_updated INTEGER)',
  );
  db.exec(
    'CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT)',
  );
  db.exec(
    'CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT)',
  );
  return db;
}

let clock = Date.now();
let nextId = 1;

function createKiloSession(db: DatabaseSync, id: string, cwd: string): void {
  clock += 10;
  db.prepare(
    'INSERT INTO session (id, directory, time_created, time_updated) VALUES (?, ?, ?, ?)',
  ).run(id, cwd, clock, clock);
}

function touchSession(db: DatabaseSync, sessionId: string): void {
  db.prepare('UPDATE session SET time_updated = ? WHERE id = ?').run(clock, sessionId);
}

/** A user prompt lands: a new `message` row, role 'user'. */
function appendUserMessage(db: DatabaseSync, sessionId: string): void {
  clock += 10;
  const id = `msg_${nextId++}`;
  const data: Message = { role: 'user', time: { created: clock } };
  db.prepare(
    'INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)',
  ).run(id, sessionId, clock, clock, JSON.stringify(data));
  touchSession(db, sessionId);
}

/** The assistant's turn starts: an empty `message` row, role 'assistant', `time.completed` unset. Returns its id
 *  so tool parts and the eventual completion can target it. */
function startAssistantMessage(db: DatabaseSync, sessionId: string): string {
  clock += 10;
  const id = `msg_${nextId++}`;
  const data: Message = { role: 'assistant', time: { created: clock } };
  db.prepare(
    'INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)',
  ).run(id, sessionId, clock, clock, JSON.stringify(data));
  touchSession(db, sessionId);
  return id;
}

/** Sets the assistant message's `time.completed` in place -- the only turn-end signal Kilo persists. */
function completeAssistantMessage(db: DatabaseSync, sessionId: string, messageId: string): void {
  const row = db.prepare('SELECT data FROM message WHERE id = ?').get(messageId) as {
    data: string;
  };
  const data = JSON.parse(row.data) as { time: { created: number; completed?: number } };
  clock += 10;
  data.time.completed = clock;
  db.prepare('UPDATE message SET time_updated = ?, data = ? WHERE id = ?').run(
    clock,
    JSON.stringify(data),
    messageId,
  );
  touchSession(db, sessionId);
}

/** A tool call starts: one `part` row, status 'pending'. Returns its id so the completion can target the same row,
 *  the way Kilo upserts it in place. */
function startTool(
  db: DatabaseSync,
  sessionId: string,
  messageId: string,
  callId: string,
  toolName: string,
  input: Record<string, unknown>,
): string {
  clock += 10;
  const id = `prt_${nextId++}`;
  const data = {
    type: 'tool',
    callID: callId,
    tool: toolName,
    state: { status: 'pending', input },
  };
  db.prepare(
    'INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, messageId, sessionId, clock, clock, JSON.stringify(data));
  touchSession(db, sessionId);
  return id;
}

/** The same tool call's part row moves to 'completed' -- an UPSERT in place, the way Kilo writes it. */
function completeTool(db: DatabaseSync, sessionId: string, partId: string): void {
  const row = db.prepare('SELECT data FROM part WHERE id = ?').get(partId) as { data: string };
  const data = JSON.parse(row.data) as { state: { status: string } };
  clock += 10;
  data.state.status = 'completed';
  db.prepare('UPDATE part SET time_updated = ?, data = ? WHERE id = ?').run(
    clock,
    JSON.stringify(data),
    partId,
  );
  touchSession(db, sessionId);
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
    agentKind: 'kilo',
    status: 'working',
    cwd: path.join(os.tmpdir(), 'pxl-untracked-kilo-pane'),
    name: 'teal-otter',
    task: 'Add a login page',
    ...overrides,
  };
}

describe('kilo module', () => {
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
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-kilo-'));
    previousXdgDataHome = process.env['XDG_DATA_HOME'];
    delete process.env['XDG_DATA_HOME'];
    nextId = 1;
    clock = Date.now();
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

  describe('agent only: kilo, no multiplexer', () => {
    it('a live Kilo session appears once with its folder name from cwd, reports tool activity, and goes idle when its turn ends', () => {
      db = openKiloDb();
      createKiloSession(db, 'ses_abc', '/work/monopoly');
      appendUserMessage(db, 'ses_abc');

      runtime = new AgentRuntime(store, { agents: [kiloModule], multiplexers: [] });
      runtime.startModules();

      const id = onlyAgentId();
      expect(store.get(id)?.folderName).toBe('monopoly');
      expect(ofType('agentStatus').at(-1)).toMatchObject({ id, status: 'active' });

      const msgId = startAssistantMessage(db, 'ses_abc');
      const partId = startTool(db, 'ses_abc', msgId, 'call_1', 'read', {
        path: '/work/monopoly/PLAN.md',
      });
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentToolStart')).toContainEqual(
        expect.objectContaining({ id, status: 'Reading PLAN.md', toolName: 'read' }),
      );

      completeTool(db, 'ses_abc', partId);
      completeAssistantMessage(db, 'ses_abc', msgId);
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentStatus').at(-1)).toMatchObject({ id, status: 'waiting' });
    });

    it('never replays history: a session discovered after a completed turn starts idle with no backfilled tool activity', () => {
      db = openKiloDb();
      createKiloSession(db, 'ses_old', '/work/old');
      appendUserMessage(db, 'ses_old');
      const msgId = startAssistantMessage(db, 'ses_old');
      const partId = startTool(db, 'ses_old', msgId, 'call_old', 'bash', { command: 'ls' });
      completeTool(db, 'ses_old', partId);
      completeAssistantMessage(db, 'ses_old', msgId);

      runtime = new AgentRuntime(store, { agents: [kiloModule], multiplexers: [] });
      runtime.startModules();
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS * 3);

      const id = onlyAgentId();
      expect(store.get(id)?.folderName).toBe('old');
      expect(ofType('agentStatus').at(-1)).toMatchObject({ id, status: 'waiting' });
      expect(ofType('agentToolStart')).toEqual([]);
    });
  });

  describe('both: herdr and kilo', () => {
    it('a Kilo pane herdr names by session id is one character with its store tool activity and approval', () => {
      const mux = fakeMultiplexer();
      db = openKiloDb();
      createKiloSession(db, 'ses_abc', '/work/delta');
      appendUserMessage(db, 'ses_abc');

      runtime = new AgentRuntime(store, { agents: [kiloModule], multiplexers: [mux.module] });
      runtime.startModules();

      // kilo's own discovery already found this session: the pane must join it, not duplicate it.
      mux.publish([pane({ name: 'delta', sessionRef: 'ses_abc' })]);
      const id = onlyAgentId();
      expect(ofType('agentInfo').at(-1)).toMatchObject({ id, name: 'delta' });

      const msgId = startAssistantMessage(db, 'ses_abc');
      const partId = startTool(db, 'ses_abc', msgId, 'call_2', 'edit', {
        path: '/work/delta/app.ts',
      });
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(onlyAgentId()).toBe(id);
      expect(ofType('agentToolStart')).toContainEqual(
        expect.objectContaining({ id, status: 'Editing app.ts', toolName: 'edit' }),
      );
      completeTool(db, 'ses_abc', partId);

      mux.publish([pane({ sessionRef: 'ses_abc', status: 'blocked' })]);
      expect(ofType('agentToolPermission')).toContainEqual(
        expect.objectContaining({ type: 'agentToolPermission', id }),
      );

      // kilo's own discovery still finds this session in the db regardless of the pane: it is not removed.
      mux.publish([]);
      expect(store.size).toBe(1);
    });
  });
});
