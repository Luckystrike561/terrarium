/**
 * Copilot CLI transcripts: one JSON record per line, `{ type, data, id, timestamp, parentId }`. GitHub's own
 * Copilot SDK streaming-events reference names the same event types and marks which are ephemeral (streamed but
 * never written to disk); the records below are the persisted ones, the only ones a tail of `events.jsonl` can
 * ever see:
 *
 *   { type: 'session.start', data: { context: { cwd } } }              the session header
 *   { type: 'session.context_changed', data: { cwd } }                 cwd changed mid-session
 *   { type: 'user.message' }                                           a prompt: the turn starts
 *   { type: 'assistant.turn_end' }                                     the turn ends
 *   { type: 'tool.execution_start', data: { toolCallId, toolName, arguments } }
 *   { type: 'tool.execution_complete', data: { toolCallId } }
 *   { type: 'permission.requested' }                                   a persisted approval wait
 *   { type: 'session.shutdown' }                                       the session's true end signal
 *
 * `tool.execution_start` with `toolName: 'ask_user'` is Copilot's built-in tool for asking the user a question:
 * the question text itself only reaches the ephemeral, unpersisted `user_input.requested` event, so the tool call
 * is read as a permission wait instead of ordinary tool activity.
 */

import type { AgentEvent } from '../../../../core/src/provider.js';
import type { JsonlFormat, JsonRecord } from '../sessionStore/jsonlSessionStore.js';
import { obj, str } from '../sessionStore/jsonlSessionStore.js';
import { COPILOT_ASK_USER_TOOL } from './constants.js';

function toolStartFor(data: JsonRecord): AgentEvent[] {
  const toolId = str(data['toolCallId']);
  const toolName = str(data['toolName']);
  if (!toolId || !toolName) return [];
  if (toolName === COPILOT_ASK_USER_TOOL) return [{ kind: 'permissionRequest' }];
  return [{ kind: 'toolStart', toolId, toolName, input: obj(data['arguments']) }];
}

export const copilotTranscriptFormat: JsonlFormat = {
  events(record) {
    const data = obj(record['data']);
    switch (record['type']) {
      case 'user.message':
        return [{ kind: 'working' }];
      case 'assistant.turn_end':
        return [{ kind: 'turnEnd' }];
      case 'tool.execution_start':
        return toolStartFor(data);
      case 'tool.execution_complete': {
        const toolId = str(data['toolCallId']);
        return toolId ? [{ kind: 'toolEnd', toolId }] : [];
      }
      case 'permission.requested':
        return [{ kind: 'permissionRequest' }];
      case 'session.shutdown':
        return [{ kind: 'sessionEnd', reason: 'exit' }];
      default:
        return [];
    }
  },
  cwd(record) {
    if (record['type'] === 'session.start') return str(obj(obj(record['data'])['context'])['cwd']);
    if (record['type'] === 'session.context_changed') return str(obj(record['data'])['cwd']);
    return undefined;
  },
};
