/**
 * Kiro CLI agent module. Kiro has no hook API, and herdr ships no integration for it at all (its own
 * agent docs list Kiro CLI as state-only, with no reported session id). Kiro 3 (`--v3`) self-reports its own
 * `sess_<uuid>` session id to herdr, so a pane running `--v3` still hands over by id. A classic (V2) pane hands
 * over nothing and is only ever found by this module's own discovery, joined to a herdr pane by
 * `sessionInDirectory`. Everything comes from Kiro's own session store. Nothing is written outside
 * `~/.pixel-agents/`, so there is nothing to
 * consent to.
 */

import * as path from 'node:path';

import type { AgentModule } from '../../../../core/src/provider.js';
import { DEFAULT_SESSION_STORE_TIMING } from '../sessionStore/constants.js';
import { SessionStoreTracker } from '../sessionStore/sessionStoreTracker.js';
import { KIRO_STATUS_DETAIL_MAX_LENGTH, KIRO_STATUS_MAX_LENGTH } from './constants.js';
import { kiroSessionStore } from './kiroSessionStore.js';

type ToolInput = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\u2026` : s;
}

/** The path a file tool acted on. V2 and V3 disagree on the field name, and V2's `read` nests it under
 *  `operations[].path` instead of a top-level field. */
function filePath(args: ToolInput): string {
  const direct =
    str(args['path']) ?? str(args['file_path']) ?? str(args['filePath']) ?? str(args['targetFile']);
  if (direct) return direct;
  const operations = args['operations'];
  if (Array.isArray(operations)) {
    for (const operation of operations) {
      const opPath = str((operation as ToolInput | undefined)?.['path']);
      if (opPath) return opPath;
    }
  }
  return '';
}

/** Status text for a Kiro tool call, across both the V2 TUI vocabulary (`read`, `write`, `edit`, `shell`, ...) and
 *  the V3/headless vocabulary (`read_file`, `fs_write`, `str_replace`, `execute_bash`, ...). */
export function formatToolStatus(toolName: string, input?: unknown): string {
  const args = (input ?? {}) as ToolInput;
  const file = path.basename(filePath(args));
  switch (toolName) {
    case 'read':
    case 'read_file':
      return `Reading ${file}`.trim();
    case 'write':
    case 'fs_write':
    case 'fs_append':
      return `Writing ${file}`.trim();
    case 'edit':
    case 'str_replace':
      return `Editing ${file}`.trim();
    case 'delete_file':
      return `Deleting ${file}`.trim();
    case 'shell':
    case 'execute_bash':
    case 'execute_pwsh': {
      const command = str(args['command']) ?? '';
      return command
        ? `Running: ${truncate(command, KIRO_STATUS_DETAIL_MAX_LENGTH)}`
        : 'Running a command';
    }
    case 'grep':
    case 'glob':
    case 'list_directory':
      return 'Searching code';
    case 'web_fetch':
    case 'fetch':
      return 'Fetching web content';
    case 'web_search':
    case 'search':
      return 'Searching the web';
    case 'introspect':
    case 'getDiagnostics':
      return 'Checking diagnostics';
    case 'todo':
      return 'Planning tasks';
    case 'subagent': {
      const description =
        str(args['task']) ?? str(args['prompt']) ?? str(args['explanation']) ?? '';
      return description
        ? `Subtask: ${truncate(description, KIRO_STATUS_DETAIL_MAX_LENGTH)}`
        : 'Running subtask';
    }
    default:
      return truncate(toolName, KIRO_STATUS_MAX_LENGTH);
  }
}

export const kiroModule: AgentModule = {
  kind: 'agent',
  id: 'kiro',
  displayName: 'Kiro CLI',
  protocolVersion: 1,

  formatToolStatus,
  permissionExemptTools: new Set<string>(),
  // V2 sub-agent spawns (`subagent`) get their own `cli/<uuid>.jsonl` session, not inline tool results here.
  subagentToolNames: new Set<string>(),
  readingTools: new Set([
    'read',
    'read_file',
    'grep',
    'glob',
    'web_fetch',
    'fetch',
    'web_search',
    'search',
    'introspect',
    'list_directory',
    'getDiagnostics',
  ]),

  // Kiro sessions run in whatever directory the user started them in.
  adoptsSessionsOutsideWorkspace: true,
  start: (host) => new SessionStoreTracker(host, kiroSessionStore(), DEFAULT_SESSION_STORE_TIMING),
};
