/**
 * Cline agent module. Cline has no hook API reachable here: everything comes from its own session store, found by
 * scanning `~/.cline/data/sessions` (or its env overrides) or handed over by a multiplexer that hosts the session.
 * herdr reports Cline panes by status only, with no session identity, so a pane joins the module's own discovered
 * session by matching cwd (`sessionInDirectory`) rather than by a shared `sessionRef`. Nothing is written outside
 * `~/.pixel-agents/`, so there is nothing to consent to.
 */

import * as os from 'node:os';
import * as path from 'node:path';

import type { AgentModule } from '../../../../core/src/provider.js';
import { DEFAULT_SESSION_STORE_TIMING } from '../sessionStore/constants.js';
import { SessionStoreTracker } from '../sessionStore/sessionStoreTracker.js';
import { clineSessionStore } from './clineSessions.js';
import {
  CLINE_DATA_DIR_ENV,
  CLINE_DATA_SEGMENT,
  CLINE_DIR_ENV,
  CLINE_HOME_SEGMENT,
  CLINE_SESSION_DATA_DIR_ENV,
  CLINE_SESSIONS_SEGMENT,
  CLINE_STATUS_DETAIL_MAX_LENGTH,
  CLINE_STATUS_MAX_LENGTH,
} from './constants.js';

type ToolInput = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\u2026` : s;
}

/** First file path a `read_files`-family call names, across the SDK and legacy XML argument shapes. */
function firstReadPath(args: ToolInput): string | undefined {
  const direct = str(args['file_path']) ?? str(args['filePath']) ?? str(args['path']);
  if (direct) return direct;
  const files = args['files'];
  if (Array.isArray(files) && files.length > 0) {
    const first: unknown = files[0];
    if (typeof first === 'string') return first;
    if (first && typeof first === 'object') return str((first as ToolInput)['path']);
  }
  const paths = args['paths'];
  return Array.isArray(paths) && typeof paths[0] === 'string' ? paths[0] : undefined;
}

/** First command a `run_commands`-family call names, across the SDK (`commands: (string|{command})[]`) and legacy
 *  XML (`command: string`) argument shapes. */
function firstCommand(args: ToolInput): string | undefined {
  const commands = args['commands'];
  if (Array.isArray(commands) && commands.length > 0) {
    const first: unknown = commands[0];
    if (typeof first === 'string') return first;
    if (first && typeof first === 'object') return str((first as ToolInput)['command']);
  }
  return str(args['command']);
}

/** Status text for a Cline tool call. Covers both the current SDK tool names and the older XML-format names the
 *  same CLI generations may still emit. */
export function formatToolStatus(toolName: string, input?: unknown): string {
  const args = (input ?? {}) as ToolInput;
  switch (toolName) {
    case 'read_files':
    case 'read_file': {
      const file = path.basename(firstReadPath(args) ?? '');
      return file ? `Reading ${file}` : 'Reading files';
    }
    case 'editor':
    case 'write_to_file':
    case 'replace_in_file': {
      const file = path.basename(str(args['path']) ?? '');
      return file ? `Editing ${file}` : 'Editing a file';
    }
    case 'apply_patch':
      return 'Editing files';
    case 'run_commands':
    case 'execute_command': {
      const command = firstCommand(args);
      return command
        ? `Running: ${truncate(command, CLINE_STATUS_DETAIL_MAX_LENGTH)}`
        : 'Running a command';
    }
    case 'search_codebase':
      return 'Searching code';
    case 'fetch_web_content':
      return 'Fetching web content';
    case 'web_search':
      return 'Searching the web';
    case 'skills': {
      const skill = str(args['skill']);
      return skill
        ? `Running skill: ${truncate(skill, CLINE_STATUS_DETAIL_MAX_LENGTH)}`
        : 'Running a skill';
    }
    case 'ask_question': {
      const question = str(args['question']);
      return question ? truncate(question, CLINE_STATUS_MAX_LENGTH) : 'Asking a question';
    }
    case 'submit_and_exit':
      return 'Wrapping up';
    case 'spawn_agent': {
      const task = str(args['task']);
      return task
        ? `Subtask: ${truncate(task, CLINE_STATUS_DETAIL_MAX_LENGTH)}`
        : 'Running subtask';
    }
    default:
      return toolName.startsWith('team_')
        ? 'Coordinating with team'
        : truncate(toolName, CLINE_STATUS_MAX_LENGTH);
  }
}

/** Cline's session data directory, honoring its documented override chain: `CLINE_SESSION_DATA_DIR` names the
 *  sessions directory directly; `CLINE_DATA_DIR` and `CLINE_DIR` name its ancestors. */
function sessionsRoot(): string {
  const sessionDataDir = process.env[CLINE_SESSION_DATA_DIR_ENV];
  if (sessionDataDir) return sessionDataDir;
  const dataDir = process.env[CLINE_DATA_DIR_ENV];
  if (dataDir) return path.join(dataDir, CLINE_SESSIONS_SEGMENT);
  const clineDir = process.env[CLINE_DIR_ENV];
  if (clineDir) return path.join(clineDir, CLINE_DATA_SEGMENT, CLINE_SESSIONS_SEGMENT);
  return path.join(os.homedir(), CLINE_HOME_SEGMENT, CLINE_DATA_SEGMENT, CLINE_SESSIONS_SEGMENT);
}

export const clineModule: AgentModule = {
  kind: 'agent',
  id: 'cline',
  displayName: 'Cline',
  protocolVersion: 1,

  formatToolStatus,
  permissionExemptTools: new Set<string>(),
  // spawn_agent/team_* results are not reported back into the lead's own transcript, so there is nothing here to
  // spawn a sub-character from.
  subagentToolNames: new Set<string>(),
  readingTools: new Set([
    'read_files',
    'read_file',
    'search_codebase',
    'fetch_web_content',
    'web_search',
    'skills',
  ]),

  start: (host) =>
    new SessionStoreTracker(host, clineSessionStore(sessionsRoot()), DEFAULT_SESSION_STORE_TIMING),
};
