/**
 * OpenCode agent module. OpenCode has no hook API and no per-session transcript file: every session lives as a row
 * in one SQLite database the CLI keeps under its XDG data directory. Nothing is written outside `~/.pixel-agents/`,
 * so there is nothing to consent to.
 */

import * as os from 'node:os';
import * as path from 'node:path';

import type { AgentModule } from '../../../../core/src/provider.js';
import { DEFAULT_SESSION_STORE_TIMING } from '../sessionStore/constants.js';
import { SessionStoreTracker } from '../sessionStore/sessionStoreTracker.js';
import { sqliteSessionStore } from '../sessionStore/sqliteSessionStore.js';
import {
  OPENCODE_DATA_DIR_NAME,
  OPENCODE_DB_ENV_VAR,
  OPENCODE_DB_FILENAME,
  OPENCODE_XDG_DATA_HOME_ENV_VAR,
} from './constants.js';
import {
  OPENCODE_TOOL_VOCAB,
  opencodeFormatToolStatus,
  opencodeSqliteFormat,
} from './opencodeTranscript.js';

/** `~/.local/share` on every platform: OpenCode's data dir comes from the `xdg-basedir` package, which never
 *  special-cases macOS to `Application Support`. */
function opencodeDataDir(): string {
  const xdgDataHome = process.env[OPENCODE_XDG_DATA_HOME_ENV_VAR];
  return path.join(
    xdgDataHome || path.join(os.homedir(), '.local', 'share'),
    OPENCODE_DATA_DIR_NAME,
  );
}

function opencodeDatabasePath(): string {
  const override = process.env[OPENCODE_DB_ENV_VAR];
  if (!override) return path.join(opencodeDataDir(), OPENCODE_DB_FILENAME);
  return override === ':memory:' || path.isAbsolute(override)
    ? override
    : path.join(opencodeDataDir(), override);
}

export const opencodeModule: AgentModule = {
  kind: 'agent',
  id: 'opencode',
  displayName: 'OpenCode',
  protocolVersion: 1,

  formatToolStatus: opencodeFormatToolStatus,
  permissionExemptTools: new Set<string>(),
  // OpenCode's `task` tool runs sub-agents in their own session rows, not as progress inside this session.
  subagentToolNames: new Set<string>(),
  readingTools: OPENCODE_TOOL_VOCAB.reading,

  // OpenCode sessions run in whatever directory the user started them in.
  adoptsSessionsOutsideWorkspace: true,
  start: (host) =>
    new SessionStoreTracker(
      host,
      sqliteSessionStore(opencodeDatabasePath, opencodeSqliteFormat()),
      DEFAULT_SESSION_STORE_TIMING,
    ),
};
