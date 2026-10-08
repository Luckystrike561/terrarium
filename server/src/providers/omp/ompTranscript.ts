/**
 * omp transcripts: one JSON record per line. The records that move a character:
 *
 *   { type: 'session', cwd }                                        the session header (after a padded `title`)
 *   { type: 'message', message: { role: 'user' } }                  a prompt: the turn starts
 *   { type: 'message', message: { role: 'assistant', stopReason } } 'toolUse' continues the turn, anything else ends it
 *   { type: 'custom', customType: 'tool_execution_start', data: { toolCallId, toolName, intent, args } }
 *   { type: 'custom', customType: 'session_exit' }                  written when omp shuts the session down
 */

import type { AgentEvent } from '../../../../core/src/provider.js';
import type { JsonlFormat, JsonRecord } from '../sessionStore/jsonlSessionStore.js';
import { obj, str } from '../sessionStore/jsonlSessionStore.js';
import { OMP_STOP_REASON_TOOL_USE } from './constants.js';

function toolStartFor(data: JsonRecord): AgentEvent[] {
  const toolId = str(data['toolCallId']);
  const toolName = str(data['toolName']);
  if (!toolId || !toolName) return [];
  // omp lifts the agent's one-line intent out of the tool arguments: it reads better than anything rebuilt from them.
  return [
    {
      kind: 'toolStart',
      toolId,
      toolName,
      input: { ...obj(data['args']), intent: str(data['intent']) },
    },
  ];
}

export const ompTranscriptFormat: JsonlFormat = {
  events(record) {
    if (record['type'] === 'message') {
      const message = obj(record['message']);
      if (message['role'] === 'user') return [{ kind: 'working' }];
      const stopReason = str(message['stopReason']);
      if (
        message['role'] === 'assistant' &&
        stopReason &&
        stopReason !== OMP_STOP_REASON_TOOL_USE
      ) {
        return [{ kind: 'turnEnd' }];
      }
      return [];
    }
    if (record['type'] !== 'custom') return [];
    if (record['customType'] === 'tool_execution_start') return toolStartFor(obj(record['data']));
    if (record['customType'] === 'session_exit') return [{ kind: 'sessionEnd', reason: 'exit' }];
    return [];
  },
  cwd: (record) => (record['type'] === 'session' ? str(record['cwd']) : undefined),
};
