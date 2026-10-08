/**
 * Cursor Agent CLI transcripts: one JSON record per line, no session header. The records that move a character:
 *
 *   { role: 'user', message: { content: [...] } }                     a prompt: the turn starts
 *   { role: 'assistant', message: { content: [{ type: 'tool_use', name, input }, ...] } }   a tool call
 *   { type: 'turn_ended', status }                                    the turn ends (optional: Cursor >= 3.13 only)
 *
 * Cursor records no tool call id (every `tool_use.id` is `null`) and no tool result, so `toolEnd` cannot be
 * derived: a synthetic, process-wide unique id is minted per `tool_use` block and the runtime clears it on the
 * next `turnEnd`/`working` rather than on a matching `toolEnd`. Cursor also records no cwd anywhere in the
 * transcript: `cwd` always reports undefined.
 */

import type { AgentEvent } from '../../../../core/src/provider.js';
import type { JsonlFormat, JsonRecord } from '../sessionStore/jsonlSessionStore.js';
import { obj, str } from '../sessionStore/jsonlSessionStore.js';

let nextSyntheticToolId = 0;

function syntheticToolId(): string {
  nextSyntheticToolId += 1;
  return `cursor-tool-${nextSyntheticToolId}`;
}

function toolStartsFor(content: unknown[]): AgentEvent[] {
  const events: AgentEvent[] = [];
  for (const block of content) {
    const b = obj(block);
    if (b['type'] !== 'tool_use') continue;
    const toolName = str(b['name']);
    if (!toolName) continue;
    events.push({ kind: 'toolStart', toolId: syntheticToolId(), toolName, input: b['input'] });
  }
  return events;
}

export const cursorTranscriptFormat: JsonlFormat = {
  events(record: JsonRecord) {
    if (record['type'] === 'turn_ended') return [{ kind: 'turnEnd' }];
    if (record['type']) return []; // 'progress' and any other non-message record: skip, never guess
    if (record['role'] === 'user') return [{ kind: 'working' }];
    if (record['role'] === 'assistant') {
      const content = obj(record['message'])['content'];
      return Array.isArray(content) ? toolStartsFor(content) : [];
    }
    return [];
  },
  cwd: () => undefined,
};
