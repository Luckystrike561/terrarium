/**
 * Kiro CLI V2 (`kiro-cli chat`, the classic TUI) transcripts: one JSON record per line, envelope
 * `{version, kind, data}`. The kinds actually written (cross-checked against two independent reader
 * implementations):
 *
 *   { kind: 'Prompt', data: { message_id, content, meta } }             a user prompt: the turn starts
 *   { kind: 'AssistantMessage', data: { message_id, content } }         content blocks: text and/or toolUse
 *   { kind: 'ToolResults', data: { message_id, content } }              content blocks: toolResult
 *   { kind: 'Compaction', data: {...} }                                 history summary, not mapped
 *
 * No explicit turn-end or session-exit record exists in this format: three independent reader implementations
 * list only the four kinds above. A turn is taken to end on an AssistantMessage whose content carries only
 * text, since one that also calls a tool continues the turn. The CLI streams one reply as several AssistantMessage
 * records sharing a `message_id`, so an early text-only chunk can read as a turn end moments before a later chunk in
 * the same reply calls a tool; the next record corrects it, at the cost of a brief idle flicker. Session exit is
 * left to the shared tracker's active window, as OMP does, since nothing in the transcript records it.
 */

import type { AgentEvent } from '../../../../core/src/provider.js';
import type { JsonlFormat, JsonRecord } from '../sessionStore/jsonlSessionStore.js';
import { obj, str } from '../sessionStore/jsonlSessionStore.js';

function assistantEvents(data: JsonRecord): AgentEvent[] {
  const content = data['content'];
  const items = Array.isArray(content) ? content.map(obj) : [];
  const events: AgentEvent[] = [];
  let hasText = false;
  let hasToolUse = false;
  for (const block of items) {
    if (block['kind'] === 'toolUse') {
      const use = obj(block['data']);
      const toolId = str(use['toolUseId']);
      const toolName = str(use['name']);
      if (toolId && toolName) {
        hasToolUse = true;
        // The UI annotation `__tool_use_purpose` rides along in `input`; it is not a tool argument.
        const input = { ...obj(use['input']) };
        delete input['__tool_use_purpose'];
        events.push({ kind: 'toolStart', toolId, toolName, input });
      }
    } else if (block['kind'] === 'text' && str(block['data'])) {
      hasText = true;
    }
  }
  if (hasText && !hasToolUse) events.push({ kind: 'turnEnd' });
  return events;
}

function toolResultEvents(data: JsonRecord): AgentEvent[] {
  const content = data['content'];
  const items = Array.isArray(content) ? content.map(obj) : [];
  const events: AgentEvent[] = [];
  for (const block of items) {
    if (block['kind'] !== 'toolResult') continue;
    const toolId = str(obj(block['data'])['toolUseId']);
    if (toolId) events.push({ kind: 'toolEnd', toolId });
  }
  return events;
}

export const kiroV2TranscriptFormat: JsonlFormat = {
  events(record) {
    const data = obj(record['data']);
    switch (record['kind']) {
      case 'Prompt':
        return [{ kind: 'working' }];
      case 'AssistantMessage':
        return assistantEvents(data);
      case 'ToolResults':
        return toolResultEvents(data);
      default:
        return [];
    }
  },
  // cwd lives in the `.json` sidecar, never inside the transcript itself. The store falls back to its `cwdOf`.
  cwd: () => undefined,
};
