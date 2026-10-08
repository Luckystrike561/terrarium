/**
 * Kiro 3 (`kiro-cli --v3`) and Kiro IDE transcripts: `messages.jsonl`, envelope `{id, timestamp, payload}`.
 * Confirmed `payload.type` values, from the `@kiro/agent` 0.66.0 engine source and an independent reader
 * implementation's tests:
 *
 *   { type: 'user', content }                                     a prompt: the turn starts
 *   { type: 'turn_start' }
 *   { type: 'tool_call', toolCallId, toolName, args, status }      one line per state the call passes through:
 *                                                                   awaiting_approval -> executing -> completed/
 *                                                                   failed/denied, all with the same args
 *   { type: 'tool_result', toolCallId, content, success }
 *   { type: 'turn_end', stopReason }
 *   { type: 'session_metadata' | 'usage_summary', ... }            context/credit telemetry, not mapped
 *
 * Only `awaiting_approval` (asks the user) and `executing` (the call actually starts) are mapped out of the
 * repeated `tool_call` lines; `completed`/`failed` are redundant with the `tool_result` line that follows them.
 * `denied` ends the call with no `tool_result` at all, so it is mapped as a toolEnd to avoid leaving the call
 * stuck open. This shape is inference-grade: it has not been confirmed on a live transcript, since it comes
 * from reading the engine's source rather than an observed one.
 */

import type { AgentEvent } from '../../../../core/src/provider.js';
import type { JsonlFormat, JsonRecord } from '../sessionStore/jsonlSessionStore.js';
import { obj, str } from '../sessionStore/jsonlSessionStore.js';

function toolCallEvents(payload: JsonRecord): AgentEvent[] {
  const toolId = str(payload['toolCallId']);
  if (!toolId) return [];
  const status = str(payload['status']);
  if (status === 'awaiting_approval') return [{ kind: 'permissionRequest' }];
  const toolName = str(payload['toolName']);
  if (status === 'executing' && toolName) {
    return [{ kind: 'toolStart', toolId, toolName, input: obj(payload['args']) }];
  }
  if (status === 'denied') return [{ kind: 'toolEnd', toolId }];
  return [];
}

export const kiroV3TranscriptFormat: JsonlFormat = {
  events(record) {
    const payload = obj(record['payload']);
    switch (payload['type']) {
      case 'user':
      case 'turn_start':
        return [{ kind: 'working' }];
      case 'tool_call':
        return toolCallEvents(payload);
      case 'tool_result': {
        const toolId = str(payload['toolCallId']);
        return toolId ? [{ kind: 'toolEnd', toolId }] : [];
      }
      case 'turn_end':
        return [{ kind: 'turnEnd' }];
      default:
        return [];
    }
  },
  // cwd lives in the sibling `session.json`, never inside a message record. The store falls back to its `cwdOf`.
  cwd: () => undefined,
};
