/**
 * Maki transcripts: one JSON record per line, tagged by `t`. The records that move a character:
 *
 *   { t: 'header', cwd }                                                the session header, first line
 *   { t: 'msg', d: { role: 'user', content: [{ type: 'text' }] } }             a prompt: the turn starts
 *   { t: 'msg', d: { role: 'user', content: [{ type: 'tool_result', tool_use_id }] } }  a tool finishes
 *   { t: 'msg', d: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } }  a tool call
 *   { t: 'msg', d: { role: 'assistant', content: [{ type: 'text' }] } }        a reply with no tool call in the
 *     same message ends the turn (Maki writes no stop-reason field)
 *
 * A `d` carrying `kind` (`observation` or `{ context_update: ... }`) is host-injected, not a real turn, and is
 * skipped; `kind` is omitted from a real turn message. `out` (rich tool output), `sub_msg` (sub-agent chat) and
 * `frame` records carry nothing a plain toolEnd/toolStart doesn't already say.
 *
 * Maki records no approval-wait state and no exit record: permissionRequest is not supportable from the
 * transcript, and sessionEnd for an abandoned session falls out of the shared store's active-window timeout
 * instead of an in-band record.
 */

import type { AgentEvent } from '../../../../core/src/provider.js';
import type { JsonlFormat, JsonRecord } from '../sessionStore/jsonlSessionStore.js';
import { obj, str } from '../sessionStore/jsonlSessionStore.js';

function blocksOf(message: JsonRecord): JsonRecord[] {
  const content = message['content'];
  return Array.isArray(content)
    ? content.filter((block): block is JsonRecord => !!obj(block)['type'])
    : [];
}

function userEvents(blocks: JsonRecord[]): AgentEvent[] {
  const events: AgentEvent[] = [];
  let prompted = false;
  for (const block of blocks) {
    if (block['type'] === 'text' && str(block['text'])) prompted = true;
    else if (block['type'] === 'tool_result') {
      const toolId = str(block['tool_use_id']);
      if (toolId) events.push({ kind: 'toolEnd', toolId });
    }
  }
  if (prompted) events.unshift({ kind: 'working' });
  return events;
}

function assistantEvents(blocks: JsonRecord[]): AgentEvent[] {
  const events: AgentEvent[] = [];
  let calledTool = false;
  let replied = false;
  for (const block of blocks) {
    if (block['type'] === 'tool_use') {
      calledTool = true;
      const toolId = str(block['id']);
      const toolName = str(block['name']);
      if (toolId && toolName)
        events.push({ kind: 'toolStart', toolId, toolName, input: obj(block['input']) });
    } else if (block['type'] === 'text' && str(block['text'])) {
      replied = true;
    }
  }
  // No stop-reason field: a reply with no tool call in the same message is the turn ending.
  if (!calledTool && replied) events.push({ kind: 'turnEnd' });
  return events;
}

export const makiTranscriptFormat: JsonlFormat = {
  events(record) {
    if (record['t'] !== 'msg') return [];
    const message = obj(record['d']);
    if ('kind' in message) return []; // host-injected observation/context_update, not a real turn
    const blocks = blocksOf(message);
    if (message['role'] === 'user') return userEvents(blocks);
    if (message['role'] === 'assistant') return assistantEvents(blocks);
    return [];
  },
  cwd: (record) => (record['t'] === 'header' ? str(record['cwd']) : undefined),
};
