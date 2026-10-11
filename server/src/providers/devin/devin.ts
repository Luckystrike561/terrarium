/**
 * Devin CLI agent module. Devin has no hook API wired into the shipped CLI: everything comes from its central
 * SQLite session store, found by scanning it or handed over by a multiplexer that hosts the session. Nothing is
 * written outside `~/.pixel-agents/`, so there is nothing to consent to.
 */

import * as os from 'node:os';
import * as path from 'node:path';

import type { AgentModule } from '../../../../core/src/provider.js';
import { DEFAULT_SESSION_STORE_TIMING } from '../sessionStore/constants.js';
import { SessionStoreTracker } from '../sessionStore/sessionStoreTracker.js';
import { sqliteSessionStore } from '../sessionStore/sqliteSessionStore.js';
import {
  DEVIN_APPDATA_FALLBACK_SEGMENTS,
  DEVIN_DB_PATH_SEGMENTS,
  DEVIN_PRODUCT_DIR,
  DEVIN_STATUS_DETAIL_MAX_LENGTH,
  DEVIN_STATUS_MAX_LENGTH,
  DEVIN_XDG_DATA_FALLBACK_SEGMENTS,
} from './constants.js';
import { devinSqliteFormat } from './devinTranscript.js';

type ToolInput = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\u2026` : s;
}

/** The file argument a Devin file tool was given, under whichever of its documented key names it used. */
function fileArgOf(args: ToolInput): string {
  return str(args['file_path']) ?? str(args['target_file']) ?? str(args['path']) ?? '';
}

/** Status text for a Devin tool call, from its built-in tool vocabulary (write, str_replace, exec, read, grep,
 *  ls, glob, fetch, web_search). Tools with no evidenced status fall back to their raw name. */
export function formatToolStatus(toolName: string, input?: unknown): string {
  const args = (input ?? {}) as ToolInput;
  switch (toolName) {
    case 'read': {
      const file = path.basename(fileArgOf(args));
      return file ? `Reading ${file}` : 'Reading a file';
    }
    case 'write': {
      const file = path.basename(fileArgOf(args));
      return file ? `Writing ${file}` : 'Writing a file';
    }
    case 'str_replace': {
      const file = path.basename(fileArgOf(args));
      return file ? `Editing ${file}` : 'Editing a file';
    }
    case 'exec': {
      const command = str(args['command']) ?? '';
      return command
        ? `Running: ${truncate(command, DEVIN_STATUS_DETAIL_MAX_LENGTH)}`
        : 'Running a command';
    }
    case 'grep':
    case 'ls':
    case 'glob':
      return 'Searching code';
    case 'fetch':
      return 'Fetching web content';
    case 'web_search':
      return 'Searching the web';
    default:
      return truncate(toolName, DEVIN_STATUS_MAX_LENGTH);
  }
}

/** Devin's data root (`~/.local/share/devin`, `%APPDATA%\devin`): `$XDG_DATA_HOME`/`%APPDATA%` respected, home
 *  directory the documented default. */
function devinDataRoot(): string {
  if (process.platform === 'win32') {
    const appData =
      process.env['APPDATA'] || path.join(os.homedir(), ...DEVIN_APPDATA_FALLBACK_SEGMENTS);
    return path.join(appData, DEVIN_PRODUCT_DIR);
  }
  const xdgDataHome =
    process.env['XDG_DATA_HOME'] || path.join(os.homedir(), ...DEVIN_XDG_DATA_FALLBACK_SEGMENTS);
  return path.join(xdgDataHome, DEVIN_PRODUCT_DIR);
}

function devinSessionsDbPath(): string {
  return path.join(devinDataRoot(), ...DEVIN_DB_PATH_SEGMENTS);
}

export const devinModule: AgentModule = {
  kind: 'agent',
  id: 'devin',
  displayName: 'Devin',
  protocolVersion: 1,

  formatToolStatus,
  permissionExemptTools: new Set<string>(),
  // run_subagent's result lands as a plain tool call in the same session; its own inner tool calls are not
  // separately represented in the store, so there is no sub-character activity to report.
  subagentToolNames: new Set<string>(),
  readingTools: new Set(['read', 'grep', 'ls', 'glob', 'fetch', 'web_search']),

  start: (host) =>
    new SessionStoreTracker(
      host,
      sqliteSessionStore(devinSessionsDbPath, devinSqliteFormat),
      DEFAULT_SESSION_STORE_TIMING,
    ),
};
