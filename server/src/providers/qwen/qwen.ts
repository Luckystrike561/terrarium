/**
 * Qwen Code agent module. Qwen Code has no hook API this module installs: everything comes from its own session
 * transcripts, found by scanning its session store or handed over by a multiplexer that hosts the session. Nothing
 * is written outside `~/.pixel-agents/`, so there is nothing to consent to.
 *
 * Unlike omp, herdr reports a qwen session by its own UUID (kind `id`), not by transcript path, so this module's
 * store is keyed by that id (`sessionIdOf`) rather than the file's real path.
 */

import * as os from 'node:os';
import * as path from 'node:path';

import type { AgentModule } from '../../../../core/src/provider.js';
import { DEFAULT_SESSION_STORE_TIMING } from '../sessionStore/constants.js';
import { jsonlSessionStore } from '../sessionStore/jsonlSessionStore.js';
import { SessionStoreTracker } from '../sessionStore/sessionStoreTracker.js';
import {
  QWEN_DEFAULT_HOME_DIR,
  QWEN_HOME_ENV,
  QWEN_PROJECTS_DEPTH,
  QWEN_PROJECTS_DIR_SEGMENT,
  QWEN_RUNTIME_DIR_ENV,
  QWEN_SESSION_FILE_SUFFIX,
  QWEN_STATUS_DETAIL_MAX_LENGTH,
  QWEN_STATUS_MAX_LENGTH,
} from './constants.js';
import { qwenTranscriptFormat } from './qwenTranscript.js';

type ToolInput = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\u2026` : s;
}

/** Status text for a Qwen Code tool call. Qwen's transcript carries no model-authored intent line like omp's, so
 *  labels are built from each tool's own arguments. */
export function formatToolStatus(toolName: string, input?: unknown): string {
  const args = (input ?? {}) as ToolInput;
  const file = path.basename(str(args['file_path']) ?? '');
  switch (toolName) {
    case 'read_file':
      return `Reading ${file}`.trim();
    case 'write_file':
      return `Writing ${file}`.trim();
    case 'edit':
    case 'replace':
    case 'notebook_edit':
      return `Editing ${file}`.trim();
    case 'run_shell_command': {
      const command = str(args['command']) ?? '';
      return command
        ? `Running: ${truncate(command, QWEN_STATUS_DETAIL_MAX_LENGTH)}`
        : 'Running a command';
    }
    case 'list_directory': {
      const dir = path.basename(str(args['path']) ?? '');
      return `Listing ${dir}`.trim();
    }
    case 'grep_search':
    case 'search_file_content':
    case 'glob':
    case 'lsp':
      return 'Searching code';
    case 'web_fetch':
      return 'Fetching web content';
    case 'web_search':
      return 'Searching the web';
    case 'agent':
    case 'task': {
      const description = str(args['description']) ?? '';
      return description
        ? `Subtask: ${truncate(description, QWEN_STATUS_DETAIL_MAX_LENGTH)}`
        : 'Running subtask';
    }
    case 'todo_write':
      return 'Planning tasks';
    default:
      return truncate(toolName, QWEN_STATUS_MAX_LENGTH);
  }
}

/** `Storage.getRuntimeBaseDir()`'s resolution order, minus the `advanced.runtimeOutputDir` settings-file layer (no
 *  evidence of its schema beyond the one field): `QWEN_RUNTIME_DIR` env, then `QWEN_HOME` env, then `~/.qwen`. */
function qwenRuntimeBaseDir(): string {
  return (
    process.env[QWEN_RUNTIME_DIR_ENV] ||
    process.env[QWEN_HOME_ENV] ||
    path.join(os.homedir(), QWEN_DEFAULT_HOME_DIR)
  );
}

export const qwenModule: AgentModule = {
  kind: 'agent',
  id: 'qwen',
  displayName: 'Qwen Code',
  protocolVersion: 1,

  formatToolStatus,
  permissionExemptTools: new Set<string>(),
  // Sub-agent ("agent" tool) activity is recorded as sidechain records inside the same transcript, not a report
  // from a distinct sub-agent session: nothing here can clear a sub-character it would spawn.
  subagentToolNames: new Set<string>(),
  readingTools: new Set([
    'read_file',
    'grep_search',
    'search_file_content',
    'glob',
    'list_directory',
    'lsp',
    'web_fetch',
    'web_search',
  ]),

  // Qwen Code sessions run in whatever directory the user started them in.
  adoptsSessionsOutsideWorkspace: true,
  start: (host) =>
    new SessionStoreTracker(
      host,
      jsonlSessionStore({
        root: path.join(qwenRuntimeBaseDir(), QWEN_PROJECTS_DIR_SEGMENT),
        depth: QWEN_PROJECTS_DEPTH,
        isTranscript: (name) => name.endsWith(QWEN_SESSION_FILE_SUFFIX),
        sessionIdOf: (file) => path.basename(file, QWEN_SESSION_FILE_SUFFIX),
        format: qwenTranscriptFormat,
      }),
      DEFAULT_SESSION_STORE_TIMING,
    ),
};
