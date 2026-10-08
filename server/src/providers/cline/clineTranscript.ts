/**
 * Cline's `<sessionId>.messages.json`: a whole-file JSON document, rewritten on every change. Anthropic-native
 * content blocks, no `tool` role. The records that move a character:
 *
 *   { role: 'user', content: [{ type: 'text', ... }] }                          a prompt: the turn starts
 *   { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] }     a tool call starts
 *   { role: 'user', content: [{ type: 'tool_result', tool_use_id, ... }] }      a tool call's result
 *   { role: 'assistant', metrics: {...}, content: [...] }                      the turn's terminal message: only the
 *                                                                               last assistant message of a turn
 *                                                                               carries `metrics`
 *
 * The document carries no cwd (that lives in the sibling manifest, read separately via `cwdOf`), so `cwd` here
 * always reports unknown.
 */

import type { AgentEvent } from '../../../../core/src/provider.js';
import type { JsonDocumentFormat } from '../sessionStore/jsonDocumentSessionStore.js';
import type { JsonRecord } from '../sessionStore/jsonlSessionStore.js';
import { obj, str } from '../sessionStore/jsonlSessionStore.js';

function userEvents(blocks: JsonRecord[]): AgentEvent[] {
  const toolResults = blocks.filter((b) => b['type'] === 'tool_result');
  if (toolResults.length > 0) {
    return toolResults.flatMap((block) => {
      const toolId = str(block['tool_use_id']);
      return toolId ? [{ kind: 'toolEnd' as const, toolId }] : [];
    });
  }
  // No tool_result block: a fresh prompt landed, starting a new turn.
  return blocks.length > 0 ? [{ kind: 'working' }] : [];
}

function assistantEvents(record: JsonRecord, blocks: JsonRecord[]): AgentEvent[] {
  const events: AgentEvent[] = [];
  for (const block of blocks) {
    if (block['type'] !== 'tool_use') continue;
    const toolId = str(block['id']);
    const toolName = str(block['name']);
    if (toolId && toolName)
      events.push({ kind: 'toolStart', toolId, toolName, input: block['input'] });
  }
  // The turn's terminal message carries `metrics`; no other record says a turn is over.
  if (record['metrics'] !== undefined) events.push({ kind: 'turnEnd' });
  return events;
}

export const clineTranscriptFormat: JsonDocumentFormat = {
  records(document) {
    const messages = obj(document)['messages'];
    return Array.isArray(messages) ? messages.filter((m): m is JsonRecord => obj(m) === m) : [];
  },
  events(record) {
    const blocks = Array.isArray(record['content'])
      ? record['content'].filter((b): b is JsonRecord => obj(b) === b)
      : [];
    if (record['role'] === 'user') return userEvents(blocks);
    if (record['role'] === 'assistant') return assistantEvents(record, blocks);
    return [];
  },
  cwd: () => undefined,
};
