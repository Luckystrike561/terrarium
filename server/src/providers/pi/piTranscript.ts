/**
 * pi transcripts: one JSON record per line, a tree via `id`/`parentId`. The records that move a character:
 *
 *   { type: 'session', cwd }                                            the session header, line 1
 *   { type: 'message', message: { role: 'user' } }                      a prompt: the turn starts
 *   { type: 'message', message: { role: 'assistant', content, stopReason } }
 *       `content` carries tool calls inline: { type: 'toolCall', id, name, arguments }. `stopReason: 'toolUse'`
 *       continues the turn (one toolStart per call block in content); any other reason ends it.
 *   { type: 'message', message: { role: 'toolResult', toolCallId } }    the matching tool call finished
 *
 * Unlike omp (a fork of pi), there is no `tool_execution_start`/`session_exit` custom record: a tool call starts
 * when the assistant message that requested it is persisted (not when execution begins), and pi writes nothing on
 * a clean exit, which the agent module handles by relying on the shared store's active-window timeout instead.
 * `custom_message` entries are a distinct record `type` (not `message`), so extension-injected context never
 * reads as a prompt here, and `role: 'system'` prompt checkpoints fall through with no event, same as any other
 * unrecognized role.
 */

import type { AgentEvent } from '../../../../core/src/provider.js';
import type { JsonlFormat, JsonRecord } from '../sessionStore/jsonlSessionStore.js';
import { obj, str } from '../sessionStore/jsonlSessionStore.js';
import { PI_STOP_REASON_TOOL_USE } from './constants.js';

function toolStartEvents(content: unknown): AgentEvent[] {
  if (!Array.isArray(content)) return [];
  const events: AgentEvent[] = [];
  for (const block of content as unknown[]) {
    const b: JsonRecord = obj(block);
    if (b['type'] !== 'toolCall') continue;
    const toolId = str(b['id']);
    const toolName = str(b['name']);
    if (!toolId || !toolName) continue;
    events.push({ kind: 'toolStart', toolId, toolName, input: b['arguments'] });
  }
  return events;
}

export const piTranscriptFormat: JsonlFormat = {
  events(record) {
    if (record['type'] !== 'message') return [];
    const message = obj(record['message']);
    switch (message['role']) {
      case 'user':
        return [{ kind: 'working' }];
      case 'assistant': {
        const events = toolStartEvents(message['content']);
        const stopReason = str(message['stopReason']);
        if (stopReason && stopReason !== PI_STOP_REASON_TOOL_USE) events.push({ kind: 'turnEnd' });
        return events;
      }
      case 'toolResult': {
        const toolId = str(message['toolCallId']);
        return toolId ? [{ kind: 'toolEnd', toolId }] : [];
      }
      default:
        return []; // 'system' prompt checkpoints and anything else move nothing on screen
    }
  },
  cwd: (record) => (record['type'] === 'session' ? str(record['cwd']) : undefined),
};
