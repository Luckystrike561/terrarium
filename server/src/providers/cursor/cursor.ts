/**
 * Cursor Agent CLI agent module. Cursor has no hook API: everything comes from its session transcripts, found
 * by scanning its session store or handed over by a multiplexer that hosts the session. Nothing is written
 * outside `~/.pixel-agents/`, so there is nothing to consent to.
 *
 * herdr reports a cursor pane's `agent_session` as a bare conversation UUID (`kind: 'id'`), not a path, so the
 * store is keyed by that UUID (`sessionIdOf`) rather than the transcript's real path.
 */

import * as os from 'node:os';
import * as path from 'node:path';

import type { AgentModule } from '../../../../core/src/provider.js';
import { DEFAULT_SESSION_STORE_TIMING } from '../sessionStore/constants.js';
import { jsonlSessionStore } from '../sessionStore/jsonlSessionStore.js';
import { SessionStoreTracker } from '../sessionStore/sessionStoreTracker.js';
import {
  CURSOR_PROJECT_DEPTH,
  CURSOR_PROJECTS_DIR_SEGMENTS,
  CURSOR_SESSION_FILE_SUFFIX,
  CURSOR_STATUS_DETAIL_MAX_LENGTH,
  CURSOR_STATUS_MAX_LENGTH,
} from './constants.js';
import { cursorTranscriptFormat } from './cursorTranscript.js';

type ToolInput = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

const obj = (v: unknown): ToolInput =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as ToolInput) : {};

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\u2026` : s;
}

/** The target of an ApplyPatch call, whose `input` is the raw patch text rather than an object. */
function applyPatchTarget(patch: string): string | undefined {
  const match = /\*\*\* (?:Add File|Update File|Delete File): (.+)/.exec(patch);
  return match ? path.basename(match[1].trim()) : undefined;
}

/** Status text for a Cursor tool call. Cursor records no intent line (unlike omp): the label is rebuilt from
 *  the tool's own input fields. */
export function formatToolStatus(toolName: string, input?: unknown): string {
  if (toolName === 'ApplyPatch') {
    const file = typeof input === 'string' ? applyPatchTarget(input) : undefined;
    return file ? `Editing ${file}` : 'Editing files';
  }

  const args = obj(input);
  const file = path.basename(str(args['path']) ?? '');
  switch (toolName) {
    case 'Read':
    case 'ReadFile':
      return `Reading ${file}`.trim();
    case 'ReadLints':
      return 'Reading lint results';
    case 'Glob': {
      const pattern = str(args['glob_pattern']);
      return pattern
        ? `Searching for ${truncate(pattern, CURSOR_STATUS_DETAIL_MAX_LENGTH)}`
        : 'Searching files';
    }
    case 'Grep':
    case 'rg': {
      const pattern = str(args['pattern']) ?? str(args['search_term']);
      return pattern
        ? `Searching for ${truncate(pattern, CURSOR_STATUS_DETAIL_MAX_LENGTH)}`
        : 'Searching code';
    }
    case 'SemanticSearch': {
      const query = str(args['query']);
      return query
        ? `Searching: ${truncate(query, CURSOR_STATUS_DETAIL_MAX_LENGTH)}`
        : 'Searching code';
    }
    case 'WebSearch':
      return 'Searching the web';
    case 'WebFetch':
      return 'Fetching web content';
    case 'Write':
      return `Writing ${file}`.trim();
    case 'StrReplace':
      return `Editing ${file}`.trim();
    case 'Delete':
      return `Deleting ${file}`.trim();
    case 'Shell':
    case 'AwaitShell':
    case 'Await': {
      const command = str(args['command']) ?? '';
      return command
        ? `Running: ${truncate(command, CURSOR_STATUS_DETAIL_MAX_LENGTH)}`
        : 'Running a command';
    }
    case 'TodoWrite':
      return 'Planning tasks';
    case 'Task':
    case 'Subagent': {
      const description = str(args['description']) ?? '';
      return description
        ? `Subtask: ${truncate(description, CURSOR_STATUS_DETAIL_MAX_LENGTH)}`
        : 'Running subtask';
    }
    default:
      return truncate(toolName, CURSOR_STATUS_MAX_LENGTH);
  }
}

export const cursorModule: AgentModule = {
  kind: 'agent',
  id: 'cursor',
  displayName: 'Cursor',
  protocolVersion: 1,

  formatToolStatus,
  permissionExemptTools: new Set<string>(),
  // Cursor's `Task`/`Subagent` runs sub-agents in their own transcripts under `subagents/`, out of this
  // module's reach (no tool result or id to correlate). Nothing here can clear a sub-character it would spawn.
  subagentToolNames: new Set<string>(),
  readingTools: new Set([
    'Read',
    'ReadFile',
    'Glob',
    'Grep',
    'rg',
    'SemanticSearch',
    'ReadLints',
    'WebSearch',
    'WebFetch',
  ]),

  // Cursor sessions run in whatever directory the user started them in.
  adoptsSessionsOutsideWorkspace: true,
  start: (host) =>
    new SessionStoreTracker(
      host,
      jsonlSessionStore({
        root: path.join(
          process.env['CURSOR_CONFIG_DIR'] || path.join(os.homedir(), '.cursor'),
          ...CURSOR_PROJECTS_DIR_SEGMENTS,
        ),
        depth: CURSOR_PROJECT_DEPTH,
        isTranscript: (name) => name.endsWith(CURSOR_SESSION_FILE_SUFFIX),
        format: cursorTranscriptFormat,
        // herdr reports the bare conversation uuid, which is also the transcript's own directory name
        // (`<uuid>/<uuid>.jsonl`): keying the store by it, rather than by the file's real path, lets a
        // multiplexer's `sessionRef` join the same session this module discovers on its own.
        sessionIdOf: (file) => path.basename(path.dirname(file)),
      }),
      DEFAULT_SESSION_STORE_TIMING,
    ),
};
