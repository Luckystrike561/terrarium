/**
 * Hermes' session store: one SQLite database, not JSONL. The rows that move a character, from the current
 * `sessions`/`messages` schema (schema version 31):
 *
 *   sessions.cwd, sessions.ended_at, sessions.end_reason      the session's directory and, once set, its exit
 *   messages.role = 'user'                                   a prompt lands, the turn starts
 *   messages.role = 'assistant', tool_calls non-empty JSON    one toolStart per call, the turn continues
 *   messages.role = 'assistant', tool_calls empty or NULL     the turn ends (mirrors classify_session_status)
 *   messages.role = 'tool'                                    a tool_call_id's result, the call ends
 *
 * tool_calls entries are `{id, function: {name, arguments}}`, arguments a JSON string or an already-parsed
 * object depending on the writer. `state()` reuses the session store's own classification rule: an
 * error-type finish_reason (error, agent_error, content_filter) is checked first, regardless of role, and
 * ends a turn the same as a clean one.
 */

import type { AgentEvent } from '../../../../core/src/provider.js';
import type { SessionState } from '../sessionStore/sessionStoreTracker.js';
import type { SqliteFormat, SqliteRow } from '../sessionStore/sqliteSessionStore.js';
import { HERMES_ERROR_FINISH_REASONS } from './constants.js';

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number => (typeof v === 'number' ? v : 0);

function parseToolCallsList(raw: unknown): unknown[] {
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

function toolStartEvents(toolCallsRaw: unknown): AgentEvent[] {
  const events: AgentEvent[] = [];
  for (const call of parseToolCallsList(toolCallsRaw)) {
    if (!call || typeof call !== 'object') continue;
    const c = call as Record<string, unknown>;
    const toolId = str(c['id']);
    const fn = c['function'];
    if (!toolId || !fn || typeof fn !== 'object') continue;
    const toolName = str((fn as Record<string, unknown>)['name']);
    if (!toolName) continue;
    events.push({
      kind: 'toolStart',
      toolId,
      toolName,
      input: parseArguments((fn as Record<string, unknown>)['arguments']),
    });
  }
  return events;
}

function eventsForMessageRow(row: SqliteRow): AgentEvent[] {
  const role = str(row['role']);
  if (role === 'user') return [{ kind: 'working' }];
  if (role === 'tool') {
    const toolId = str(row['tool_call_id']);
    return toolId ? [{ kind: 'toolEnd', toolId }] : [];
  }
  if (role === 'assistant') {
    const calls = toolStartEvents(row['tool_calls']);
    return calls.length > 0 ? calls : [{ kind: 'turnEnd' }];
  }
  return [];
}

function stateFromLastMessage(row: SqliteRow | undefined): SessionState {
  if (!row) return 'idle';
  const finishReason = (str(row['finish_reason']) ?? '').toLowerCase();
  if (HERMES_ERROR_FINISH_REASONS[finishReason]) return 'idle';
  const role = str(row['role']);
  const midTurn =
    role === 'user' ||
    role === 'tool' ||
    (role === 'assistant' && parseToolCallsList(row['tool_calls']).length > 0);
  return midTurn ? 'working' : 'idle';
}

export const hermesSqliteFormat: SqliteFormat = {
  listSessions(db) {
    const rows = db
      .prepare(
        `SELECT s.id AS id, s.hidden AS hidden, s.started_at AS started_at, s.last_activity_at AS last_activity_at,
                s.ended_at AS ended_at, COALESCE(MAX(m.id), 0) AS size, COALESCE(MAX(m.timestamp), 0) AS last_msg_ts
         FROM sessions s LEFT JOIN messages m ON m.session_id = s.id
         GROUP BY s.id`,
      )
      .all() as SqliteRow[];
    return rows
      .filter((row) => num(row['hidden']) !== 1)
      .map((row) => ({
        key: String(row['id']),
        mtimeMs:
          Math.max(
            num(row['ended_at']),
            num(row['last_activity_at']),
            num(row['started_at']),
            num(row['last_msg_ts']),
          ) * 1000,
        size: num(row['size']),
      }));
  },

  cwd(db, key) {
    const row = db.prepare('SELECT cwd FROM sessions WHERE id = ?').get(key) as
      SqliteRow | undefined;
    return str(row?.['cwd']) ?? '';
  },

  watermark(db, key) {
    const row = db
      .prepare('SELECT COALESCE(MAX(id), 0) AS w FROM messages WHERE session_id = ?')
      .get(key) as SqliteRow | undefined;
    return num(row?.['w']);
  },

  state(db, key) {
    const session = db.prepare('SELECT ended_at FROM sessions WHERE id = ?').get(key) as
      SqliteRow | undefined;
    if (session && session['ended_at'] !== null) return 'exited';
    const last = db
      .prepare(
        'SELECT role, tool_calls, finish_reason FROM messages WHERE session_id = ? AND active = 1 ORDER BY id DESC LIMIT 1',
      )
      .get(key) as SqliteRow | undefined;
    return stateFromLastMessage(last);
  },

  readSince(db, key, watermark) {
    const rows = db
      .prepare(
        'SELECT id, role, tool_call_id, tool_calls FROM messages WHERE session_id = ? AND id > ? AND active = 1 ORDER BY id',
      )
      .all(key, watermark) as SqliteRow[];
    const events: AgentEvent[] = [];
    let newWatermark = watermark;
    for (const row of rows) {
      newWatermark = num(row['id']);
      events.push(...eventsForMessageRow(row));
    }
    const session = db
      .prepare('SELECT ended_at, end_reason FROM sessions WHERE id = ?')
      .get(key) as SqliteRow | undefined;
    if (session && session['ended_at'] !== null) {
      events.push({ kind: 'sessionEnd', reason: str(session['end_reason']) ?? 'exit' });
    }
    return { events, watermark: newWatermark };
  },
};
