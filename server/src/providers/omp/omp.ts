/**
 * omp agent module. omp has no hook API: everything comes from its session transcripts, found by scanning its
 * session store or handed over by a multiplexer that hosts the session. Nothing is written outside
 * `~/.pixel-agents/`, so there is nothing to consent to.
 */

import * as os from 'node:os';
import * as path from 'node:path';

import type { AgentModule } from '../../../../core/src/provider.js';
import { DEFAULT_SESSION_STORE_TIMING } from '../sessionStore/constants.js';
import { jsonlSessionStore } from '../sessionStore/jsonlSessionStore.js';
import { SessionStoreTracker } from '../sessionStore/sessionStoreTracker.js';
import {
  OMP_SESSION_FILE_SUFFIX,
  OMP_SESSIONS_DIR_SEGMENTS,
  OMP_STATUS_DETAIL_MAX_LENGTH,
  OMP_STATUS_MAX_LENGTH,
} from './constants.js';
import { ompTranscriptFormat } from './ompTranscript.js';

type ToolInput = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\u2026` : s;
}

/** Status text for an omp tool call. The agent's own intent line wins: omp asks the model for one on every call. */
export function formatToolStatus(toolName: string, input?: unknown): string {
  const args = (input ?? {}) as ToolInput;
  const intent = str(args['intent']);
  if (intent) return truncate(intent, OMP_STATUS_MAX_LENGTH);

  const file = path.basename(str(args['path']) ?? '');
  switch (toolName) {
    case 'read':
      return `Reading ${file}`.trim();
    case 'write':
      return `Writing ${file}`.trim();
    case 'edit':
    case 'ast_edit':
      return `Editing ${file}`.trim();
    case 'bash':
    case 'eval': {
      const command = str(args['command']) ?? '';
      return command
        ? `Running: ${truncate(command, OMP_STATUS_DETAIL_MAX_LENGTH)}`
        : 'Running a command';
    }
    case 'grep':
    case 'glob':
    case 'lsp':
      return 'Searching code';
    case 'fetch':
      return 'Fetching web content';
    case 'web_search':
      return 'Searching the web';
    case 'task': {
      const description = str(args['description']) ?? '';
      return description
        ? `Subtask: ${truncate(description, OMP_STATUS_DETAIL_MAX_LENGTH)}`
        : 'Running subtask';
    }
    case 'todo':
      return 'Planning tasks';
    default:
      return truncate(toolName, OMP_STATUS_MAX_LENGTH);
  }
}

export const ompModule: AgentModule = {
  kind: 'agent',
  id: 'omp',
  displayName: 'omp',
  protocolVersion: 1,

  formatToolStatus,
  permissionExemptTools: new Set<string>(),
  // omp's `task` runs its sub-agents in their own sessions. Nothing here can clear a sub-character it would spawn.
  subagentToolNames: new Set<string>(),
  readingTools: new Set(['read', 'grep', 'glob', 'lsp', 'fetch', 'web_search']),

  start: (host) =>
    new SessionStoreTracker(
      host,
      jsonlSessionStore({
        root: path.join(os.homedir(), ...OMP_SESSIONS_DIR_SEGMENTS),
        depth: 1,
        isTranscript: (name) => name.endsWith(OMP_SESSION_FILE_SUFFIX),
        format: ompTranscriptFormat,
      }),
      DEFAULT_SESSION_STORE_TIMING,
    ),
};
