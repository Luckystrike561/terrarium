/**
 * Maki agent module. Maki has no hook API: everything comes from its session transcripts, found by scanning its
 * session store. herdr recognizes Maki panes by screen state only (no SessionStart integration, no session
 * reference), so the module discovers sessions entirely on its own and a pane joins one by matching its working
 * directory (`sessionInDirectory`), not an explicit ref. Nothing is written outside `~/.pixel-agents/`, so there
 * is nothing to consent to.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { AgentModule } from '../../../../core/src/provider.js';
import { DEFAULT_SESSION_STORE_TIMING } from '../sessionStore/constants.js';
import { jsonlSessionStore } from '../sessionStore/jsonlSessionStore.js';
import { SessionStoreTracker } from '../sessionStore/sessionStoreTracker.js';
import {
  MAKI_LEGACY_HOME_DIR,
  MAKI_SESSION_FILE_SUFFIX,
  MAKI_SESSIONS_SUBDIR,
  MAKI_STATE_DIR_SEGMENTS,
  MAKI_STATUS_DETAIL_MAX_LENGTH,
  MAKI_STATUS_MAX_LENGTH,
} from './constants.js';
import { makiTranscriptFormat } from './makiTranscript.js';

type ToolInput = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\u2026` : s;
}

export function formatToolStatus(toolName: string, input?: unknown): string {
  const args = (input ?? {}) as ToolInput;
  const file = () => path.basename(str(args['path']) ?? '');
  switch (toolName) {
    case 'read':
      return `Reading ${file()}`.trim();
    case 'write':
      return `Writing ${file()}`.trim();
    case 'edit':
    case 'multiedit':
    case 'edit_lines':
    case 'insert_lines':
      return `Editing ${file()}`.trim();
    case 'list': {
      const dir = file();
      return dir ? `Listing ${dir}` : 'Listing files';
    }
    case 'index': {
      const target = file();
      return target ? `Indexing ${target}` : 'Indexing files';
    }
    case 'view_image':
      return `Viewing ${file()}`.trim();
    case 'bash': {
      const label = str(args['description']) || str(args['command']) || '';
      return label
        ? `Running: ${truncate(label, MAKI_STATUS_DETAIL_MAX_LENGTH)}`
        : 'Running a command';
    }
    case 'grep':
    case 'glob':
      return 'Searching code';
    case 'webfetch':
      return 'Fetching web content';
    case 'websearch':
      return 'Searching the web';
    case 'task': {
      const description = str(args['description']) ?? '';
      return description
        ? `Subtask: ${truncate(description, MAKI_STATUS_DETAIL_MAX_LENGTH)}`
        : 'Running subtask';
    }
    case 'todo_write':
      return 'Planning tasks';
    case 'question':
      return 'Asking a question';
    default:
      return truncate(toolName, MAKI_STATUS_MAX_LENGTH);
  }
}

/** `<home>/.maki/sessions` when the legacy home exists (its migration to XDG paths not yet run), else the default
 *  XDG state path `<home>/.local/state/maki/sessions`. Maki names no CLI-specific home-dir override env var (only
 *  the generic, already-absolute `$XDG_STATE_HOME`, which this module does not special-case). */
function sessionsRoot(): string {
  const home = os.homedir();
  const legacyHome = path.join(home, MAKI_LEGACY_HOME_DIR);
  if (fs.existsSync(legacyHome)) return path.join(legacyHome, MAKI_SESSIONS_SUBDIR);
  return path.join(home, ...MAKI_STATE_DIR_SEGMENTS);
}

export const makiModule: AgentModule = {
  kind: 'agent',
  id: 'maki',
  displayName: 'Maki',
  protocolVersion: 1,

  formatToolStatus,
  permissionExemptTools: new Set<string>(),
  // Maki's `task` sub-agent chat is appended to the same transcript as `sub_msg` records, but there is no
  // subagentStart/subagentEnd machinery for a self-discovered session-store module to drive a separate
  // sub-character from: the spawn renders as a normal toolStart with a "Subtask: ..." label instead.
  subagentToolNames: new Set<string>(),
  readingTools: new Set([
    'read',
    'list',
    'glob',
    'grep',
    'index',
    'view_image',
    'webfetch',
    'websearch',
    'memory',
    'skill',
  ]),

  // Maki's session store is a single flat directory, independent of any workspace.
  adoptsSessionsOutsideWorkspace: true,
  start: (host) =>
    new SessionStoreTracker(
      host,
      jsonlSessionStore({
        root: sessionsRoot(),
        depth: 0,
        isTranscript: (name) => name.endsWith(MAKI_SESSION_FILE_SUFFIX),
        format: makiTranscriptFormat,
      }),
      DEFAULT_SESSION_STORE_TIMING,
    ),
};
