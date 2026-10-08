import * as fs from 'node:fs';
import type * as NodeSqlite from 'node:sqlite';
import type { DatabaseSync } from 'node:sqlite';

import type { AgentEvent } from '../../../../core/src/provider.js';
import type {
  ListedSession,
  SessionCursor,
  SessionState,
  SessionStore,
} from './sessionStoreTracker.js';

export type SqliteRow = Record<string, unknown>;

/** How one CLI's SQLite session store reads. Every query runs on a read-only connection. */
export interface SqliteFormat {
  /** Sessions in the store: `key` is the CLI's session id, `size` a watermark that grows with every new record (the
   *  highest record row id is the usual choice). */
  listSessions(db: DatabaseSync): ListedSession[];
  /** The session's working directory, or '' when the store does not say. */
  cwd(db: DatabaseSync, key: string): string;
  /** The session's current watermark: records past it are new. */
  watermark(db: DatabaseSync, key: string): number;
  /** Where the session stands now, from its last records. */
  state(db: DatabaseSync, key: string): SessionState;
  /** Events for records past `watermark`, in order, and the watermark after them. */
  readSince(
    db: DatabaseSync,
    key: string,
    watermark: number,
  ): { events: AgentEvent[]; watermark: number };
}

/** `node:sqlite` loads only when a SQLite-backed module runs, so the other modules work on runtimes without it. */
function openReadOnly(file: string): DatabaseSync | null {
  if (!fs.existsSync(file)) return null;
  try {
    const sqlite = process.getBuiltinModule('node:sqlite') as typeof NodeSqlite | undefined;
    return sqlite ? new sqlite.DatabaseSync(file, { readOnly: true }) : null;
  } catch {
    return null; // locked mid-migration
  }
}

/**
 * A session store kept in one SQLite database. The connection is opened lazily and reopened after any failed query,
 * since the CLI may replace or migrate the file while it runs.
 */
export function sqliteSessionStore(databaseFile: () => string, format: SqliteFormat): SessionStore {
  let db: DatabaseSync | null = null;
  const query = <T>(run: (db: DatabaseSync) => T, fallback: T): T => {
    db ??= openReadOnly(databaseFile());
    if (!db) return fallback;
    try {
      return run(db);
    } catch {
      db.close();
      db = null;
      return fallback;
    }
  };

  return {
    listSessions: () => query((d) => format.listSessions(d), []),
    canonicalKey: (sessionRef) => sessionRef,
    open(key): SessionCursor | null {
      const opened = query(
        (d) => ({
          cwd: format.cwd(d, key),
          state: format.state(d, key),
          watermark: format.watermark(d, key),
        }),
        null,
      );
      if (!opened) return null;
      let watermark = opened.watermark;
      return {
        cwd: opened.cwd,
        state: opened.state,
        get size() {
          return watermark;
        },
        read() {
          return query((d) => {
            const result = format.readSince(d, key, watermark);
            watermark = result.watermark;
            return result.events;
          }, []);
        },
      };
    },
  };
}
