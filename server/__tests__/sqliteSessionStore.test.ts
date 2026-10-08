import { DatabaseSync } from 'node:sqlite';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentEvent } from '../../core/src/provider.js';
import type { SessionState } from '../src/providers/sessionStore/sessionStoreTracker.js';
import type { SqliteFormat } from '../src/providers/sessionStore/sqliteSessionStore.js';
import { sqliteSessionStore } from '../src/providers/sessionStore/sqliteSessionStore.js';

function createDatabase(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT, updated_at INTEGER);
    CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, kind TEXT, tool_id TEXT, tool_name TEXT);
  `);
  return db;
}

function insertSession(db: DatabaseSync, id: string, cwd: string, updatedAt = Date.now()): void {
  db.prepare('INSERT INTO sessions (id, cwd, updated_at) VALUES (?, ?, ?)').run(id, cwd, updatedAt);
}

function insertEvent(
  db: DatabaseSync,
  sessionId: string,
  kind: string,
  toolId = '',
  toolName = '',
): void {
  db.prepare('INSERT INTO events (session_id, kind, tool_id, tool_name) VALUES (?, ?, ?, ?)').run(
    sessionId,
    kind,
    toolId,
    toolName,
  );
}

function maxSeq(db: DatabaseSync, sessionId: string): number {
  const row = db
    .prepare('SELECT COALESCE(MAX(seq), 0) as top FROM events WHERE session_id = ?')
    .get(sessionId);
  return row ? (row['top'] as number) : 0;
}

/** A format built directly on the two-table fixture above, mirroring how a real CLI's SQLite store reads. */
const format: SqliteFormat = {
  listSessions(db) {
    const rows = db.prepare('SELECT id, updated_at FROM sessions').all();
    return rows.map((row) => ({
      key: row['id'] as string,
      mtimeMs: row['updated_at'] as number,
      size: maxSeq(db, row['id'] as string),
    }));
  },
  cwd(db, key) {
    const row = db.prepare('SELECT cwd FROM sessions WHERE id = ?').get(key);
    return row ? (row['cwd'] as string) : '';
  },
  watermark: (db, key) => maxSeq(db, key),
  state(db, key) {
    const row = db
      .prepare('SELECT kind FROM events WHERE session_id = ? ORDER BY seq DESC LIMIT 1')
      .get(key);
    const states: Record<string, SessionState> = { tool: 'working', end: 'idle', exit: 'exited' };
    return (row && states[row['kind'] as string]) || 'idle';
  },
  readSince(db, key, watermark) {
    const rows = db
      .prepare(
        'SELECT seq, kind, tool_id, tool_name FROM events WHERE session_id = ? AND seq > ? ORDER BY seq',
      )
      .all(key, watermark);
    const events: AgentEvent[] = rows.map((row) =>
      row['kind'] === 'tool'
        ? {
            kind: 'toolStart',
            toolId: row['tool_id'] as string,
            toolName: row['tool_name'] as string,
          }
        : { kind: 'turnEnd' },
    );
    const newWatermark = rows.length > 0 ? (rows.at(-1)!['seq'] as number) : watermark;
    return { events, watermark: newWatermark };
  },
};

let root: string;
let dbFile: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-session-store-'));
  dbFile = path.join(root, 'store.db');
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('sqliteSessionStore read-only access', () => {
  it('never writes to the database: a write attempted inside a format function is rejected and falls back', () => {
    const db = createDatabase(dbFile);
    insertSession(db, 's1', '/work/one');
    db.close();

    const writingCwd: SqliteFormat = {
      ...format,
      cwd(db, key) {
        db.prepare('UPDATE sessions SET cwd = ? WHERE id = ?').run('/tampered', key);
        return format.cwd(db, key);
      },
    };
    const store = sqliteSessionStore(() => dbFile, writingCwd);

    expect(store.open('s1')).toBeNull();

    const check = new DatabaseSync(dbFile, { readOnly: true });
    const row = check.prepare('SELECT cwd FROM sessions WHERE id = ?').get('s1');
    check.close();
    expect(row!['cwd']).toBe('/work/one');
  });

  it('leaves no journal or WAL file behind after reading', () => {
    const db = createDatabase(dbFile);
    insertSession(db, 's1', '/work/one');
    insertEvent(db, 's1', 'tool', 't1', 'Bash');
    db.close();

    const store = sqliteSessionStore(() => dbFile, format);
    store.listSessions();
    store.open('s1')?.read();

    expect(fs.existsSync(`${dbFile}-journal`)).toBe(false);
    expect(fs.existsSync(`${dbFile}-wal`)).toBe(false);
  });
});

describe('sqliteSessionStore new rows', () => {
  it('reads only rows inserted after the watermark the cursor opened at', () => {
    const db = createDatabase(dbFile);
    insertSession(db, 's1', '/work/one');
    insertEvent(db, 's1', 'tool', 'before', 'Bash');
    const store = sqliteSessionStore(() => dbFile, format);
    const cursor = store.open('s1')!;
    expect(cursor.read()).toEqual([]);

    insertEvent(db, 's1', 'tool', 'after', 'Read');
    insertEvent(db, 's1', 'end');
    expect(cursor.read()).toEqual([
      { kind: 'toolStart', toolId: 'after', toolName: 'Read' },
      { kind: 'turnEnd' },
    ]);
    expect(cursor.read()).toEqual([]);

    db.close();
  });
});

describe('sqliteSessionStore session identity', () => {
  it('keys sessions by the id the format reports, not by any file path', () => {
    const db = createDatabase(dbFile);
    insertSession(db, 'cli-assigned-id-42', '/work/project');
    db.close();

    const store = sqliteSessionStore(() => dbFile, format);
    const [listed] = store.listSessions();
    expect(listed.key).toBe('cli-assigned-id-42');
    expect(store.canonicalKey?.('cli-assigned-id-42')).toBe('cli-assigned-id-42');
    expect(store.open('cli-assigned-id-42')?.cwd).toBe('/work/project');
  });
});

describe('sqliteSessionStore missing database', () => {
  it('reports no sessions and refuses to open any, without throwing', () => {
    const store = sqliteSessionStore(() => path.join(root, 'does-not-exist.db'), format);
    expect(store.listSessions()).toEqual([]);
    expect(store.open('anything')).toBeNull();
  });

  it('starts reading again once the database file appears', () => {
    const missingFile = path.join(root, 'created-later.db');
    const store = sqliteSessionStore(() => missingFile, format);
    expect(store.listSessions()).toEqual([]);

    const db = createDatabase(missingFile);
    insertSession(db, 's1', '/work/one');
    db.close();

    expect(store.listSessions()).toEqual([{ key: 's1', mtimeMs: expect.any(Number), size: 0 }]);
  });
});

describe('sqliteSessionStore lazy loading', () => {
  it('never touches node:sqlite or the database file until the store is actually queried', () => {
    const db = createDatabase(dbFile);
    insertSession(db, 's1', '/work/one');
    db.close();

    const getBuiltinModule = vi.spyOn(process, 'getBuiltinModule');
    sqliteSessionStore(() => dbFile, format);
    expect(getBuiltinModule).not.toHaveBeenCalled();

    getBuiltinModule.mockRestore();
  });
});
