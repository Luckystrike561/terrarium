/**
 * Grok CLI agent module. Grok has no hook API this module reads: everything comes from its own append-only session
 * transcripts (`updates.jsonl`), found by scanning its session store or handed over by a multiplexer that hosts the
 * session. Nothing is written outside `~/.pixel-agents/`, so there is nothing to consent to.
 */

import * as os from 'node:os';
import * as path from 'node:path';

import type { AgentModule } from '../../../../core/src/provider.js';
import { DEFAULT_SESSION_STORE_TIMING } from '../sessionStore/constants.js';
import { jsonlSessionStore } from '../sessionStore/jsonlSessionStore.js';
import { SessionStoreTracker } from '../sessionStore/sessionStoreTracker.js';
import {
  GROK_HOME_ENV_VAR,
  GROK_SESSIONS_DIR_SEGMENTS,
  GROK_STATUS_DETAIL_MAX_LENGTH,
  GROK_STATUS_MAX_LENGTH,
  GROK_TRANSCRIPT_FILE_NAME,
} from './constants.js';
import { grokCwdOf, grokSessionIdOf, grokTranscriptFormat } from './grokTranscript.js';

type ToolInput = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\u2026` : s;
}

/** Status text for a grok tool call, from its model-facing tool name and raw input. */
export function formatToolStatus(toolName: string, input?: unknown): string {
  const args = (input ?? {}) as ToolInput;
  switch (toolName) {
    case 'read_file':
      return `Reading ${path.basename(str(args['target_file']) ?? '')}`.trim();
    case 'write':
      return `Writing ${path.basename(str(args['file_path']) ?? '')}`.trim();
    case 'search_replace':
      return `Editing ${path.basename(str(args['file_path']) ?? '')}`.trim();
    case 'run_terminal_command': {
      const command = str(args['command']) ?? '';
      return command
        ? `Running: ${truncate(command, GROK_STATUS_DETAIL_MAX_LENGTH)}`
        : 'Running a command';
    }
    case 'list_dir':
      return 'Listing files';
    case 'grep':
    case 'glob':
      return 'Searching code';
    case 'web_fetch':
      return 'Fetching web content';
    case 'web_search':
      return 'Searching the web';
    case 'todo_write':
      return 'Planning tasks';
    case 'spawn_subagent': {
      const label = str(args['label']) ?? str(args['prompt']) ?? '';
      return label
        ? `Subtask: ${truncate(label, GROK_STATUS_DETAIL_MAX_LENGTH)}`
        : 'Running subtask';
    }
    default:
      return truncate(toolName, GROK_STATUS_MAX_LENGTH);
  }
}

export const grokModule: AgentModule = {
  kind: 'agent',
  id: 'grok',
  displayName: 'Grok CLI',
  protocolVersion: 1,

  formatToolStatus,
  permissionExemptTools: new Set<string>(),
  // grok runs subagents as independent sessions of their own, discovered the same way as any other grok session.
  subagentToolNames: new Set<string>(),
  readingTools: new Set(['read_file', 'list_dir', 'grep', 'glob', 'web_fetch', 'web_search']),

  // grok sessions run in whatever directory the user started them in.
  adoptsSessionsOutsideWorkspace: true,
  start: (host) =>
    new SessionStoreTracker(
      host,
      jsonlSessionStore({
        root: path.join(
          process.env[GROK_HOME_ENV_VAR] || path.join(os.homedir(), '.grok'),
          ...GROK_SESSIONS_DIR_SEGMENTS,
        ),
        depth: 2,
        isTranscript: (name) => name === GROK_TRANSCRIPT_FILE_NAME,
        format: grokTranscriptFormat,
        sessionIdOf: grokSessionIdOf,
        cwdOf: grokCwdOf,
      }),
      DEFAULT_SESSION_STORE_TIMING,
    ),
};
