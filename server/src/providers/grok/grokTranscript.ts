/**
 * grok's `updates.jsonl`: one ACP `SessionUpdate` envelope per line, append-only for a live session. The records
 * that move a character:
 *
 *   { params: { update: { sessionUpdate: 'user_message_chunk', _meta } } }           a prompt: the turn starts,
 *                                                                                     unless the chunk is harness-
 *                                                                                     injected (_meta.hostTurn or
 *                                                                                     _meta.hideFromScrollback)
 *   { params: { update: { sessionUpdate: 'tool_call', toolCallId, rawInput,
 *                          _meta: { 'x.ai/tool': { name } } } } }                     a tool call starts
 *   { params: { update: { sessionUpdate: 'tool_call_update', toolCallId, status } } } status 'completed'/'failed'
 *                                                                                     ends the matching tool call.
 *                                                                                     A status-less update is a
 *                                                                                     content enrichment, not a
 *                                                                                     result
 *   { params: { update: { sessionUpdate: 'turn_completed' } } }                      the turn ends
 *
 * grok never persists an approval wait (the blocking request is fire-and-forget, never written to the transcript)
 * or a clean session exit, so neither is mapped here: approvals come from herdr's own screen-detected `blocked`
 * status, and exit is inferred by the shared session store tracker from inactivity.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { AgentEvent } from '../../../../core/src/provider.js';
import type { JsonlFormat, JsonRecord } from '../sessionStore/jsonlSessionStore.js';
import { obj, str } from '../sessionStore/jsonlSessionStore.js';
import {
  GROK_CWD_SIDECAR_FILE_NAME,
  GROK_SUMMARY_FILE_NAME,
  GROK_TOOL_META_KEY,
  GROK_TOOL_STATUS_COMPLETED,
  GROK_TOOL_STATUS_FAILED,
  GROK_UPDATE_TOOL_CALL,
  GROK_UPDATE_TOOL_CALL_UPDATE,
  GROK_UPDATE_TURN_COMPLETED,
  GROK_UPDATE_USER_MESSAGE_CHUNK,
} from './constants.js';

/** The session's identity (the UUID herdr reports) is the transcript's own directory name:
 *  `<sessions-root>/<bucket>/<uuid>/updates.jsonl`. */
export function grokSessionIdOf(file: string): string {
  return path.basename(path.dirname(file));
}

function toolStartFor(update: JsonRecord): AgentEvent[] {
  const toolId = str(update['toolCallId']);
  const toolMeta = obj(obj(update['_meta'])[GROK_TOOL_META_KEY]);
  const toolName = str(toolMeta['name']) ?? str(update['title']);
  if (!toolId || !toolName) return [];
  return [{ kind: 'toolStart', toolId, toolName, input: update['rawInput'] }];
}

function toolEndFor(update: JsonRecord): AgentEvent[] {
  const status = str(update['status']);
  const toolId = str(update['toolCallId']);
  if (!toolId || (status !== GROK_TOOL_STATUS_COMPLETED && status !== GROK_TOOL_STATUS_FAILED))
    return [];
  return [{ kind: 'toolEnd', toolId }];
}

export const grokTranscriptFormat: JsonlFormat = {
  events(record) {
    const update = obj(obj(record['params'])['update']);
    switch (update['sessionUpdate']) {
      case GROK_UPDATE_USER_MESSAGE_CHUNK: {
        const chunkMeta = obj(update['_meta']);
        return chunkMeta['hostTurn'] === true || chunkMeta['hideFromScrollback'] === true
          ? []
          : [{ kind: 'working' }];
      }
      case GROK_UPDATE_TOOL_CALL:
        return toolStartFor(update);
      case GROK_UPDATE_TOOL_CALL_UPDATE:
        return toolEndFor(update);
      case GROK_UPDATE_TURN_COMPLETED:
        return [{ kind: 'turnEnd' }];
      default:
        return [];
    }
  },
  // The ACP envelope never carries cwd. It lives beside the transcript in grokCwdOf's sidecar lookup.
  cwd: () => undefined,
};

function readJsonFile(file: string): JsonRecord | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as JsonRecord)
      : null;
  } catch {
    return null;
  }
}

function readCwdSidecar(bucketDir: string): string | undefined {
  try {
    const raw = fs.readFileSync(path.join(bucketDir, GROK_CWD_SIDECAR_FILE_NAME), 'utf8').trim();
    return raw || undefined;
  } catch {
    return undefined;
  }
}

/** The bucket directory name is `urlencoding::encode(cwd)`, so percent-decoding it recovers the cwd whenever the
 *  encoder didn't fall back to a hash (only `.cwd` then says it). */
function decodeBucketCwd(bucketDir: string): string | undefined {
  try {
    const decoded = decodeURIComponent(path.basename(bucketDir));
    return path.isAbsolute(decoded) ? decoded : undefined;
  } catch {
    return undefined;
  }
}

/** cwd for a grok session: `summary.json`'s `info.cwd` first, falling back to the bucket's `.cwd` sidecar (written
 *  only for hash-form buckets) and finally the percent-decoded bucket name itself. */
export function grokCwdOf(file: string): string {
  const sessionDir = path.dirname(file);
  const bucketDir = path.dirname(sessionDir);
  const summary = readJsonFile(path.join(sessionDir, GROK_SUMMARY_FILE_NAME));
  const summaryCwd = summary ? str(obj(summary['info'])['cwd']) : undefined;
  return summaryCwd ?? readCwdSidecar(bucketDir) ?? decodeBucketCwd(bucketDir) ?? '';
}
