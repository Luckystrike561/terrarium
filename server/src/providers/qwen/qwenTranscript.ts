/**
 * Qwen Code transcripts: one JSON record per line, the file itself named `<sessionId>.jsonl`. The records that move
 * a character:
 *
 *   { type: 'user', cwd, message: { role: 'user', parts: [{ text }] } }
 *     a real prompt starts the turn; other `type: 'user'` subtypes (side-channel/system messages) do not
 *   { type: 'assistant', cwd, message: { role: 'model', parts: [{ text }|{ thought }|{ functionCall }] } }
 *     a `functionCall` part continues the turn with a tool call; text/thought-only parts end it (no `stopReason`
 *     is ever written, so the presence of a function call is the only signal)
 *   { type: 'tool_result', cwd, message: { parts: [{ functionResponse }] }, toolCallResult: { callId } }
 *     the tool's result
 *   { type: 'system', subtype: 'turn_result', systemPayload: { state } }
 *     an explicit, best-effort turn-end signal when the CLI happens to write one
 *
 * No record marks a clean session exit or a permission wait: those never reach the transcript, so they come from
 * herdr's own screen state when a multiplexer hosts the session, and from the store's active-window staleness
 * otherwise.
 */

import type { AgentEvent } from '../../../../core/src/provider.js';
import type { JsonlFormat, JsonRecord } from '../sessionStore/jsonlSessionStore.js';
import { obj, str } from '../sessionStore/jsonlSessionStore.js';
import { QWEN_NON_PROMPT_USER_SUBTYPES } from './constants.js';

function parts(record: JsonRecord): JsonRecord[] {
  const list = obj(record['message'])['parts'];
  return Array.isArray(list) ? list.map(obj) : [];
}

function isRealPrompt(record: JsonRecord): boolean {
  const subtype = str(record['subtype']);
  if (subtype && QWEN_NON_PROMPT_USER_SUBTYPES[subtype]) return false;
  return parts(record).some((part) => !!str(part['text']));
}

function assistantEvents(record: JsonRecord): AgentEvent[] {
  const calls = parts(record)
    .map((part) => obj(part['functionCall']))
    .filter((call) => str(call['name']));
  if (calls.length === 0) return [{ kind: 'turnEnd' }];
  return calls.map((call) => ({
    kind: 'toolStart',
    toolId: str(call['id']) ?? str(call['name'])!,
    toolName: str(call['name'])!,
    input: obj(call['args']),
  }));
}

function toolResultEvents(record: JsonRecord): AgentEvent[] {
  const callId = str(obj(record['toolCallResult'])['callId']);
  const ids = parts(record)
    .map((part) => obj(part['functionResponse']))
    .map((response) => str(response['id']) ?? str(response['name']))
    .filter((id): id is string => !!id);
  const toolIds = ids.length > 0 ? ids : callId ? [callId] : [];
  return toolIds.map((toolId) => ({ kind: 'toolEnd', toolId }));
}

export const qwenTranscriptFormat: JsonlFormat = {
  events(record) {
    switch (record['type']) {
      case 'user':
        return isRealPrompt(record) ? [{ kind: 'working' }] : [];
      case 'assistant':
        return assistantEvents(record);
      case 'tool_result':
        return toolResultEvents(record);
      case 'system':
        return record['subtype'] === 'turn_result' ? [{ kind: 'turnEnd' }] : [];
      default:
        return [];
    }
  },
  cwd: (record) => str(record['cwd']),
};
