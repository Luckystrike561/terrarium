/**
 * Antigravity CLI (`agy`) agent module. Antigravity has no hook API and its transcripts record no session-exit:
 * everything comes from its conversation transcripts, found by scanning its `brain/` store or handed over by a
 * multiplexer that hosts the session. Nothing is written outside `~/.pixel-agents/`, so there is nothing to
 * consent to.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { AgentModule } from '../../../../core/src/provider.js';
import { DEFAULT_SESSION_STORE_TIMING } from '../sessionStore/constants.js';
import { jsonlSessionStore, parseJsonRecord, str } from '../sessionStore/jsonlSessionStore.js';
import { SessionStoreTracker } from '../sessionStore/sessionStoreTracker.js';
import { agyTranscriptFormat } from './agyTranscript.js';
import {
  AGY_BRAIN_DIR_SEGMENTS,
  AGY_HISTORY_FILE_SEGMENTS,
  AGY_SESSION_DEPTH,
  AGY_STATUS_DETAIL_MAX_LENGTH,
  AGY_STATUS_MAX_LENGTH,
  AGY_TRANSCRIPT_FILE_NAME,
} from './constants.js';

type ToolInput = Record<string, unknown>;

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\u2026` : s;
}

/** The conversation uuid a transcript belongs to: the directory three levels above it,
 *  `brain/<uuid>/.system_generated/logs/transcript_full.jsonl`. This is also the id herdr's Antigravity
 *  integration reports as `agent_session.value` (`kind: "id"`), so a session is keyed by it directly. */
function conversationIdOf(file: string): string {
  return path.basename(path.dirname(path.dirname(path.dirname(file))));
}

function workspacePathOf(workspace: string): string {
  if (!workspace.startsWith('file://')) return workspace;
  try {
    return decodeURIComponent(new URL(workspace).pathname);
  } catch {
    return '';
  }
}

/** Antigravity's transcripts never record a working directory; `history.jsonl` (`{workspace, conversationId}`,
 *  sibling of `brain/`) is the only local store that maps a conversation id back to it. */
function cwdFromHistory(file: string): string {
  const conversationId = conversationIdOf(file);
  let content: string;
  try {
    content = fs.readFileSync(path.join(os.homedir(), ...AGY_HISTORY_FILE_SEGMENTS), 'utf8');
  } catch {
    return '';
  }
  let cwd = '';
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    const record = parseJsonRecord(line);
    if (!record || str(record['conversationId']) !== conversationId) continue;
    cwd = workspacePathOf(str(record['workspace']) ?? '') || cwd;
  }
  return cwd;
}

/** Status text for an Antigravity tool call. The agent's own one-line summary wins, same idea as omp's intent. */
export function formatToolStatus(toolName: string, input?: unknown): string {
  const args = (input ?? {}) as ToolInput;
  const summary = str(args['toolSummary']) ?? str(args['toolAction']);
  if (summary) return truncate(summary, AGY_STATUS_MAX_LENGTH);

  switch (toolName) {
    case 'view_file':
    case 'view_file_chunk':
      return `Reading ${path.basename(str(args['AbsolutePath']) ?? '')}`.trim();
    case 'list_dir':
      return `Listing ${path.basename(str(args['DirectoryPath']) ?? '')}`.trim();
    case 'grep_search':
      return 'Searching code';
    case 'read_url_content':
      return 'Fetching web content';
    case 'search_web':
      return 'Searching the web';
    case 'write_to_file':
      return `Writing ${path.basename(str(args['TargetFile']) ?? '')}`.trim();
    case 'replace_file_content':
    case 'multi_replace_file_content':
      return `Editing ${path.basename(str(args['TargetFile']) ?? '')}`.trim();
    case 'run_command': {
      const command = str(args['CommandLine']) ?? '';
      return command
        ? `Running: ${truncate(command, AGY_STATUS_DETAIL_MAX_LENGTH)}`
        : 'Running a command';
    }
    case 'manage_task':
      return 'Planning tasks';
    case 'invoke_subagent':
    case 'define_subagent':
    case 'manage_subagents':
    case 'send_message':
      return 'Running subtask';
    case 'ask_question':
    case 'ask_permission':
    case 'list_permissions':
      return 'Asking a question';
    case 'call_mcp_tool': {
      const mcpTool = str(args['ToolName']);
      return mcpTool
        ? `Running: ${truncate(mcpTool, AGY_STATUS_DETAIL_MAX_LENGTH)}`
        : 'Running a tool';
    }
    default:
      return truncate(toolName, AGY_STATUS_MAX_LENGTH);
  }
}

export const agyModule: AgentModule = {
  kind: 'agent',
  id: 'agy',
  displayName: 'Antigravity CLI',
  protocolVersion: 1,

  formatToolStatus,
  permissionExemptTools: new Set<string>(),
  // No evidence that Antigravity's own sub-agent tool calls (invoke_subagent) ever show up as progress records
  // inside the parent's transcript; invoke_subagent renders as a plain tool call instead, like omp's task.
  subagentToolNames: new Set<string>(),
  readingTools: new Set([
    'view_file',
    'view_file_chunk',
    'list_dir',
    'grep_search',
    'read_url_content',
    'search_web',
  ]),

  // Antigravity sessions run in whatever directory the user started them in.
  adoptsSessionsOutsideWorkspace: true,
  start: (host) =>
    new SessionStoreTracker(
      host,
      jsonlSessionStore({
        root: path.join(os.homedir(), ...AGY_BRAIN_DIR_SEGMENTS),
        depth: AGY_SESSION_DEPTH,
        isTranscript: (name) => name === AGY_TRANSCRIPT_FILE_NAME,
        format: agyTranscriptFormat,
        sessionIdOf: conversationIdOf,
        cwdOf: cwdFromHistory,
      }),
      DEFAULT_SESSION_STORE_TIMING,
    ),
};
