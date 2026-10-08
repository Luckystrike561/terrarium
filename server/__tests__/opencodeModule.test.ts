import { DatabaseSync } from 'node:sqlite';

import * as fs from 'fs';
import type * as NodeOs from 'os';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MultiplexedAgent, MultiplexerModule } from '../../core/src/provider.js';
import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { opencodeModule } from '../src/providers/opencode/opencode.js';
import { SESSION_POLL_INTERVAL_MS } from '../src/providers/sessionStore/constants.js';

// OpenCode's SQLite store and the server's ~/.pixel-agents/ both resolve against the home directory.
let tmpHome: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof NodeOs>('os');
  return { ...actual, homedir: () => tmpHome };
});

type Message = Record<string, unknown>;

/** Opens (creating if absent) the OpenCode database under the mocked home, with both the V2 (`session_message`) and
 *  the legacy V1 (`message` + `part`) turn-storage tables, mirroring a store upgraded from 1.x. */
function openOpencodeDb(): DatabaseSync {
  const dir = path.join(tmpHome, '.local', 'share', 'opencode');
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'opencode.db'));
  db.exec(`
    CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT NOT NULL, time_updated INTEGER NOT NULL);
    CREATE TABLE session_message (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL, seq INTEGER NOT NULL, data TEXT NOT NULL
    );
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, data TEXT NOT NULL);
  `);
  return db;
}

function insertSession(
  db: DatabaseSync,
  id: string,
  directory: string,
  timeUpdated = Date.now(),
): void {
  db.prepare('INSERT INTO session (id, directory, time_updated) VALUES (?, ?, ?)').run(
    id,
    directory,
    timeUpdated,
  );
}

let seq = 0;
function appendSessionMessage(
  db: DatabaseSync,
  sessionId: string,
  type: string,
  data: object,
): number {
  const rowSeq = ++seq;
  db.prepare(
    'INSERT INTO session_message (id, session_id, type, seq, data) VALUES (?, ?, ?, ?, ?)',
  ).run(`sm_${rowSeq}`, sessionId, type, rowSeq, JSON.stringify(data));
  return rowSeq;
}

function updateSessionMessage(db: DatabaseSync, rowSeq: number, data: object): void {
  db.prepare('UPDATE session_message SET data = ? WHERE seq = ?').run(JSON.stringify(data), rowSeq);
}

let msgCounter = 0;
function insertMessage(db: DatabaseSync, sessionId: string, data: object): string {
  const id = `msg_${++msgCounter}`;
  db.prepare('INSERT INTO message (id, session_id, data) VALUES (?, ?, ?)').run(
    id,
    sessionId,
    JSON.stringify(data),
  );
  return id;
}

function updateMessage(db: DatabaseSync, id: string, data: object): void {
  db.prepare('UPDATE message SET data = ? WHERE id = ?').run(JSON.stringify(data), id);
}

let partCounter = 0;
function insertPart(db: DatabaseSync, messageId: string, sessionId: string, data: object): string {
  const id = `prt_${++partCounter}`;
  db.prepare('INSERT INTO part (id, message_id, session_id, data) VALUES (?, ?, ?, ?)').run(
    id,
    messageId,
    sessionId,
    JSON.stringify(data),
  );
  return id;
}

function updatePart(db: DatabaseSync, id: string, data: object): void {
  db.prepare('UPDATE part SET data = ? WHERE id = ?').run(JSON.stringify(data), id);
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
    agentKind: 'opencode',
    status: 'working',
    cwd: path.join(os.tmpdir(), 'pxl-untracked-pane'),
    name: 'alpha',
    task: 'Ship the release',
    ...overrides,
  };
}

