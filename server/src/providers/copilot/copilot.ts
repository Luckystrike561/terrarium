/**
 * Copilot agent module. GitHub Copilot CLI has no hook API usable here: everything comes from its own
 * `events.jsonl` session transcripts, found by scanning its session store or handed over by a multiplexer that
 * hosts the session. Nothing is written outside `~/.pixel-agents/`, so there is nothing to consent to.
 */

import * as os from 'node:os';
import * as path from 'node:path';

import type { AgentModule } from '../../../../core/src/provider.js';
import { DEFAULT_SESSION_STORE_TIMING } from '../sessionStore/constants.js';
import { jsonlSessionStore } from '../sessionStore/jsonlSessionStore.js';
import { SessionStoreTracker } from '../sessionStore/sessionStoreTracker.js';
import {
  COPILOT_CONFIG_DIR_SEGMENT,
  COPILOT_EVENTS_FILE_NAME,
  COPILOT_HOME_ENV_VAR,
  COPILOT_SESSION_STATE_DIR_NAME,
  COPILOT_STATUS_DETAIL_MAX_LENGTH,
  COPILOT_STATUS_MAX_LENGTH,
} from './constants.js';
import { copilotTranscriptFormat } from './copilotTranscript.js';

type ToolInput = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\u2026` : s;
}

/** `COPILOT_HOME` replaces Copilot's whole configuration directory (not just `$HOME`), per GitHub's own CLI
 *  configuration directory reference. */
function copilotSessionStateDir(): string {
  const configDir =
    process.env[COPILOT_HOME_ENV_VAR] || path.join(os.homedir(), COPILOT_CONFIG_DIR_SEGMENT);
  return path.join(configDir, COPILOT_SESSION_STATE_DIR_NAME);
}

/** Status text for a Copilot tool call. */
export function formatToolStatus(toolName: string, input?: unknown): string {
  const args = (input ?? {}) as ToolInput;
  const file = path.basename(str(args['path']) ?? '');
  switch (toolName) {
    case 'view':
      return `Reading ${file}`.trim();
    case 'create':
      return `Writing ${file}`.trim();
    case 'edit':
      return `Editing ${file}`.trim();
    case 'bash':
    case 'powershell': {
      const command = str(args['command']) ?? '';
      return command
        ? `Running: ${truncate(command, COPILOT_STATUS_DETAIL_MAX_LENGTH)}`
        : 'Running a command';
    }
    case 'grep':
    case 'rg':
    case 'glob':
      return 'Searching code';
    case 'web_fetch':
      return 'Fetching web content';
    case 'web_search':
      return 'Searching the web';
    case 'task': {
      const description = str(args['description']) ?? str(args['prompt']) ?? '';
      return description
        ? `Subtask: ${truncate(description, COPILOT_STATUS_DETAIL_MAX_LENGTH)}`
        : 'Running subtask';
    }
    case 'update_todo':
      return 'Planning tasks';
    default:
      return truncate(toolName, COPILOT_STATUS_MAX_LENGTH);
  }
}

export const copilotModule: AgentModule = {
  kind: 'agent',
  id: 'copilot',
  displayName: 'GitHub Copilot CLI',
  protocolVersion: 1,

  formatToolStatus,
  permissionExemptTools: new Set<string>(),
  // subagent.started/completed link only to the spawning tool call (toolCallId), not to the sub-agent's own
  // tool-execution events: those carry only an envelope-level agentId with no documented field tying it back to
  // the spawning toolCallId, so live sub-agent tool activity cannot be attributed reliably from the transcript.
  subagentToolNames: new Set<string>(),
  readingTools: new Set(['view', 'grep', 'rg', 'glob', 'web_fetch', 'web_search']),

  // Copilot sessions run in whatever directory the user started them in.
  adoptsSessionsOutsideWorkspace: true,
  start: (host) =>
    new SessionStoreTracker(
      host,
      jsonlSessionStore({
        root: copilotSessionStateDir(),
        depth: 1,
        isTranscript: (name) => name === COPILOT_EVENTS_FILE_NAME,
        format: copilotTranscriptFormat,
        // herdr reports copilot's session identity as the CLI's own session id (kind `id`), which is also the
        // name of the directory each session's events.jsonl lives in.
        sessionIdOf: (file) => path.basename(path.dirname(file)),
      }),
      DEFAULT_SESSION_STORE_TIMING,
    ),
};
