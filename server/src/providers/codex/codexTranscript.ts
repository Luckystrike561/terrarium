/**
 * Codex rollout transcripts: one JSON record per line, each an envelope `{ timestamp, ordinal?, type, payload }`,
 * internally tagged by `type`. The records that move a character:
 *
 *   { type: 'session_meta', payload: { cwd } }                                        the session header, first line
 *   { type: 'event_msg', payload: { type: 'task_started' } }                          a turn starts
 *   { type: 'event_msg', payload: { type: 'task_complete' } }                         a turn ends
 *   { type: 'response_item', payload: { type: 'message', role: 'user' } }             a prompt
 *   { type: 'response_item', payload: { type: 'function_call', call_id, name, arguments } }       a tool call
 *   { type: 'response_item', payload: { type: 'custom_tool_call', call_id, name, input } }         a freeform tool
 *                                                                                                   call (apply_patch)
 *   { type: 'response_item', payload: { type: 'function_call_output', call_id } }                  a tool result
 *   { type: 'response_item', payload: { type: 'custom_tool_call_output', call_id } }                a freeform result
 *
 * task_started/task_complete are never filtered by Codex's persistence policy regardless of history mode, unlike
 * the legacy user_message/agent_message event_msgs they sit beside; response_items are always persisted too.
 * Approval requests (exec/patch) and a clean session exit are never persisted at all, so this module never emits
 * `permissionRequest` or `sessionEnd` from the transcript.
 */

import type { AgentEvent } from '../../../../core/src/provider.js';
import type { JsonlFormat, JsonRecord } from '../sessionStore/jsonlSessionStore.js';
import { obj, str } from '../sessionStore/jsonlSessionStore.js';
import {
  CODEX_EVENT_TASK_COMPLETE,
  CODEX_EVENT_TASK_STARTED,
  CODEX_ITEM_CUSTOM_TOOL_CALL,
  CODEX_ITEM_CUSTOM_TOOL_CALL_OUTPUT,
  CODEX_ITEM_FUNCTION_CALL,
  CODEX_ITEM_FUNCTION_CALL_OUTPUT,
  CODEX_ITEM_MESSAGE,
} from './constants.js';

function toolStartFromFunctionCall(payload: JsonRecord): AgentEvent[] {
  const toolId = str(payload['call_id']);
  const toolName = str(payload['name']);
  if (!toolId || !toolName) return [];
  const argumentsText = str(payload['arguments']);
  let input: unknown = {};
  if (argumentsText) {
    try {
      input = JSON.parse(argumentsText);
    } catch {
      input = {}; // the model's arguments didn't parse as JSON: show the tool with no detail rather than crash
    }
  }
  return [{ kind: 'toolStart', toolId, toolName, input }];
}

function toolStartFromCustomToolCall(payload: JsonRecord): AgentEvent[] {
  const toolId = str(payload['call_id']);
  const toolName = str(payload['name']);
  if (!toolId || !toolName) return [];
  // Freeform tools (apply_patch) carry raw text, not JSON: wrap it so formatToolStatus reads it the same way.
  return [{ kind: 'toolStart', toolId, toolName, input: { input: str(payload['input']) ?? '' } }];
}

function toolEndFor(payload: JsonRecord): AgentEvent[] {
  const toolId = str(payload['call_id']);
  return toolId ? [{ kind: 'toolEnd', toolId }] : [];
}

export const codexTranscriptFormat: JsonlFormat = {
  events(record) {
    const type = str(record['type']);
    if (type === 'event_msg') {
      const eventType = str(obj(record['payload'])['type']);
      if (eventType === CODEX_EVENT_TASK_STARTED) return [{ kind: 'working' }];
      if (eventType === CODEX_EVENT_TASK_COMPLETE) return [{ kind: 'turnEnd' }];
      return [];
    }
    if (type !== 'response_item') return [];
    const payload = obj(record['payload']);
    switch (str(payload['type'])) {
      case CODEX_ITEM_MESSAGE:
        return payload['role'] === 'user' ? [{ kind: 'working' }] : [];
      case CODEX_ITEM_FUNCTION_CALL:
        return toolStartFromFunctionCall(payload);
      case CODEX_ITEM_CUSTOM_TOOL_CALL:
        return toolStartFromCustomToolCall(payload);
      case CODEX_ITEM_FUNCTION_CALL_OUTPUT:
      case CODEX_ITEM_CUSTOM_TOOL_CALL_OUTPUT:
        return toolEndFor(payload);
      default:
        return [];
    }
  },
  cwd: (record) =>
    str(record['type']) === 'session_meta' ? str(obj(record['payload'])['cwd']) : undefined,
};
