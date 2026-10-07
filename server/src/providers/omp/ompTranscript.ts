/**
 * omp transcripts: one JSON record per line. The records that move a character:
 *
 *   { type: 'session', cwd }                                        first line, the session header
 *   { type: 'message', message: { role: 'user' } }                  a prompt: the turn starts
 *   { type: 'message', message: { role: 'assistant', stopReason } } 'toolUse' continues the turn, anything else ends it
 *   { type: 'custom', customType: 'tool_execution_start', data: { toolCallId, toolName, intent, args } }
 *   { type: 'custom', customType: 'session_exit' }                  written when omp shuts the session down
 */

import * as fs from 'node:fs';

import type { AgentEvent } from '../../../../core/src/provider.js';
import {
  OMP_HEADER_MAX_BYTES,
  OMP_STATE_TAIL_BYTES,
  OMP_STOP_REASON_TOOL_USE,
} from './constants.js';

type OmpRecord = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function parseRecord(line: string): OmpRecord | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return parsed && typeof parsed === 'object' ? (parsed as OmpRecord) : null;
  } catch {
    return null; // a partial or foreign line carries nothing to show
  }
}

function toolStartFor(data: OmpRecord): AgentEvent | null {
  const toolId = str(data['toolCallId']);
  const toolName = str(data['toolName']);
  if (!toolId || !toolName) return null;
  const args = data['args'] && typeof data['args'] === 'object' ? (data['args'] as OmpRecord) : {};
  // omp lifts the agent's one-line intent out of the tool arguments; it reads better than anything rebuilt from them.
  return { kind: 'toolStart', toolId, toolName, input: { ...args, intent: str(data['intent']) } };
}

/** The AgentEvent one transcript line stands for, or null for lines that change nothing on screen. */
export function eventForTranscriptLine(line: string): AgentEvent | null {
  const record = parseRecord(line);
  if (!record) return null;
  if (record['type'] === 'message') {
    const message = (record['message'] ?? {}) as OmpRecord;
    if (message['role'] === 'user') return { kind: 'working' };
    const stopReason = str(message['stopReason']);
    if (message['role'] === 'assistant' && stopReason && stopReason !== OMP_STOP_REASON_TOOL_USE) {
      return { kind: 'turnEnd' };
    }
    return null;
  }
  if (record['type'] !== 'custom') return null;
  if (record['customType'] === 'tool_execution_start') {
    return toolStartFor((record['data'] ?? {}) as OmpRecord);
  }
  if (record['customType'] === 'session_exit') return { kind: 'sessionEnd', reason: 'exit' };
  return null;
}

function readRange(file: string, start: number, length: number): Buffer {
  const buf = Buffer.alloc(length);
  const fd = fs.openSync(file, 'r');
  try {
    return buf.subarray(0, fs.readSync(fd, buf, 0, length, start));
  } finally {
    fs.closeSync(fd);
  }
}

/** Working directory from the transcript's `session` header, or '' when the header is missing or unreadable. omp
 *  writes a padded `title` record first (rewritten in place as the title changes), so the header is not line one. */
export function readSessionCwd(file: string, size: number): string {
  try {
    const head = readRange(file, 0, Math.min(size, OMP_HEADER_MAX_BYTES)).toString('utf8');
    for (const line of head.split('\n')) {
      const record = parseRecord(line);
      if (record?.['type'] === 'session') return str(record['cwd']) ?? '';
    }
    return '';
  } catch {
    return '';
  }
}

export type TranscriptState = 'working' | 'idle' | 'exited';

/** Where the session stands at the end of the transcript, read from its last records. History is never replayed:
 *  this only decides the state a character starts in. */
export function readTranscriptState(file: string, size: number): TranscriptState {
  let tail: string;
  const start = Math.max(0, size - OMP_STATE_TAIL_BYTES);
  try {
    tail = readRange(file, start, size - start).toString('utf8');
  } catch {
    return 'idle';
  }
  const lines = tail.split('\n');
  if (start > 0) lines.shift(); // cut mid-record
  let state: TranscriptState = 'idle';
  for (const line of lines) {
    const event = eventForTranscriptLine(line);
    if (event?.kind === 'working' || event?.kind === 'toolStart') state = 'working';
    else if (event?.kind === 'turnEnd') state = 'idle';
    else if (event?.kind === 'sessionEnd') state = 'exited';
  }
  return state;
}

/** Bytes appended to `file` since `offset`, at most `maxBytes`. Raw bytes: a read can end inside a multi-byte
 *  character, so callers decode only complete lines. */
export function readAppended(file: string, offset: number, size: number, maxBytes: number): Buffer {
  return readRange(file, offset, Math.min(size - offset, maxBytes));
}
