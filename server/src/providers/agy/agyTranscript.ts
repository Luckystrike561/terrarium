/**
 * Antigravity CLI transcripts: one JSON "step" record per line. The records that move a character:
 *
 *   { source: 'USER_EXPLICIT', type: 'USER_INPUT' }                   a prompt: the turn starts
 *   { type: 'PLANNER_RESPONSE', tool_calls: [{ name, args }, ...] }   a response with calls still pending
 *   { type: 'PLANNER_RESPONSE', content, tool_calls: [] | absent }    a response with nothing left to call: the
 *                                                                     turn ends
 *
 * Tool results are their own records, typed by tool (`RUN_COMMAND`, `VIEW_FILE`, ...), and carry no call id:
 * every third-party parser of this format matches a result to its call only by position while holding state
 * across the whole file. This format reads one record at a time with no memory of the one before it (the
 * `JsonlFormat` contract is shared by every session this store tracks), so a result can't be attributed back to
 * its call here. Every `tool_calls[]` entry still gets its own `toolStart`; the runtime already clears every open
 * tool when a turn ends (`markAgentWaiting` on `turnEnd`), so nothing lingers once the response above arrives.
 */

import type { JsonlFormat, JsonRecord } from '../sessionStore/jsonlSessionStore.js';
import { obj, str } from '../sessionStore/jsonlSessionStore.js';
import {
  AGY_SOURCE_USER_EXPLICIT,
  AGY_TYPE_PLANNER_RESPONSE,
  AGY_TYPE_USER_INPUT,
} from './constants.js';

export const agyTranscriptFormat: JsonlFormat = {
  events(record) {
    if (record['source'] === AGY_SOURCE_USER_EXPLICIT && record['type'] === AGY_TYPE_USER_INPUT) {
      return [{ kind: 'working' }];
    }
    if (record['type'] !== AGY_TYPE_PLANNER_RESPONSE) return [];
    const calls = record['tool_calls'];
    const toolCalls: JsonRecord[] = Array.isArray(calls) ? calls.map(obj) : [];
    if (toolCalls.length === 0) {
      return str(record['content']) ? [{ kind: 'turnEnd' }] : [];
    }
    const stepIndex = record['step_index'];
    const prefix = typeof stepIndex === 'number' ? String(stepIndex) : '0';
    return toolCalls.map((call, index) => ({
      kind: 'toolStart',
      toolId: `${prefix}:${index}`,
      toolName: str(call['name']) ?? '',
      input: obj(call['args']),
    }));
  },
  // Antigravity never records a working directory in the transcript itself; the module supplies one from
  // `history.jsonl` instead, via `JsonlStoreOptions.cwdOf`.
  cwd: () => undefined,
};