describe('opencode module', () => {
  let store: AgentStateStore;
  let runtime: AgentRuntime | undefined;
  let messages: Message[];
  let db: DatabaseSync | undefined;

  const ofType = (type: string) => messages.filter((m) => m.type === type);
  const onlyAgentId = (): number => {
    expect(store.size).toBe(1);
    return [...store.keys()][0];
  };

  let savedXdgDataHome: string | undefined;
  let savedOpencodeDb: string | undefined;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-opencode-'));
    // The module resolves its database path through these two env vars before falling back to the (mocked)
    // home directory; a host environment that happens to set either would otherwise leak outside the test.
    savedXdgDataHome = process.env.XDG_DATA_HOME;
    savedOpencodeDb = process.env.OPENCODE_DB;
    delete process.env.XDG_DATA_HOME;
    delete process.env.OPENCODE_DB;
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    store = new AgentStateStore();
    messages = [];
    store.on('broadcast', (m) => messages.push(m as Message));
    seq = 0;
    msgCounter = 0;
    partCounter = 0;
  });

  const restoreEnv = (key: string, value: string | undefined) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };

  afterEach(() => {
    runtime?.dispose();
    runtime = undefined;
    db?.close();
    db = undefined;
    vi.useRealTimers();
    fs.rmSync(tmpHome, { recursive: true, force: true });
    restoreEnv('XDG_DATA_HOME', savedXdgDataHome);
    restoreEnv('OPENCODE_DB', savedOpencodeDb);
  });

  describe('V2 storage (session_message)', () => {
    it('a running session appears with its tool activity and goes idle when its turn ends', () => {
      db = openOpencodeDb();
      insertSession(db, 'ses_live', '/work/monopoly');
      appendSessionMessage(db, 'ses_live', 'user', { text: 'go', time: { created: 1 } });
      runtime = new AgentRuntime(store, { agents: [opencodeModule], multiplexers: [] });
      runtime.startModules();

      const id = onlyAgentId();
      expect(store.get(id)?.folderName).toBe('monopoly');
      expect(ofType('agentStatus').at(-1)).toMatchObject({ id, status: 'active' });

      const toolSeq = appendSessionMessage(db, 'ses_live', 'assistant', {
        agent: 'build',
        content: [
          {
            type: 'tool',
            id: 'call_1',
            name: 'read',
            state: { status: 'running', input: { path: '/work/monopoly/PLAN.md' } },
          },
        ],
        time: { created: 2 },
      });
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentToolStart')).toContainEqual(
        expect.objectContaining({ id, status: 'Reading PLAN.md', toolName: 'read' }),
      );

      updateSessionMessage(db, toolSeq, {
        agent: 'build',
        content: [
          {
            type: 'tool',
            id: 'call_1',
            name: 'read',
            state: { status: 'completed', input: { path: '/work/monopoly/PLAN.md' } },
          },
        ],
        finish: 'stop',
        time: { created: 2, completed: 3 },
      });
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentStatus').at(-1)).toMatchObject({ id, status: 'waiting' });
    });

    it('never replays history: a session already idle on discovery shows no past tool activity', () => {
      db = openOpencodeDb();
      insertSession(db, 'ses_idle', '/work/idle');
      appendSessionMessage(db, 'ses_idle', 'user', { text: 'go', time: { created: 1 } });
      appendSessionMessage(db, 'ses_idle', 'assistant', {
        agent: 'build',
        content: [
          {
            type: 'tool',
            id: 'call_old',
            name: 'bash',
            state: { status: 'completed', input: { command: 'ls' } },
          },
        ],
        finish: 'stop',
        time: { created: 1, completed: 2 },
      });
      runtime = new AgentRuntime(store, { agents: [opencodeModule], multiplexers: [] });
      runtime.startModules();
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS * 3);

      const id = onlyAgentId();
      expect(store.get(id)?.folderName).toBe('idle');
      expect(ofType('agentToolStart')).toEqual([]);
    });

    it('a shell record is reported as a toolStart/toolEnd pair', () => {
      db = openOpencodeDb();
      insertSession(db, 'ses_shell', '/work/shellproj');
      appendSessionMessage(db, 'ses_shell', 'user', { text: 'go', time: { created: 1 } });
      runtime = new AgentRuntime(store, { agents: [opencodeModule], multiplexers: [] });
      runtime.startModules();
      const id = onlyAgentId();

      const shellSeq = appendSessionMessage(db, 'ses_shell', 'shell', {
        callID: 'call_sh1',
        command: 'go vet ./...',
        output: '',
        time: { created: 2 },
      });
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentToolStart')).toContainEqual(
        expect.objectContaining({ id, status: 'Running: go vet ./...', toolName: 'shell' }),
      );

      updateSessionMessage(db, shellSeq, {
        callID: 'call_sh1',
        command: 'go vet ./...',
        output: 'ok',
        time: { created: 2, completed: 3 },
      });
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentToolDone')).toContainEqual(expect.objectContaining({ id }));
    });
  });

  describe('V1 storage (message + part): probed when session_message has no rows for the session', () => {
    it('a running session appears with its tool activity from part rows', () => {
      db = openOpencodeDb();
      insertSession(db, 'ses_v1', '/work/legacyproj');
      insertMessage(db, 'ses_v1', { role: 'user', time: { created: 1 } });
      runtime = new AgentRuntime(store, { agents: [opencodeModule], multiplexers: [] });
      runtime.startModules();
      const id = onlyAgentId();
      expect(store.get(id)?.folderName).toBe('legacyproj');

      const assistantId = insertMessage(db, 'ses_v1', {
        role: 'assistant',
        time: { created: 2 },
      });
      const partId = insertPart(db, assistantId, 'ses_v1', {
        type: 'tool',
        callID: 'call_v1',
        tool: 'edit',
        state: { status: 'running', input: { filePath: '/work/legacyproj/src/app.ts' } },
      });
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentToolStart')).toContainEqual(
        expect.objectContaining({ id, status: 'Editing app.ts', toolName: 'edit' }),
      );

      updatePart(db, partId, {
        type: 'tool',
        callID: 'call_v1',
        tool: 'edit',
        state: { status: 'completed', input: { filePath: '/work/legacyproj/src/app.ts' } },
      });
      updateMessage(db, assistantId, { role: 'assistant', time: { created: 2, completed: 3 } });
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentStatus').at(-1)).toMatchObject({ id, status: 'waiting' });
    });
  });

  describe('both: herdr and opencode', () => {
    it('a session in a herdr pane, named by its own session id, is one character not two', () => {
      db = openOpencodeDb();
      insertSession(db, 'ses_paired', '/work/alpha');
      appendSessionMessage(db, 'ses_paired', 'user', { text: 'go', time: { created: 1 } });
      const mux = fakeMultiplexer();
      runtime = new AgentRuntime(store, { agents: [opencodeModule], multiplexers: [mux.module] });
      runtime.startModules();
      expect(store.size).toBe(1);

      mux.publish([pane({ sessionRef: 'ses_paired' })]);
      expect(store.size).toBe(1);
      const id = onlyAgentId();
      expect(ofType('agentInfo').at(-1)).toMatchObject({ id, name: 'alpha' });

      mux.publish([pane({ sessionRef: 'ses_paired', status: 'blocked' })]);
      expect(ofType('agentToolPermission')).toContainEqual({ type: 'agentToolPermission', id });
    });
  });
});
