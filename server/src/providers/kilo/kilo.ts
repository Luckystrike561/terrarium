/**
 * Kilo Code CLI agent module. Kilo vendors OpenCode's SQLite session store (confirmed: `session`, `message` and
 * `part` tables, same column and JSON shapes), so this module reuses the OpenCode SQLite format and tool status
 * formatter wholesale, resolving only its own database path and labeling the handful of Roo-lineage tool names
 * Kilo added on top of OpenCode's vocabulary. Nothing is written outside `~/.pixel-agents/`, so there is nothing
 * to consent to.
 */

import * as os from 'node:os';
import * as path from 'node:path';

import type { AgentModule } from '../../../../core/src/provider.js';
import type { OpencodeToolVocab } from '../opencode/opencodeTranscript.js';
import { opencodeFormatToolStatus, opencodeSqliteFormat } from '../opencode/opencodeTranscript.js';
import { DEFAULT_SESSION_STORE_TIMING } from '../sessionStore/constants.js';
import { str } from '../sessionStore/jsonlSessionStore.js';
import { SessionStoreTracker } from '../sessionStore/sessionStoreTracker.js';
import { sqliteSessionStore } from '../sessionStore/sqliteSessionStore.js';
import {
  KILO_DATA_DIR_NAME,
  KILO_DB_ENV_VAR,
  KILO_DB_FILENAME,
  XDG_DATA_HOME_ENV_VAR,
} from './constants.js';

/** Kilo's tool vocabulary for the shared OpenCode formatter: the three categories it customizes (reading/command/
 *  subagentSpawn). Tool names outside these three categories that Kilo doesn't share with OpenCode are labeled in
 *  `formatToolStatus` below, ahead of the shared switch. */
const KILO_TOOL_VOCAB: OpencodeToolVocab = {
  reading: new Set(['read', 'glob', 'grep', 'webfetch', 'websearch', 'notebook_read']),
  command: { bash: true, background_process: true },
  subagentSpawn: { task: true },
};

/** Status text for a Kilo tool call. Tools Kilo shares with OpenCode (read/write/edit/apply_patch/glob/grep/
 *  webfetch/websearch/todowrite/bash/task) go through the shared formatter. The Roo-lineage tools Kilo added on
 *  top are labeled here first. The file path field is `path` on current releases and `filePath` on older ones
 *  (verified against `@kilocode/cli` 7.7.3). */
export function formatToolStatus(toolName: string, input?: unknown): string {
  const args = (input ?? {}) as Record<string, unknown>;
  const file = path.basename(str(args['path']) ?? str(args['filePath']) ?? '');
  switch (toolName) {
    case 'write_file':
      return `Writing ${file}`.trim();
    case 'search_and_replace':
    case 'fast_edit_file':
    case 'notebook_edit':
      return `Editing ${file}`.trim();
    case 'delete_file':
      return `Deleting ${file}`.trim();
    case 'question':
      return 'Asking a question';
    case 'generate_image':
      return 'Generating an image';
    default:
      return opencodeFormatToolStatus(toolName, input, KILO_TOOL_VOCAB);
  }
}

function kiloDataDir(): string {
  const xdgDataHome = process.env[XDG_DATA_HOME_ENV_VAR];
  return path.join(xdgDataHome || path.join(os.homedir(), '.local', 'share'), KILO_DATA_DIR_NAME);
}

/** Kilo's session database: `KILO_DB` wins when set (an absolute path used as-is, a relative path resolved under
 *  the data directory, or the literal `:memory:`), otherwise `kilo.db` inside the data directory. */
function kiloDbPath(): string {
  const override = process.env[KILO_DB_ENV_VAR];
  if (!override) return path.join(kiloDataDir(), KILO_DB_FILENAME);
  return override === ':memory:' || path.isAbsolute(override)
    ? override
    : path.join(kiloDataDir(), override);
}

export const kiloModule: AgentModule = {
  kind: 'agent',
  id: 'kilo',
  displayName: 'Kilo Code',
  protocolVersion: 1,

  formatToolStatus,
  permissionExemptTools: new Set<string>(),
  // Kilo's task tool spawns its subagent as a child session (session.parent_id): discovered on its own rather
  // than reported as an inline sub-tool of the parent's session.
  subagentToolNames: new Set<string>(),
  readingTools: KILO_TOOL_VOCAB.reading,

  // Kilo sessions run in whatever directory the user started them in.
  adoptsSessionsOutsideWorkspace: true,
  start: (host) =>
    new SessionStoreTracker(
      host,
      sqliteSessionStore(kiloDbPath, opencodeSqliteFormat()),
      DEFAULT_SESSION_STORE_TIMING,
    ),
};
