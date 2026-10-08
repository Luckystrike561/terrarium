/**
 * Droid transcripts: one JSON record per line, content blocks nested inside `message.content`. The records that
 * move a character:
 *
 *   { type: 'session_start', id, cwd }                                        the session header, first line
 *   { type: 'message', message: { role: 'user', content: [{ type: 'text' }] } }       a prompt: the turn starts
 *   { type: 'message', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id }] } }  a tool finishes
 *   { type: 'message', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } }  a tool call
 *   { type: 'message', message: { role: 'assistant', content: [{ type: 'text' }] } }     a text reply with no tool
 *     call in the same message ends the turn (Droid writes no explicit `stopReason`)
 *   { type: 'agent_turn_outcome' } / { type: 'session_end' }                  newer builds' explicit turn/session end
 *
 * A `message` carrying `visibility` is host-injected context, not something the user or model said, and is skipped.
 * `thinking` and `image` blocks inside `content`, and `todo_state`/`compaction_state` records, carry nothing to show.
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
  // No explicit stopReason: a reply with no tool call in the same message is the turn ending.
  if (!calledTool && replied) events.push({ kind: 'turnEnd' });
  return events;
}

export const droidTranscriptFormat: JsonlFormat = {
  events(record) {
    if (record['type'] === 'message') {
      const message = obj(record['message']);
      if (message['visibility'] !== undefined) return [];
      const blocks = blocksOf(message);
      if (message['role'] === 'user') return userEvents(blocks);
      if (message['role'] === 'assistant') return assistantEvents(blocks);
      return [];
    }
    if (record['type'] === 'agent_turn_outcome') return [{ kind: 'turnEnd' }];
    if (record['type'] === 'session_end') return [{ kind: 'sessionEnd', reason: 'exit' }];
    return [];
  },
  cwd: (record) => (record['type'] === 'session_start' ? str(record['cwd']) : undefined),
};
