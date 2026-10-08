/**
 * mastracode's session database. One session = one `mastra_threads` row (id = the thread id, exactly what
 * herdr's `agent_session.value` reports); its turns are the `mastra_messages` rows for that thread, written only
 * once a turn completes or suspends (AgentController always runs with `savePerStep: false`), so a whole turn's
 * events land on the same poll instead of trickling in. cwd comes from the thread's `metadata.projectPath`, set
 * once by `harness.createThread`; older threads created before that change carry no path. `metadata` is stored
 * via SQLite's `jsonb()`, so it is read back through `json_extract()`; `content` is a plain JSON text column.
 */

import type { DatabaseSync } from 'node:sqlite';

import type { AgentEvent } from '../../../../core/src/provider.js';
import type { ListedSession, SessionState } from '../sessionStore/sessionStoreTracker.js';
import type { SqliteFormat } from '../sessionStore/sqliteSessionStore.js';
import {
  MASTRACODE_PROJECT_PATH_KEY,
  MASTRACODE_TOOL_APPROVAL_STATE,
  MASTRACODE_TOOL_TERMINAL_STATES,
  TABLE_MESSAGES,
  TABLE_THREADS,
} from './constants.js';

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

interface ToolInvocation {
  toolCallId?: unknown;
  toolName?: unknown;
  args?: unknown;
  rawInput?: unknown;
  state?: unknown;
}

interface MessagePart {
  type?: unknown;
  toolInvocation?: ToolInvocation;
}

/** The message's parts, from its `content` JSON text column (MastraMessageContentV2.parts). */
function messageParts(content: unknown): MessagePart[] {
  if (typeof content !== 'string') return [];
  try {
    const parsed = JSON.parse(content) as { parts?: unknown };
    return Array.isArray(parsed.parts) ? (parsed.parts as MessagePart[]) : [];
  } catch {
    return [];
  }
}

type ToolOutcome = 'done' | 'pending' | 'approval' | null;

/** Where one tool-invocation part stands. `null` for anything that isn't one. */
function toolOutcome(part: MessagePart): ToolOutcome {
  if (!part || part.type !== 'tool-invocation') return null;
  const state = str(part.toolInvocation?.state);
  if (!state) return 'pending';
  if (MASTRACODE_TOOL_TERMINAL_STATES[state]) return 'done';
  if (state === MASTRACODE_TOOL_APPROVAL_STATE) return 'approval';
  return 'pending';
}

function eventsForAssistant(content: unknown): AgentEvent[] {
  const events: AgentEvent[] = [];
  let pending = false;
  for (const part of messageParts(content)) {
    const outcome = toolOutcome(part);
    if (outcome === null) continue;
    const ti = part.toolInvocation;
    const toolId = str(ti?.toolCallId);
    const toolName = str(ti?.toolName);
    if (!toolId || !toolName) continue;
    events.push({ kind: 'toolStart', toolId, toolName, input: ti?.args ?? ti?.rawInput ?? {} });
    if (outcome === 'done') {
      events.push({ kind: 'toolEnd', toolId });
    } else if (outcome === 'approval') {
      events.push({ kind: 'permissionRequest' });
      pending = true;
    } else {
      pending = true;
    }
  }
  if (!pending) events.push({ kind: 'turnEnd' });
  return events;
}

/** A user row starts the turn; an assistant row reports everything that happened in it, since the whole run only
 *  flushes once it completes or suspends. Any other role is unrecorded (none are documented). */
function eventsForRow(role: unknown, content: unknown): AgentEvent[] {
  if (role === 'user') return [{ kind: 'working' }];
  if (role !== 'assistant') return [];
  return eventsForAssistant(content);
}

interface ThreadRow {
  id: string;
  updatedAt: string;
  size: number;
}

interface MessageRow {
  role: string;
  content: string;
}

export const mastracodeSqliteFormat: SqliteFormat = {
  listSessions(db: DatabaseSync): ListedSession[] {
    const rows = db
      .prepare(
        `SELECT t.id AS id, t."updatedAt" AS updatedAt, COUNT(m.id) AS size
         FROM "${TABLE_THREADS}" t LEFT JOIN "${TABLE_MESSAGES}" m ON m.thread_id = t.id
         GROUP BY t.id`,
      )
      .all() as unknown as ThreadRow[];
    return rows.map((row) => ({
      key: row.id,
      mtimeMs: Date.parse(row.updatedAt) || 0,
      size: Number(row.size) || 0,
    }));
  },

  cwd(db: DatabaseSync, key: string): string {
    const row = db
      .prepare(
        `SELECT json_extract(metadata, '$.${MASTRACODE_PROJECT_PATH_KEY}') AS cwd FROM "${TABLE_THREADS}" WHERE id = ?`,
      )
      .get(key) as { cwd: string | null } | undefined;
    return str(row?.cwd) ?? '';
  },

  watermark(db: DatabaseSync, key: string): number {
    const row = db
      .prepare(`SELECT COUNT(*) AS n FROM "${TABLE_MESSAGES}" WHERE thread_id = ?`)
      .get(key) as { n: number } | undefined;
    return Number(row?.n) || 0;
  },

  state(db: DatabaseSync, key: string): SessionState {
    const row = db
      .prepare(
        `SELECT role, content FROM "${TABLE_MESSAGES}" WHERE thread_id = ? ORDER BY "createdAt" DESC, id DESC LIMIT 1`,
      )
      .get(key) as MessageRow | undefined;
    if (!row) return 'idle';
    if (row.role === 'user') return 'working';
    if (row.role !== 'assistant') return 'idle';
    return messageParts(row.content).some((part) => {
      const outcome = toolOutcome(part);
      return outcome === 'pending' || outcome === 'approval';
    })
      ? 'working'
      : 'idle';
  },

  readSince(
    db: DatabaseSync,
    key: string,
    watermark: number,
  ): { events: AgentEvent[]; watermark: number } {
    const rows = db
      .prepare(
        `SELECT role, content FROM "${TABLE_MESSAGES}" WHERE thread_id = ? ORDER BY "createdAt" ASC, id ASC LIMIT -1 OFFSET ?`,
      )
      .all(key, watermark) as unknown as MessageRow[];
    const events = rows.flatMap((row) => eventsForRow(row.role, row.content));
    return { events, watermark: watermark + rows.length };
  },
};
