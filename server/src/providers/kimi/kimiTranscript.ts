/**
 * Kimi Code's `agents/main/wire.jsonl`: one JSON record per line. The records that move a character:
 *
 *   { type: 'turn.prompt', ... }                                               a prompt: the turn starts
 *   { type: 'context.append_message', message: { role: 'user' } }              same, for sessions migrated
 *                                                                               from the legacy `kimi-cli` format
 *   { type: 'context.append_loop_event', event: { type: 'tool.call', toolCallId, name, args } }
 *   { type: 'context.append_loop_event', event: { type: 'tool.result', toolCallId } }
 *   { type: 'context.append_loop_event', event: { type: 'step.end', finishReason } }  not 'tool_use' ends the turn
 *   { type: 'turn.ended', ... }                                                the turn's formal close
 *
 * Nothing in the transcript records a pending approval or a clean session exit: both are reported only by hooks
 * this read-only module does not install, so `permissionRequest` and `sessionEnd` are never emitted here.
 */

import type { AgentEvent } from '../../../../core/src/provider.js';
import type { JsonlFormat, JsonRecord } from '../sessionStore/jsonlSessionStore.js';
import { obj, str } from '../sessionStore/jsonlSessionStore.js';
import { KIMI_STOP_REASON_TOOL_USE } from './constants.js';

function toolStartFor(event: JsonRecord): AgentEvent[] {
  const toolId = str(event['toolCallId']);
  const toolName = str(event['name']);
  if (!toolId || !toolName) return [];
  return [{ kind: 'toolStart', toolId, toolName, input: obj(event['args']) }];
}

function loopEventsFor(record: JsonRecord): AgentEvent[] {
  const event = obj(record['event']);
  switch (event['type']) {
    case 'tool.call':
      return toolStartFor(event);
    case 'tool.result': {
      const toolId = str(event['toolCallId']);
      return toolId ? [{ kind: 'toolEnd', toolId }] : [];
    }
    case 'step.end': {
      const finishReason = str(event['finishReason']);
      return finishReason && finishReason !== KIMI_STOP_REASON_TOOL_USE
        ? [{ kind: 'turnEnd' }]
        : [];
    }
    default:
      return [];
  }
}

export function kimiWireEvents(record: JsonRecord): AgentEvent[] {
  switch (record['type']) {
    case 'turn.prompt':
      return [{ kind: 'working' }];
    case 'context.append_message':
      return obj(record['message'])['role'] === 'user' ? [{ kind: 'working' }] : [];
    case 'context.append_loop_event':
      return loopEventsFor(record);
    case 'turn.ended':
      return [{ kind: 'turnEnd' }];
    default:
      return [];
  }
}

/** Kimi never records a session's cwd in its transcript (it lives in the sibling `state.json`, read via the
 *  store's `cwdOf`), so this side of the format always defers to that fallback. */
export const kimiWireFormat: JsonlFormat = {
  events: kimiWireEvents,
  cwd: () => undefined,
};
