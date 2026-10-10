/**
 * Qoder CLI agent module. Transcript-only: Qoder has a documented hook API (Claude-shaped `hooks` in
 * `settings.json`), but it is not installed here, so permission waits and clean exits are never seen. Only
 * herdr's screen-manifest state supplies those inside a multiplexer pane.
 */

import * as os from 'node:os';
import * as path from 'node:path';

import type { AgentModule } from '../../../../core/src/provider.js';
import { DEFAULT_SESSION_STORE_TIMING } from '../sessionStore/constants.js';
import { jsonlSessionStore } from '../sessionStore/jsonlSessionStore.js';
import { SessionStoreTracker } from '../sessionStore/sessionStoreTracker.js';
import {
  QODER_CONFIG_DIR_ENV,
  QODER_DEFAULT_CONFIG_DIR_SEGMENTS,
  QODER_PROJECTS_DIR_SEGMENT,
  QODER_SESSION_FILE_SUFFIX,
  QODER_STATUS_DETAIL_MAX_LENGTH,
  QODER_STATUS_MAX_LENGTH,
} from './constants.js';
import { qodercliTranscriptFormat } from './qodercliTranscript.js';

type ToolInput = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\u2026` : s;
}

/** Qoder's transcript tool names are Claude-compatible: the model sees and the file records `Read`, `Bash`,
 *  `Edit`, `Write`, etc. */
export function formatToolStatus(toolName: string, input?: unknown): string {
  const args = (input ?? {}) as ToolInput;
  const file = path.basename(str(args['file_path']) ?? str(args['notebook_path']) ?? '');
  switch (toolName) {
    case 'Read':
      return `Reading ${file}`.trim();
    case 'Write':
      return `Writing ${file}`.trim();
    case 'Edit':
    case 'NotebookEdit':
      return `Editing ${file}`.trim();
    case 'Bash':
    case 'PowerShell': {
      const command = str(args['command']);
      const description = str(args['description']);
      if (description) return truncate(description, QODER_STATUS_DETAIL_MAX_LENGTH);
      return command
        ? `Running: ${truncate(command, QODER_STATUS_DETAIL_MAX_LENGTH)}`
        : 'Running a command';
    }
    case 'Grep':
    case 'Glob':
      return 'Searching code';
    case 'WebFetch':
      return 'Fetching web content';
    case 'WebSearch':
      return 'Searching the web';
    case 'Agent':
    case 'Task': {
      const description = str(args['description']);
      return description
        ? `Subtask: ${truncate(description, QODER_STATUS_DETAIL_MAX_LENGTH)}`
        : 'Running subtask';
    }
    case 'TodoWrite':
      return 'Planning tasks';
    default:
      return truncate(toolName, QODER_STATUS_MAX_LENGTH);
  }
}

function configDir(): string {
  return (
    process.env[QODER_CONFIG_DIR_ENV] ||
    path.join(os.homedir(), ...QODER_DEFAULT_CONFIG_DIR_SEGMENTS)
  );
}

export const qodercliModule: AgentModule = {
  kind: 'agent',
  id: 'qodercli',
  displayName: 'Qoder CLI',
  protocolVersion: 1,

  formatToolStatus,
  permissionExemptTools: new Set<string>(),
  // Qoder's sub-agent transcripts are separate files under `<session-id>/subagents/`, excluded from this store by
  // its depth of 1; nothing here needs to clear a sub-character it would spawn.
  subagentToolNames: new Set<string>(),
  readingTools: new Set(['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch']),

  start: (host) =>
    new SessionStoreTracker(
      host,
      jsonlSessionStore({
        root: path.join(configDir(), QODER_PROJECTS_DIR_SEGMENT),
        depth: 1,
        isTranscript: (name) => name.endsWith(QODER_SESSION_FILE_SUFFIX),
        // The filename stem is the CLI's own session UUID, the same id herdr's qodercli integration reports as
        // `agent_session.value` (kind `id`): keying by it is what lets `followSession(uuid)` join the same
        // character herdr's pane names.
        sessionIdOf: (file) => path.basename(file, QODER_SESSION_FILE_SUFFIX),
        format: qodercliTranscriptFormat,
      }),
      DEFAULT_SESSION_STORE_TIMING,
    ),
};
