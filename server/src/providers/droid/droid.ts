/**
 * Droid (Factory's `droid` CLI) agent module. Droid has no hook API: everything comes from its session
 * transcripts, found by scanning its session store or handed over by a multiplexer that hosts the session.
 * herdr reports a droid session by Droid's own session id, never a transcript path, so sessions here are keyed
 * by that id (the transcript's file name without its `.jsonl` suffix). Nothing is written outside
 * `~/.pixel-agents/`, so there is nothing to consent to.
 */

import * as os from 'node:os';
import * as path from 'node:path';

import type { AgentModule } from '../../../../core/src/provider.js';
import { DEFAULT_SESSION_STORE_TIMING } from '../sessionStore/constants.js';
import { jsonlSessionStore } from '../sessionStore/jsonlSessionStore.js';
import { SessionStoreTracker } from '../sessionStore/sessionStoreTracker.js';
import {
  DROID_HOME_OVERRIDE_ENV,
  DROID_SESSION_FILE_SUFFIX,
  DROID_SESSIONS_DIR_SEGMENTS,
  DROID_STATUS_DETAIL_MAX_LENGTH,
  DROID_STATUS_MAX_LENGTH,
} from './constants.js';
import { droidTranscriptFormat } from './droidTranscript.js';

type ToolInput = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\u2026` : s;
}

export function formatToolStatus(toolName: string, input?: unknown): string {
  const args = (input ?? {}) as ToolInput;
  switch (toolName) {
    case 'Read':
      return `Reading ${path.basename(str(args['file_path']) ?? '')}`.trim();
    case 'Create':
    case 'Write':
      return `Writing ${path.basename(str(args['file_path']) ?? '')}`.trim();
    case 'Edit':
    case 'ApplyPatch':
    case 'NotebookEdit':
      return `Editing ${path.basename(str(args['file_path']) ?? '')}`.trim();
    case 'Execute':
    case 'Bash': {
      const command = str(args['command']) ?? '';
      return command
        ? `Running: ${truncate(command, DROID_STATUS_DETAIL_MAX_LENGTH)}`
        : 'Running a command';
    }
    case 'LS': {
      const dir = path.basename(str(args['directory_path']) ?? '');
      return dir ? `Listing ${dir}` : 'Listing files';
    }
    case 'Grep':
    case 'Glob':
      return 'Searching code';
    case 'FetchUrl':
    case 'WebFetch':
      return 'Fetching web content';
    case 'WebSearch':
      return 'Searching the web';
    case 'Task': {
      const description = str(args['description']) ?? '';
      return description
        ? `Subtask: ${truncate(description, DROID_STATUS_DETAIL_MAX_LENGTH)}`
        : 'Running subtask';
    }
    case 'TodoWrite':
      return 'Planning tasks';
    case 'Skill': {
      const skill = str(args['skill']) ?? '';
      return skill
        ? `Running skill: ${truncate(skill, DROID_STATUS_DETAIL_MAX_LENGTH)}`
        : 'Running a skill';
    }
    default:
      return truncate(toolName, DROID_STATUS_MAX_LENGTH);
  }
}

export const droidModule: AgentModule = {
  kind: 'agent',
  id: 'droid',
  displayName: 'Droid',
  protocolVersion: 1,

  formatToolStatus,
  permissionExemptTools: new Set<string>(),
  // A Task spawn is Droid's own sub-droid, run in its own session: nothing here spawns a sub-character for it.
  subagentToolNames: new Set<string>(),
  readingTools: new Set(['Read', 'Grep', 'Glob', 'LS', 'FetchUrl', 'WebFetch', 'WebSearch']),

  start: (host) =>
    new SessionStoreTracker(
      host,
      jsonlSessionStore({
        root: path.join(
          process.env[DROID_HOME_OVERRIDE_ENV] || os.homedir(),
          ...DROID_SESSIONS_DIR_SEGMENTS,
        ),
        depth: 1,
        isTranscript: (name) => name.endsWith(DROID_SESSION_FILE_SUFFIX),
        // herdr reports a droid session by its own id, which is also the transcript's file name.
        sessionIdOf: (file) => path.basename(file, DROID_SESSION_FILE_SUFFIX),
        format: droidTranscriptFormat,
      }),
      DEFAULT_SESSION_STORE_TIMING,
    ),
};
