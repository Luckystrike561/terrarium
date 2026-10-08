/**
 * OpenCode's SQLite store (session row + turn rows; see `constants.ts` for table names and the V1/V2 split). Every
 * turn row is rewritten in place while it's open, not appended once complete, so a poll must re-read the still-open
 * row rather than trust that a stable `seq`/`rowid` means stable content:
 *
 *   session_message (V2, one row per turn, `data` JSON by `type`):
 *     user                { text, files, agents, time: { created } }
 *     assistant           { agent, model, content: AssistantContent[], finish?, time: { created, completed? } }
 *     shell               { callID, command, output, time: { created, completed? } }
 *     agent-switched / model-switched / system / synthetic / compaction   not mapped (no tool/turn signal)
 *
 *   AssistantContent tool item: { type: 'tool', id, name, state: { status, input, ... } }
 *   status: pending (raw string input) -> running -> completed | error
 *
 *   message + part (V1, one message row + one part row per part, both rewritten in place):
 *     message.data        { role: 'user' } | { role: 'assistant', time: { created, completed? }, ... }
 *     part.data (type='tool') { callID, tool, state: { status, input, ... } }  (same status machine as V2)
 *
 * A turn is only reported settled once its row's `time.completed` is set: the CLI's own session code confirms
 * turns are built by repeated UPDATEs on one row, so an unsettled trailing row must be re-read rather than
 * advancing the watermark past it.
 *
 * Neither an approval wait nor a clean session exit is ever written to any of these tables: both are live-only
 * event-bus traffic in OpenCode, invisible to a store that only reads the database.
 */

