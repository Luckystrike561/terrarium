/**
 * mastracode agent module. No hook API is installed; the session store is a LibSQL/SQLite database
 * (`mastra_threads` / `mastra_messages`) the CLI writes to directly, found by scanning the store or handed over
 * by a multiplexer that hosts the session (herdr's `agent_session.value` for mastracode is the thread id, the
 * store's own key). Nothing is written outside `~/.pixel-agents/`, so there is nothing to consent to.
 */

import * as os from 'node:os';
import * as path from 'node:path';

import type { AgentModule } from '../../../../core/src/provider.js';
import { DEFAULT_SESSION_STORE_TIMING } from '../sessionStore/constants.js';
import { SessionStoreTracker } from '../sessionStore/sessionStoreTracker.js';
import { sqliteSessionStore } from '../sessionStore/sqliteSessionStore.js';
import {
  MASTRACODE_APP_DATA_DIR_ENV,
  MASTRACODE_APP_NAME,
  MASTRACODE_APPDATA_ENV,
  MASTRACODE_DB_FILE_NAME,
  MASTRACODE_DB_PATH_ENV,
  MASTRACODE_STATUS_DETAIL_MAX_LENGTH,
  MASTRACODE_STATUS_MAX_LENGTH,
  MASTRACODE_XDG_DATA_HOME_ENV,
} from './constants.js';
import { mastracodeSqliteFormat } from './mastracodeStore.js';

type ToolInput = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\u2026` : s;
}

/** mastracode's own app-data directory: XDG_DATA_HOME (or ~/.local/share) on Linux, Application Support on
 *  macOS, %APPDATA% on Windows (the project module's getAppDataDir()). */
function defaultAppDataDir(): string {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', MASTRACODE_APP_NAME);
  }
  if (process.platform === 'win32') {
    const appData = process.env[MASTRACODE_APPDATA_ENV];
    return path.join(appData || path.join(os.homedir(), 'AppData', 'Roaming'), MASTRACODE_APP_NAME);
  }
  const dataHome =
    process.env[MASTRACODE_XDG_DATA_HOME_ENV] || path.join(os.homedir(), '.local', 'share');
  return path.join(dataHome, MASTRACODE_APP_NAME);
}

/** The session database's path: MASTRA_DB_PATH names it directly, MASTRA_APP_DATA_DIR relocates the whole
 *  app-data directory it lives in, otherwise the platform default (the project module's getStorageConfig()). A
 *  remote MASTRA_DB_URL or MASTRA_STORAGE_BACKEND=pg means there is no local file at all; the store then finds
 *  nothing, the same as a CLI that has never run. */
function databaseFile(): string {
  const direct = process.env[MASTRACODE_DB_PATH_ENV];
  if (direct) return direct;
  const appDataDir = process.env[MASTRACODE_APP_DATA_DIR_ENV] || defaultAppDataDir();
  return path.join(appDataDir, MASTRACODE_DB_FILE_NAME);
}

/** Status text for a mastracode tool call (tool names and docs/tools field names from the mastracode SDK). */
export function formatToolStatus(toolName: string, input?: unknown): string {
  const args = (input ?? {}) as ToolInput;
  const file = path.basename(str(args['path']) ?? '');
  switch (toolName) {
    case 'view':
    case 'file_stat':
      return `Reading ${file}`.trim();
    case 'write_file':
      return `Writing ${file}`.trim();
    case 'string_replace_lsp':
    case 'ast_smart_edit':
      return `Editing ${file}`.trim();
    case 'delete_file':
      return `Deleting ${file}`.trim();
    case 'mkdir':
      return `Creating ${file}`.trim();
    case 'execute_command': {
      const command = str(args['command']) ?? '';
      return command
        ? `Running: ${truncate(command, MASTRACODE_STATUS_DETAIL_MAX_LENGTH)}`
        : 'Running a command';
    }
    case 'kill_process':
      return 'Stopping a process';
    case 'get_process_output':
      return 'Reading process output';
    case 'search_content':
    case 'find_files':
    case 'lsp_inspect':
      return 'Searching code';
    case 'web_search': {
      const query = str(args['query']) ?? '';
      return query
        ? `Searching the web: ${truncate(query, MASTRACODE_STATUS_DETAIL_MAX_LENGTH)}`
        : 'Searching the web';
    }
    case 'web_extract':
      return 'Fetching web content';
    case 'subagent': {
      const task = str(args['task']) ?? str(args['description']) ?? '';
      return task
        ? `Subtask: ${truncate(task, MASTRACODE_STATUS_DETAIL_MAX_LENGTH)}`
        : 'Running subtask';
    }
    default:
      return truncate(toolName, MASTRACODE_STATUS_MAX_LENGTH);
  }
}

export const mastracodeModule: AgentModule = {
  kind: 'agent',
  id: 'mastracode',
  displayName: 'MastraCode',
  protocolVersion: 1,

  formatToolStatus,
  permissionExemptTools: new Set<string>(),
  // mastracode's `subagent` tool spawns its sub-agents in their own threads: nothing here reports their activity.
  subagentToolNames: new Set<string>(),
  readingTools: new Set([
    'view',
    'search_content',
    'find_files',
    'file_stat',
    'lsp_inspect',
    'get_process_output',
    'web_search',
    'web_extract',
  ]),

  start: (host) =>
    new SessionStoreTracker(
      host,
      sqliteSessionStore(databaseFile, mastracodeSqliteFormat),
      DEFAULT_SESSION_STORE_TIMING,
    ),
};
