/**
 * Gemini CLI agent module. Gemini has no hook API, and herdr reports no session identity for it (only a
 * status level read from its screen manifest), so everything comes from Gemini's own session store, found
 * by scanning it. A herdr pane is joined to a session by cwd through `sessionInDirectory`. Nothing is
 * written outside `~/.pixel-agents/`, so there is nothing to consent to.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { AgentModule } from '../../../../core/src/provider.js';
import { DEFAULT_SESSION_STORE_TIMING } from '../sessionStore/constants.js';
import { jsonlSessionStore, obj, str } from '../sessionStore/jsonlSessionStore.js';
import { SessionStoreTracker } from '../sessionStore/sessionStoreTracker.js';
import {
  GEMINI_CACHE_DIR_SEGMENTS,
  GEMINI_DIR_NAME,
  GEMINI_HOME_ENV_VAR,
  GEMINI_PROJECT_ROOT_MARKER,
  GEMINI_SANDBOX_ENV_VAR,
  GEMINI_SANDBOX_EXEC_VALUE,
  GEMINI_SESSION_FILE_PREFIX,
  GEMINI_SESSION_FILE_SUFFIX,
  GEMINI_SESSIONS_DEPTH,
  GEMINI_SESSIONS_ROOT_SEGMENTS,
  GEMINI_STATUS_DETAIL_MAX_LENGTH,
  GEMINI_STATUS_MAX_LENGTH,
} from './constants.js';
import { geminiTranscriptFormat } from './geminiTranscript.js';

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\u2026` : s;
}

/** Gemini CLI's runtime directory: `~/.gemini` (or `$GEMINI_CLI_HOME/.gemini`), redirected to a cache
 *  subdirectory under macOS Seatbelt sandboxing (`Storage.getGlobalRuntimeDir`). */
function geminiRuntimeDir(): string {
  const home = process.env[GEMINI_HOME_ENV_VAR] || os.homedir();
  if (process.env[GEMINI_SANDBOX_ENV_VAR] === GEMINI_SANDBOX_EXEC_VALUE) {
    return path.join(home, ...GEMINI_CACHE_DIR_SEGMENTS);
  }
  return path.join(home, GEMINI_DIR_NAME);
}

/** The project root a session's `tmp/<slug>/chats/<file>.jsonl` belongs to, read from the ownership
 *  marker Gemini drops beside the slug directory (`ProjectRegistry`'s `.project_root`). The transcript
 *  itself never records cwd. */
function cwdOf(file: string): string {
  const markerPath = path.join(path.dirname(path.dirname(file)), GEMINI_PROJECT_ROOT_MARKER);
  try {
    return fs.readFileSync(markerPath, 'utf8').trim();
  } catch {
    return '';
  }
}

/** Status text for a Gemini CLI tool call. */
export function formatToolStatus(toolName: string, input?: unknown): string {
  const args = obj(input);
  switch (toolName) {
    case 'read_file':
      return `Reading ${path.basename(str(args['file_path']) ?? '')}`.trim();
    case 'read_many_files':
      return 'Reading files';
    case 'list_directory':
      return `Reading ${path.basename(str(args['dir_path']) ?? '')}`.trim();
    case 'write_file':
      return `Writing ${path.basename(str(args['file_path']) ?? '')}`.trim();
    case 'replace': // Gemini's edit tool
      return `Editing ${path.basename(str(args['file_path']) ?? '')}`.trim();
    case 'run_shell_command': {
      const command = str(args['command']) ?? '';
      return command
        ? `Running: ${truncate(command, GEMINI_STATUS_DETAIL_MAX_LENGTH)}`
        : 'Running a command';
    }
    case 'grep_search':
    case 'search_file_content': // legacy alias of grep_search (TOOL_LEGACY_ALIASES)
    case 'glob':
      return 'Searching code';
    case 'web_fetch':
      return 'Fetching web content';
    case 'google_web_search':
      return 'Searching the web';
    case 'get_internal_docs':
      return 'Reading documentation';
    case 'read_mcp_resource':
    case 'list_mcp_resources':
      return 'Reading resources';
    case 'write_todos':
    case 'enter_plan_mode':
    case 'exit_plan_mode':
      return 'Planning tasks';
    case 'activate_skill': {
      const name = str(args['name']) ?? '';
      return name
        ? `Using skill: ${truncate(name, GEMINI_STATUS_DETAIL_MAX_LENGTH)}`
        : 'Activating a skill';
    }
    case 'ask_user':
      return 'Asking a question';
    case 'update_topic':
      return 'Updating context';
    case 'complete_task':
      return 'Completing task';
    case 'invoke_agent': {
      const description =
        str(args['task']) ?? str(args['description']) ?? str(args['prompt']) ?? '';
      return description
        ? `Subtask: ${truncate(description, GEMINI_STATUS_DETAIL_MAX_LENGTH)}`
        : 'Running subtask';
    }
    default:
      return truncate(toolName, GEMINI_STATUS_MAX_LENGTH);
  }
}

export const geminiModule: AgentModule = {
  kind: 'agent',
  id: 'gemini',
  displayName: 'Gemini CLI',
  protocolVersion: 1,

  formatToolStatus,
  permissionExemptTools: new Set<string>(),
  // invoke_agent runs its sub-agent in its own session file under chats/<parent>/, which this module
  // does not track (same reasoning as omp's `task`): nothing here can clear a sub-character it spawns.
  subagentToolNames: new Set<string>(),
  readingTools: new Set([
    'read_file',
    'read_many_files',
    'grep_search',
    'search_file_content',
    'glob',
    'list_directory',
    'web_fetch',
    'google_web_search',
    'get_internal_docs',
    'read_mcp_resource',
    'list_mcp_resources',
  ]),

  start: (host) =>
    new SessionStoreTracker(
      host,
      jsonlSessionStore({
        root: path.join(geminiRuntimeDir(), ...GEMINI_SESSIONS_ROOT_SEGMENTS),
        depth: GEMINI_SESSIONS_DEPTH,
        isTranscript: (name) =>
          name.startsWith(GEMINI_SESSION_FILE_PREFIX) && name.endsWith(GEMINI_SESSION_FILE_SUFFIX),
        format: geminiTranscriptFormat,
        cwdOf,
      }),
      DEFAULT_SESSION_STORE_TIMING,
    ),
};
