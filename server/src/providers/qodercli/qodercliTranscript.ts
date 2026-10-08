/**
 * Qoder CLI transcripts: append-only JSONL, Claude-Code-shaped. Every record carries `cwd` at the top level. The
 * records that move a character:
 *
 *   { type: 'user', message: { role: 'user', content: '<prompt>' } }                     a prompt: the turn starts
 *   { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id }] } }        a tool finished
 *   { type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } }  a tool call starts
 *   { type: 'assistant', message: { stop_reason: 'end_turn' } }                           the turn is fully answered
 *
 * Approval waits and clean session exit are never recorded here: Qoder reports both only through its hook API,
 * which this transcript-only module does not install.
 */

import type { AgentEvent } from '../../../../core/src/provider.js';
import type { JsonlFormat, JsonRecord } from '../sessionStore/jsonlSessionStore.js';
import { obj, str } from '../sessionStore/jsonlSessionStore.js';
import { QODER_STOP_REASON_END_TURN } from './constants.js';

function blocksOf(content: unknown): JsonRecord[] {
  return Array.isArray(content)
    ? content.filter((b): b is JsonRecord => !!b && typeof b === 'object')
    : [];
}

function userEvents(message: JsonRecord): AgentEvent[] {
  const content = message['content'];
  if (typeof content === 'string') return [{ kind: 'working' }];

  const events: AgentEvent[] = [];
  for (const block of blocksOf(content)) {
    if (block['type'] !== 'tool_result') continue;
    const toolId = str(block['tool_use_id']);
    if (toolId) events.push({ kind: 'toolEnd', toolId });
  }
  // The model gets another turn once its tools report back.
  if (events.length > 0) events.push({ kind: 'working' });
  return events;
}

function assistantEvents(message: JsonRecord): AgentEvent[] {
  const events: AgentEvent[] = [];
  for (const block of blocksOf(message['content'])) {
    if (block['type'] !== 'tool_use') continue;
    const toolId = str(block['id']);
    const toolName = str(block['name']);
    if (toolId && toolName)
      events.push({ kind: 'toolStart', toolId, toolName, input: block['input'] });
  }
  if (str(message['stop_reason']) === QODER_STOP_REASON_END_TURN) events.push({ kind: 'turnEnd' });
  return events;
}

export const qodercliTranscriptFormat: JsonlFormat = {
  events(record) {
    const message = obj(record['message']);
    if (record['type'] === 'user') return userEvents(message);
    if (record['type'] === 'assistant') return assistantEvents(message);
    return [];
  },
  cwd: (record) => str(record['cwd']),
};
