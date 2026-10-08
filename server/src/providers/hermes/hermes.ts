/**
 * Hermes Agent module. Hermes keeps every session in one SQLite database (`~/.hermes/state.db`, `HERMES_HOME`
 * overridable), not JSONL transcripts, so its sessions are found by polling that database directly or handed
 * over by a multiplexer that hosts the session. Nothing is written outside `~/.pixel-agents/`, so there is
 * nothing to consent to.
 */

import * as os from 'node:os';
import * as path from 'node:path';

import type { AgentModule } from '../../../../core/src/provider.js';
import { DEFAULT_SESSION_STORE_TIMING } from '../sessionStore/constants.js';
import { SessionStoreTracker } from '../sessionStore/sessionStoreTracker.js';
import { sqliteSessionStore } from '../sessionStore/sqliteSessionStore.js';
import {
  HERMES_HOME_DIR_UNIX,
  HERMES_HOME_DIR_WINDOWS,
  HERMES_HOME_ENV_VAR,
  HERMES_STATE_DB_FILENAME,
  HERMES_STATUS_DETAIL_MAX_LENGTH,
  HERMES_STATUS_MAX_LENGTH,
} from './constants.js';
import { hermesSqliteFormat } from './hermesTranscript.js';

type ToolInput = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\u2026` : s;
}

/** Hermes' home directory: `$HERMES_HOME` overrides the whole thing, else `~/.hermes`
 *  (`%LOCALAPPDATA%/hermes` on Windows). */
function hermesHome(): string {
  const override = process.env[HERMES_HOME_ENV_VAR];
  if (override) return override;
  if (process.platform === 'win32') {
    return path.join(process.env['LOCALAPPDATA'] ?? os.homedir(), HERMES_HOME_DIR_WINDOWS);
  }
  return path.join(os.homedir(), HERMES_HOME_DIR_UNIX);
}

export function formatToolStatus(toolName: string, input?: unknown): string {
  const args = (input ?? {}) as ToolInput;
  const file = path.basename(str(args['path']) ?? '');
  switch (toolName) {
    case 'read_file':
      return `Reading ${file}`.trim();
    case 'write_file':
      return `Writing ${file}`.trim();
    case 'patch':
      return `Editing ${file}`.trim();
    case 'terminal': {
      const command = str(args['command']) ?? '';
      return command
        ? `Running: ${truncate(command, HERMES_STATUS_DETAIL_MAX_LENGTH)}`
        : 'Running a command';
    }
    case 'search_files':
      return 'Searching code';
    case 'web_search':
      return 'Searching the web';
    case 'web_extract':
      return 'Fetching web content';
    case 'delegate_task': {
      const goal = str(args['goal']) ?? '';
      return goal
        ? `Subtask: ${truncate(goal, HERMES_STATUS_DETAIL_MAX_LENGTH)}`
        : 'Running subtask';
    }
    default:
      return truncate(toolName, HERMES_STATUS_MAX_LENGTH);
  }
}

export const hermesModule: AgentModule = {
  kind: 'agent',
  id: 'hermes',
  displayName: 'Hermes Agent',
  protocolVersion: 1,

  formatToolStatus,
  permissionExemptTools: new Set<string>(),
  // delegate_task's children run as their own sessions, not in-transcript sub-agent records: nothing here
  // can clear a sub-character it would spawn.
  subagentToolNames: new Set<string>(),
  readingTools: new Set(['read_file', 'search_files', 'web_search', 'web_extract']),

  // Hermes sessions run in whatever directory the user started them in.
  adoptsSessionsOutsideWorkspace: true,
  start: (host) =>
    new SessionStoreTracker(
      host,
      sqliteSessionStore(
        () => path.join(hermesHome(), HERMES_STATE_DB_FILENAME),
        hermesSqliteFormat,
      ),
      DEFAULT_SESSION_STORE_TIMING,
    ),
};
