/**
 * Devin CLI's session store: a single SQLite database (`cli/sessions.db`) with one row per session in `sessions`
 * and a message forest per session in `message_nodes` (`row_id` the monotonic, globally unique watermark;
 * `node_id`/`parent_node_id` the per-session tree; `sessions.main_chain_id` the active leaf). Each
 * `message_nodes.chat_message` is a JSON document:
 *
 *   { message_id, role: 'system'|'user'|'assistant'|'tool', content, tool_calls?: [{id, name, arguments}],
 *     tool_call_id?, metadata?: { is_user_input, finish_reason, ... } }
 *
 * `hidden` and `main_chain_id` postdate early schema migrations and are probed before use, so an older store still
 * reads (with no `hidden` filter, and falling back to the newest `node_id` for the active leaf).
 *
 * `system` and `tool` roles never start a turn; a `tool` row is a result, paired to its call by `tool_call_id`.
 * Devin's own lifecycle hooks (which would report permission waits and clean exits) are documented but unwired in
 * the shipped CLI, and the store itself records neither, so this format maps no `permissionRequest` and no
 * `sessionEnd`: a session that stops writing ages out of the active window instead.
 */

import type { DatabaseSync } from 'node:sqlite';

import type { AgentEvent } from '../../../../core/src/provider.js';
import { obj, str } from '../sessionStore/jsonlSessionStore.js';
import type { ListedSession, SessionState } from '../sessionStore/sessionStoreTracker.js';
import type { SqliteFormat, SqliteRow } from '../sessionStore/sqliteSessionStore.js';

function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  return (
    db.prepare('SELECT 1 FROM pragma_table_info(?) WHERE name = ?').all(table, column).length > 0
  );
}

function parseChatMessage(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

interface DevinToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: unknown;
}

function toolCallsOf(message: Record<string, unknown>): DevinToolCall[] {
  const raw = message['tool_calls'];
  if (!Array.isArray(raw)) return [];
  const calls: DevinToolCall[] = [];
  for (const entry of raw) {
    const call = obj(entry);
    const id = str(call['id']);
    const name = str(call['name']);
    if (id && name) calls.push({ id, name, arguments: call['arguments'] });
  }
  return calls;
}

/** AgentEvents a single message node records, from its role (never replays: one node in, its own events out). */
function eventsForMessage(message: Record<string, unknown>): AgentEvent[] {
  const role = str(message['role']);
  if (role === 'user') {
    // A heartbeat/injected prompt the CLI writes to keep context warm, not a real user turn.
    if (obj(message['metadata'])['is_user_input'] === false) return [];
    return [{ kind: 'working' }];
  }
  if (role === 'assistant') {
    const toolCalls = toolCallsOf(message);
    if (toolCalls.length > 0) {
      return toolCalls.map((call) => ({
        kind: 'toolStart',
        toolId: call.id,
        toolName: call.name,
        input: call.arguments,
      }));
    }
    return [{ kind: 'turnEnd' }];
  }
  if (role === 'tool') {
    const toolId = str(message['tool_call_id']);
    return toolId ? [{ kind: 'toolEnd', toolId }] : [];
  }
  return [];
}

/** The session's active leaf node: `main_chain_id` when the column exists and names a real node, else the newest
 *  `node_id` (a dangling or pre-migration leaf falls back the same way the CLI's own chain walk does). */
function tailNode(db: DatabaseSync, sessionId: string): SqliteRow | undefined {
  if (hasColumn(db, 'sessions', 'main_chain_id')) {
    const session = db.prepare('SELECT main_chain_id FROM sessions WHERE id = ?').get(sessionId);
    const leaf = session?.['main_chain_id'];
    if (typeof leaf === 'number' || typeof leaf === 'bigint') {
      const node = db
        .prepare('SELECT chat_message FROM message_nodes WHERE session_id = ? AND node_id = ?')
        .get(sessionId, leaf);
      if (node) return node;
    }
  }
  return db
    .prepare(
      'SELECT chat_message FROM message_nodes WHERE session_id = ? ORDER BY node_id DESC LIMIT 1',
    )
    .get(sessionId);
}

export const devinSqliteFormat: SqliteFormat = {
  listSessions(db): ListedSession[] {
    const visible = hasColumn(db, 'sessions', 'hidden') ? 'COALESCE(s.hidden, 0) = 0' : '1 = 1';
    const rows = db
      .prepare(
        `SELECT s.id AS id, s.last_activity_at AS lastActivityAt,
                (SELECT MAX(m.row_id) FROM message_nodes m WHERE m.session_id = s.id) AS watermark
           FROM sessions s WHERE ${visible}`,
      )
      .all() as SqliteRow[];
    const sessions: ListedSession[] = [];
    for (const row of rows) {
      const id = str(row['id']);
      const watermark = row['watermark'];
      // Devin's own store never lists a session with no body; neither do we.
      if (!id || typeof watermark !== 'number') continue;
      sessions.push({
        key: id,
        mtimeMs: Number(row['lastActivityAt'] ?? 0) * 1000,
        size: watermark,
      });
    }
    return sessions;
  },

  cwd(db, key): string {
    const row = db.prepare('SELECT working_directory FROM sessions WHERE id = ?').get(key);
    return str(row?.['working_directory']) ?? '';
  },

  watermark(db, key): number {
    const row = db
      .prepare('SELECT MAX(row_id) AS watermark FROM message_nodes WHERE session_id = ?')
      .get(key);
    const watermark = row?.['watermark'];
    return typeof watermark === 'number' ? watermark : 0;
  },

  state(db, key): SessionState {
    const node = tailNode(db, key);
    if (!node) return 'idle';
    const message = parseChatMessage(node['chat_message']);
    if (!message) return 'idle';
    const role = str(message['role']);
    if (role === 'user') return 'working';
    if (role === 'tool') return 'working'; // a result just landed; Devin hasn't produced its next turn yet
    if (role === 'assistant') return toolCallsOf(message).length > 0 ? 'working' : 'idle';
    return 'idle';
  },

  readSince(db, key, watermark) {
    const rows = db
      .prepare(
        'SELECT row_id AS rowId, chat_message FROM message_nodes WHERE session_id = ? AND row_id > ? ORDER BY row_id ASC',
      )
      .all(key, watermark) as SqliteRow[];
    const events: AgentEvent[] = [];
    let next = watermark;
    for (const row of rows) {
      const message = parseChatMessage(row['chat_message']);
      if (message) events.push(...eventsForMessage(message));
      const rowId = Number(row['rowId']);
      if (rowId > next) next = rowId;
    }
    return { events, watermark: next };
  },
};
