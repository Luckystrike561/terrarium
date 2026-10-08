/**
 * Gemini CLI transcripts: one JSON record per line, append-only. The records that move a character:
 *
 *   { id, type: 'user', content }            a prompt, or a tool result fed back to the model after a tool call
 *                                             completes (both are plain 'user' message records): the turn is busy.
 *   { id, type: 'gemini', content, toolCalls? }
 *                                             an assistant turn. Written once when the model finishes streaming,
 *                                             with no `toolCalls` yet even when it requested some; written again
 *                                             with the SAME id once the scheduler finishes running them, now
 *                                             carrying `toolCalls` with their results already attached. Gemini only
 *                                             ever records a tool call after it has completed (`recordToolCalls` is
 *                                             reached solely from `recordCompletedToolCalls`), so there is no
 *                                             on-disk moment that is "tool running, result pending": toolStart and
 *                                             toolEnd fire together, from the record that reports the result.
 *   { id, type: 'info' | 'error' | 'warning' }
 *                                             synthetic/system messages (e.g. binary-content notices), not agent
 *                                             activity.
 *   { sessionId, projectHash, ... } (no `id`) the session's metadata header, rewritten via `{ $set: ... }`.
 *   { $patch: { ... } } / { $rewindTo: <id> } history-editing deltas (context-management sync, `/rewind`): they
 *                                             touch earlier messages, never report new activity, and (like the
 *                                             header) carry no `id`+`type` pair, so they fall through untouched.
 *
 * None of these records carries the session's cwd. It is read from the project-root marker file instead.
 */

import type { AgentEvent } from '../../../../core/src/provider.js';
import type { JsonlFormat, JsonRecord } from '../sessionStore/jsonlSessionStore.js';
import { obj, str } from '../sessionStore/jsonlSessionStore.js';

function toolEventsFor(toolCalls: unknown): AgentEvent[] {
  if (!Array.isArray(toolCalls)) return [];
  const events: AgentEvent[] = [];
  for (const raw of toolCalls) {
    const call = obj(raw);
    const toolId = str(call['id']);
    const toolName = str(call['name']);
    if (!toolId || !toolName) continue;
    events.push({ kind: 'toolStart', toolId, toolName, input: call['args'] });
    events.push({ kind: 'toolEnd', toolId });
  }
  return events;
}

export const geminiTranscriptFormat: JsonlFormat = {
  events(record: JsonRecord): AgentEvent[] {
    if (typeof record['id'] !== 'string' || typeof record['type'] !== 'string') return [];
    if (record['type'] === 'user') return [{ kind: 'working' }];
    if (record['type'] !== 'gemini') return []; // info/error/warning: not agent activity
    const toolEvents = toolEventsFor(record['toolCalls']);
    // A 'gemini' record with no tool calls is either the final answer (turn over) or the instant
    // before its tool calls land on this same message id (turn continues): the record alone cannot
    // tell those apart. Reading it as idle is right most of the time, and wrong only for the moment
    // until the matching toolStart/toolEnd follows and restores the character to working.
    return toolEvents.length > 0 ? toolEvents : [{ kind: 'turnEnd' }];
  },
  cwd: () => undefined,
};
