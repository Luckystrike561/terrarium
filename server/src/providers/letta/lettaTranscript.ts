/**
 * Letta Code's local-backend transcripts: one JSON record per line in `messages.jsonl`. The records that
 * move a character:
 *
 *   { type: 'session', cwd }                                                      session header, first line
 *   { type: 'message', message: { role: 'user' } }                                a prompt: the turn starts
 *   { type: 'message', message: { role: 'assistant', stopReason, content } }      'toolUse' continues the turn,
 *                                                                                  any other reason ends it; `content`
 *                                                                                  carries inline `toolCall` parts
 *   { type: 'message', message: { role: 'toolResult', toolCallId } }              a tool call's result
 *   { type: 'compaction', message: { role: 'assistant', ... } }                   wraps an assistant message the
 *                                                                                  same way a `message` record does
 *
 * There is no clean-exit record: liveness comes from the active-window heuristic in SessionStoreTracker.
 */

import type { AgentEvent } from '../../../../core/src/provider.js';
import type { JsonlFormat, JsonRecord } from '../sessionStore/jsonlSessionStore.js';
import { obj, str } from '../sessionStore/jsonlSessionStore.js';
import { LETTA_STOP_REASON_TOOL_USE } from './constants.js';

function toolStartsFor(message: JsonRecord): AgentEvent[] {
  const content = message['content'];
  if (!Array.isArray(content)) return [];
  const events: AgentEvent[] = [];
  for (const part of content) {
    if (!part || typeof part !== 'object' || Array.isArray(part)) continue;
    const p = part as JsonRecord;
    if (p['type'] !== 'toolCall') continue;
    const toolId = str(p['id']);
    const toolName = str(p['name']);
    if (!toolId || !toolName) continue;
    events.push({ kind: 'toolStart', toolId, toolName, input: obj(p['arguments']) });
  }
  return events;
}

function eventsForMessage(message: JsonRecord): AgentEvent[] {
  const role = message['role'];
  if (role === 'user') return [{ kind: 'working' }];
  if (role === 'assistant') {
    const events = toolStartsFor(message);
    const stopReason = str(message['stopReason']);
    if (stopReason && stopReason !== LETTA_STOP_REASON_TOOL_USE) events.push({ kind: 'turnEnd' });
    return events;
  }
  if (role === 'toolResult') {
    const toolId = str(message['toolCallId']);
    return toolId ? [{ kind: 'toolEnd', toolId }] : [];
  }
  return [];
}

export const lettaTranscriptFormat: JsonlFormat = {
  events(record) {
    const type = record['type'];
    if (type !== 'message' && type !== 'compaction') return [];
    return eventsForMessage(obj(record['message']));
  },
  cwd: (record) => (record['type'] === 'session' ? str(record['cwd']) : undefined),
};