import * as path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import type { AgentEvent } from '../../../../core/src/provider.js';
import { type JsonRecord, obj, parseJsonRecord, str } from '../sessionStore/jsonlSessionStore.js';
import type { SessionState } from '../sessionStore/sessionStoreTracker.js';
import type { SqliteFormat } from '../sessionStore/sqliteSessionStore.js';
import {
  OPENCODE_MESSAGE_TABLE,
  OPENCODE_PART_TABLE,
  OPENCODE_SESSION_MESSAGE_TABLE,
  OPENCODE_SESSION_TABLE_V1,
  OPENCODE_SESSION_TABLE_V2,
  OPENCODE_STATUS_DETAIL_MAX_LENGTH,
  OPENCODE_STATUS_MAX_LENGTH,
} from './constants.js';

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\u2026` : s;
}

// Kept separate from the SQLite format: a fork on the same schema, like Kilo Code, reuses the format as-is and
// supplies its own vocab here.

export interface OpencodeToolVocab {
  /** Tools that show the "reading" character animation instead of "typing". Backs `AgentModule.readingTools`
   *  directly, which requires a `ReadonlySet`. */
  readonly reading: ReadonlySet<string>;
  /** Tools that run a shell command, labeled "Running: <command>". */
  readonly command: Readonly<Record<string, true>>;
  /** Tools that spawn a sub-task, labeled "Subtask: <description>". */
  readonly subagentSpawn: Readonly<Record<string, true>>;
}

export const OPENCODE_TOOL_VOCAB: OpencodeToolVocab = {
  reading: new Set(['read', 'glob', 'grep', 'webfetch', 'websearch', 'lsp']),
  command: { bash: true, shell: true },
  subagentSpawn: { task: true },
};

/** Status text for an OpenCode tool call. `vocab` lets a schema-compatible fork (different tool names) reuse this
 *  without forking the switch below. */
export function opencodeFormatToolStatus(
  toolName: string,
  input?: unknown,
  vocab: OpencodeToolVocab = OPENCODE_TOOL_VOCAB,
): string {
  const args = (input ?? {}) as JsonRecord;
  const file = path.basename(str(args['path']) ?? str(args['filePath']) ?? '');

  if (vocab.command[toolName]) {
    const command = str(args['command']);
    return command
      ? `Running: ${truncate(command, OPENCODE_STATUS_DETAIL_MAX_LENGTH)}`
      : 'Running a command';
  }
  if (vocab.subagentSpawn[toolName]) {
    const description = str(args['description']) ?? str(args['prompt']) ?? '';
    return description
      ? `Subtask: ${truncate(description, OPENCODE_STATUS_DETAIL_MAX_LENGTH)}`
      : 'Running subtask';
  }
  switch (toolName) {
    case 'read':
      return `Reading ${file}`.trim();
    case 'write':
      return `Writing ${file}`.trim();
    case 'edit':
    case 'patch':
    case 'apply_patch':
      return `Editing ${file}`.trim();
    case 'glob':
    case 'grep':
    case 'lsp':
      return 'Searching code';
    case 'webfetch':
      return 'Fetching web content';
    case 'websearch':
      return 'Searching the web';
    case 'todowrite':
      return 'Planning tasks';
    default:
      return truncate(toolName, OPENCODE_STATUS_MAX_LENGTH);
  }
}

interface DiffState {
  readonly startedTools: Set<string>;
  readonly endedTools: Set<string>;
}

interface ToolSighting {
  readonly toolId: string;
  readonly toolName: string;
  readonly status: string | undefined;
  readonly input: unknown;
}

function diffToolSighting(sighting: ToolSighting, diff: DiffState): AgentEvent[] {
  const events: AgentEvent[] = [];
  if (!diff.startedTools.has(sighting.toolId)) {
    diff.startedTools.add(sighting.toolId);
    events.push({
      kind: 'toolStart',
      toolId: sighting.toolId,
      toolName: sighting.toolName,
      input: sighting.input,
    });
  }
  if (
    (sighting.status === 'completed' || sighting.status === 'error') &&
    !diff.endedTools.has(sighting.toolId)
  ) {
    diff.endedTools.add(sighting.toolId);
    events.push({ kind: 'toolEnd', toolId: sighting.toolId });
  }
  return events;
}

function toolSightingsFromV2Content(content: unknown[]): ToolSighting[] {
  const sightings: ToolSighting[] = [];
  for (const item of content) {
    const entry = obj(item);
    if (entry['type'] !== 'tool') continue;
    const toolId = str(entry['id']);
    const toolName = str(entry['name']);
    if (!toolId || !toolName) continue;
    const state = obj(entry['state']);
    sightings.push({ toolId, toolName, status: str(state['status']), input: obj(state['input']) });
  }
  return sightings;
}

function tableNames(db: DatabaseSync): Set<string> {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
    name: string;
  }[];
  return new Set(rows.map((row) => row.name));
}

function parseData(raw: unknown): JsonRecord | null {
  return typeof raw === 'string' ? parseJsonRecord(raw) : null;
}

function isV2RowSettled(type: string, data: JsonRecord): boolean {
  if (type === 'assistant' || type === 'shell') return Boolean(obj(data['time'])['completed']);
  return true; // user, and every one-shot record type, settles the moment it's written
}

function isV1MessageSettled(data: JsonRecord): boolean {
  if (data['role'] === 'assistant') return Boolean(obj(data['time'])['completed']);
  return true; // user settles the moment it's written
}

/** Builds a fresh `SqliteFormat` for OpenCode's schema, isolated from any other instance: its table-existence cache
 *  and per-session tool-diff state live in this call's own closure, so a schema-compatible fork (Kilo Code) can call
 *  this again against its own database without sharing state. */
export function opencodeSqliteFormat(): SqliteFormat {
  const tableCache = new WeakMap<DatabaseSync, Set<string>>();
  const diffStates = new Map<string, DiffState>();

  const tables = (db: DatabaseSync): Set<string> => {
    let cached = tableCache.get(db);
    if (!cached) {
      cached = tableNames(db);
      tableCache.set(db, cached);
    }
    return cached;
  };

  const hasV1Tables = (db: DatabaseSync): boolean =>
    tables(db).has(OPENCODE_MESSAGE_TABLE) && tables(db).has(OPENCODE_PART_TABLE);
  const usesV2 = (db: DatabaseSync, sessionId: string): boolean => {
    if (!tables(db).has(OPENCODE_SESSION_MESSAGE_TABLE)) return false;
    const row = db
      .prepare(`SELECT 1 FROM ${OPENCODE_SESSION_MESSAGE_TABLE} WHERE session_id = ? LIMIT 1`)
      .get(sessionId);
    return Boolean(row);
  };
  const diffStateFor = (key: string): DiffState => {
    let state = diffStates.get(key);
    if (!state) {
      state = { startedTools: new Set(), endedTools: new Set() };
      diffStates.set(key, state);
    }
    return state;
  };

  function latestV2Row(
    db: DatabaseSync,
    sessionId: string,
  ): { seq: number; type: string; data: JsonRecord } | null {
    const row = db
      .prepare(
        `SELECT seq, type, data FROM ${OPENCODE_SESSION_MESSAGE_TABLE} WHERE session_id = ? ORDER BY seq DESC LIMIT 1`,
      )
      .get(sessionId) as { seq: number; type: string; data: unknown } | undefined;
    if (!row) return null;
    const data = parseData(row.data);
    return data ? { seq: row.seq, type: row.type, data } : null;
  }

  function latestV1Message(
    db: DatabaseSync,
    sessionId: string,
  ): { rowid: number; data: JsonRecord } | null {
    const row = db
      .prepare(
        `SELECT rowid AS r, data FROM ${OPENCODE_MESSAGE_TABLE} WHERE session_id = ? ORDER BY rowid DESC LIMIT 1`,
      )
      .get(sessionId) as { r: number; data: unknown } | undefined;
    if (!row) return null;
    const data = parseData(row.data);
    return data ? { rowid: row.r, data } : null;
  }

  function toolSightingsFromV1Parts(db: DatabaseSync, messageId: string): ToolSighting[] {
    const rows = db
      .prepare(`SELECT data FROM ${OPENCODE_PART_TABLE} WHERE message_id = ?`)
      .all(messageId) as { data: unknown }[];
    const sightings: ToolSighting[] = [];
    for (const row of rows) {
      const data = parseData(row.data);
      if (!data || data['type'] !== 'tool') continue;
      const toolId = str(data['callID']);
      const toolName = str(data['tool']);
      if (!toolId || !toolName) continue;
      const state = obj(data['state']);
      sightings.push({
        toolId,
        toolName,
        status: str(state['status']),
        input: obj(state['input']),
      });
    }
    return sightings;
  }

  function scanV2(
    db: DatabaseSync,
    sessionId: string,
    fromSeq: number,
    diff: DiffState,
  ): { events: AgentEvent[]; watermark: number } {
    const rows = db
      .prepare(
        `SELECT seq, type, data FROM ${OPENCODE_SESSION_MESSAGE_TABLE} WHERE session_id = ? AND seq > ? ORDER BY seq ASC`,
      )
      .all(sessionId, fromSeq) as { seq: number; type: string; data: unknown }[];
    const events: AgentEvent[] = [];
    let watermark = fromSeq;
    let advancing = true;
    for (const row of rows) {
      const data = parseData(row.data);
      if (!data) {
        if (advancing) watermark = row.seq;
        continue;
      }
      if (row.type === 'user') {
        events.push({ kind: 'working' });
      } else if (row.type === 'assistant') {
        const content = Array.isArray(data['content']) ? data['content'] : [];
        for (const sighting of toolSightingsFromV2Content(content)) {
          events.push(...diffToolSighting(sighting, diff));
        }
        if (obj(data['time'])['completed']) events.push({ kind: 'turnEnd' });
      } else if (row.type === 'shell') {
        const toolId = str(data['callID']);
        if (toolId) {
          events.push(
            ...diffToolSighting(
              {
                toolId,
                toolName: 'shell',
                status: obj(data['time'])['completed'] ? 'completed' : 'running',
                input: { command: str(data['command']) },
              },
              diff,
            ),
          );
        }
      }
      if (advancing && isV2RowSettled(row.type, data)) watermark = row.seq;
      else advancing = false;
    }
    return { events, watermark };
  }

  function scanV1(
    db: DatabaseSync,
    sessionId: string,
    fromRowid: number,
    diff: DiffState,
  ): { events: AgentEvent[]; watermark: number } {
    const rows = db
      .prepare(
        `SELECT rowid AS r, id, data FROM ${OPENCODE_MESSAGE_TABLE} WHERE session_id = ? AND rowid > ? ORDER BY rowid ASC`,
      )
      .all(sessionId, fromRowid) as { r: number; id: string; data: unknown }[];
    const events: AgentEvent[] = [];
    let watermark = fromRowid;
    let advancing = true;
    for (const row of rows) {
      const data = parseData(row.data);
      if (!data) {
        if (advancing) watermark = row.r;
        continue;
      }
      if (data['role'] === 'user') {
        events.push({ kind: 'working' });
      } else if (data['role'] === 'assistant') {
        for (const sighting of toolSightingsFromV1Parts(db, row.id)) {
          events.push(...diffToolSighting(sighting, diff));
        }
        if (obj(data['time'])['completed']) events.push({ kind: 'turnEnd' });
      }
      if (advancing && isV1MessageSettled(data)) watermark = row.r;
      else advancing = false;
    }
    return { events, watermark };
  }

  return {
    listSessions(db) {
      const table = tables(db).has(OPENCODE_SESSION_TABLE_V2)
        ? OPENCODE_SESSION_TABLE_V2
        : OPENCODE_SESSION_TABLE_V1;
      const rows = db.prepare(`SELECT id, time_updated FROM ${table}`).all() as {
        id: string;
        time_updated: number;
      }[];
      return rows.map((row) => ({
        key: row.id,
        mtimeMs: row.time_updated,
        size: row.time_updated,
      }));
    },

    cwd(db, key) {
      const table = tables(db).has(OPENCODE_SESSION_TABLE_V2)
        ? OPENCODE_SESSION_TABLE_V2
        : OPENCODE_SESSION_TABLE_V1;
      const row = db.prepare(`SELECT directory FROM ${table} WHERE id = ?`).get(key) as
        { directory: string } | undefined;
      return row?.directory ?? '';
    },

    state(db, key): SessionState {
      if (usesV2(db, key)) {
        const latest = latestV2Row(db, key);
        if (!latest) return 'idle';
        if (latest.type === 'user') return 'working';
        return isV2RowSettled(latest.type, latest.data) ? 'idle' : 'working';
      }
      if (hasV1Tables(db)) {
        const latest = latestV1Message(db, key);
        if (!latest) return 'idle';
        if (latest.data['role'] === 'user') return 'working';
        return isV1MessageSettled(latest.data) ? 'idle' : 'working';
      }
      return 'idle';
    },

    watermark(db, key) {
      if (usesV2(db, key)) {
        const latest = latestV2Row(db, key);
        if (!latest) return 0;
        return isV2RowSettled(latest.type, latest.data) ? latest.seq : latest.seq - 1;
      }
      if (hasV1Tables(db)) {
        const latest = latestV1Message(db, key);
        if (!latest) return 0;
        return isV1MessageSettled(latest.data) ? latest.rowid : latest.rowid - 1;
      }
      return 0;
    },

    readSince(db, key, watermark) {
      const diff = diffStateFor(key);
      if (usesV2(db, key)) return scanV2(db, key, watermark, diff);
      if (hasV1Tables(db)) return scanV1(db, key, watermark, diff);
      return { events: [], watermark };
    },
  };
}
