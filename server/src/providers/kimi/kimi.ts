/**
 * Kimi Code agent module. Kimi has no hook API: everything comes from its session store, found by scanning it or
 * handed over by a multiplexer that hosts the session. Nothing is written outside `~/.pixel-agents/`, so there is
 * nothing to consent to.
 *
 * Two gaps the store cannot fill: a pending approval and a clean session exit are both reported only by a hook
 * Kimi's own herdr integration installs, not by `wire.jsonl`. A herdr-hosted pane still gets the approval signal,
 * from herdr's own `blocked` status. A standalone session has neither, and a crashed one lingers only until the
 * session store's active-window timeout drops it.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { AgentModule } from '../../../../core/src/provider.js';
import { DEFAULT_SESSION_STORE_TIMING } from '../sessionStore/constants.js';
import {
  jsonlSessionStore,
  parseJsonRecord,
  str as strField,
} from '../sessionStore/jsonlSessionStore.js';
import { SessionStoreTracker } from '../sessionStore/sessionStoreTracker.js';
import {
  KIMI_CODE_HOME_ENV,
  KIMI_DEFAULT_HOME_DIR_NAME,
  KIMI_MAIN_AGENT_DIR_NAME,
  KIMI_SESSIONS_DEPTH,
  KIMI_SESSIONS_DIR_NAME,
  KIMI_STATE_FILE_NAME,
  KIMI_STATUS_DETAIL_MAX_LENGTH,
  KIMI_STATUS_MAX_LENGTH,
  KIMI_WIRE_FILE_NAME,
} from './constants.js';
import { kimiWireFormat } from './kimiTranscript.js';

type ToolInput = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\u2026` : s;
}

/** Working directory from a session's sibling `state.json`, the only place Kimi records it. */
function cwdOf(file: string): string {
  const sessionDir = path.dirname(path.dirname(path.dirname(file)));
  try {
    const raw = fs.readFileSync(path.join(sessionDir, KIMI_STATE_FILE_NAME), 'utf8');
    const state = parseJsonRecord(raw);
    return (state && strField(state['cwd'])) || '';
  } catch {
    return ''; // state.json not written yet, or unreadable
  }
}

/** Status text for a Kimi Code tool call, from its PascalCase built-in tool names. */
export function formatToolStatus(toolName: string, input?: unknown): string {
  const args = (input ?? {}) as ToolInput;
  const file = path.basename(str(args['path']) ?? '');
  switch (toolName) {
    case 'Read':
    case 'ReadMediaFile':
      return `Reading ${file}`.trim();
    case 'Write':
      return `Writing ${file}`.trim();
    case 'Edit':
      return `Editing ${file}`.trim();
    case 'Bash': {
      const command = str(args['command']) ?? '';
      return command
        ? `Running: ${truncate(command, KIMI_STATUS_DETAIL_MAX_LENGTH)}`
        : 'Running a command';
    }
    case 'Grep':
    case 'Glob':
      return 'Searching code';
    case 'WebSearch':
      return 'Searching the web';
    case 'FetchURL':
      return 'Fetching web content';
    case 'Agent':
    case 'AgentSwarm': {
      const description = str(args['description']) ?? '';
      return description
        ? `Subtask: ${truncate(description, KIMI_STATUS_DETAIL_MAX_LENGTH)}`
        : 'Running subtask';
    }
    case 'TodoList':
      return 'Planning tasks';
    case 'AskUserQuestion':
      return 'Asking a question';
    case 'NotifyUser':
      return 'Sending a notification';
    default:
      return truncate(toolName, KIMI_STATUS_MAX_LENGTH);
  }
}

export const kimiModule: AgentModule = {
  kind: 'agent',
  id: 'kimi',
  displayName: 'Kimi Code',
  protocolVersion: 1,

  formatToolStatus,
  // Auto-allowed by default: every read-only tool, plus the interaction/scheduling tools that never touch the
  // workspace. Everything else (Write, Edit, Bash, TaskStop, CronCreate, CronDelete, manual-mode AgentSwarm)
  // requires approval and should still start the heuristic permission timer.
  permissionExemptTools: new Set([
    'Read',
    'Grep',
    'Glob',
    'ReadMediaFile',
    'WebSearch',
    'FetchURL',
    'EnterPlanMode',
    'ExitPlanMode',
    'TodoList',
    'Agent',
    'AgentSwarm',
    'AskUserQuestion',
    'NotifyUser',
    'Skill',
    'TaskList',
    'TaskOutput',
    'WaitFor',
    'CronList',
  ]),
  // Agent/AgentSwarm spawns are ordinary tool calls on the main thread (their own wire.jsonl is skipped), so
  // nothing here promotes them to a separate sub-agent character.
  subagentToolNames: new Set<string>(),
  readingTools: new Set([
    'Read',
    'Grep',
    'Glob',
    'ReadMediaFile',
    'WebSearch',
    'FetchURL',
    'TaskOutput',
  ]),

  // Kimi Code sessions run in whatever directory the user started them in.
  adoptsSessionsOutsideWorkspace: true,
  start: (host) => {
    const home =
      process.env[KIMI_CODE_HOME_ENV] || path.join(os.homedir(), KIMI_DEFAULT_HOME_DIR_NAME);
    return new SessionStoreTracker(
      host,
      jsonlSessionStore({
        root: path.join(home, KIMI_SESSIONS_DIR_NAME),
        depth: KIMI_SESSIONS_DEPTH,
        isTranscript: (name, filePath) =>
          name === KIMI_WIRE_FILE_NAME &&
          path.basename(path.dirname(filePath)) === KIMI_MAIN_AGENT_DIR_NAME,
        format: kimiWireFormat,
        sessionIdOf: (file) => path.basename(path.dirname(path.dirname(path.dirname(file)))),
        cwdOf,
      }),
      DEFAULT_SESSION_STORE_TIMING,
    );
  },
};
