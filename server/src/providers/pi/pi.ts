/**
 * pi agent module. pi has no hook API: everything comes from its session transcripts, found by scanning its
 * session store or handed over by a multiplexer that hosts the session. Nothing is written outside
 * `~/.pixel-agents/`, so there is nothing to consent to.
 *
 * pi's own herdr integration reports the transcript's real path once its `SessionManager` has one, which is
 * normally as soon as the session exists (the path is assigned before the file is actually written, so pi's lazy
 * file creation never delays it), except the integration only trusts a path that starts with `/` (its
 * `updateSessionRef`), which no Windows path ever does. There it falls back to pi's own session id for the pane's
 * whole life, not just until the file appears. Keying every session by that id instead (extracted from the
 * `<timestamp>_<id>.jsonl` name pi always writes) keeps this module's own session discovery and herdr's
 * hand-over using the same identity on that platform, so the two always land on one character: staying
 * path-keyed everywhere else matches omp exactly and needs no translation. A session whose id-named file does
 * not exist on disk yet is covered for free either way: `jsonlSessionStore`'s lookup rescans the directory on
 * every retry, so a follow started before pi has written anything still binds once it does.
 */

import * as os from 'node:os';
import * as path from 'node:path';

import type { AgentModule } from '../../../../core/src/provider.js';
import { DEFAULT_SESSION_STORE_TIMING } from '../sessionStore/constants.js';
import { jsonlSessionStore } from '../sessionStore/jsonlSessionStore.js';
import { SessionStoreTracker } from '../sessionStore/sessionStoreTracker.js';
import {
  PI_ENV_AGENT_DIR,
  PI_ENV_SESSION_DIR,
  PI_SESSION_FILE_SUFFIX,
  PI_SESSIONS_DIR_SEGMENTS,
  PI_STATUS_DETAIL_MAX_LENGTH,
  PI_STATUS_MAX_LENGTH,
} from './constants.js';
import { piTranscriptFormat } from './piTranscript.js';

type ToolInput = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\u2026` : s;
}

/** Status text for a pi tool call. pi has no `intent` field like omp's fork added, so the label is built from the
 *  tool's own arguments. */
export function formatToolStatus(toolName: string, input?: unknown): string {
  const args = (input ?? {}) as ToolInput;
  const file = path.basename(str(args['path']) ?? '');
  switch (toolName) {
    case 'read':
      return `Reading ${file}`.trim();
    case 'write':
      return `Writing ${file}`.trim();
    case 'edit':
      return `Editing ${file}`.trim();
    case 'bash':
    case 'powershell': {
      const command = str(args['command']) ?? '';
      return command
        ? `Running: ${truncate(command, PI_STATUS_DETAIL_MAX_LENGTH)}`
        : 'Running a command';
    }
    case 'grep':
    case 'find':
      return 'Searching code';
    case 'ls':
      return `Listing ${file || '.'}`;
    case 'codemode':
      return 'Running a script';
    case 'tool_search':
      return 'Searching tools';
    case 'list_mcp_resources':
    case 'list_mcp_resource_templates':
    case 'read_mcp_resource':
      return 'Reading a resource';
    default:
      return truncate(toolName, PI_STATUS_MAX_LENGTH);
  }
}

function expandHome(dir: string): string {
  return dir === '~' || dir.startsWith('~/') || dir.startsWith(`~${path.sep}`)
    ? path.join(os.homedir(), dir.slice(1))
    : dir;
}

/** Where pi keeps its sessions, honoring the overrides pi itself reads: the session-dir override drops the
 *  per-cwd `--<cwd>--` bucketing (sessions then sit directly in it), the agent-dir override keeps it.
 *  `--session-dir`/`--session-id` are per-invocation CLI flags with nothing on disk to recover them from
 *  afterward, and a project's `.pi/settings.json` `sessionDir` is read before pi resolves project trust, which
 *  this module has no equivalent gate for: both are left unhandled. */
function sessionsRoot(): { root: string; depth: number } {
  const sessionDir = process.env[PI_ENV_SESSION_DIR];
  if (sessionDir) return { root: expandHome(sessionDir), depth: 0 };
  const agentDir = process.env[PI_ENV_AGENT_DIR];
  if (agentDir) return { root: path.join(expandHome(agentDir), 'sessions'), depth: 1 };
  return { root: path.join(os.homedir(), ...PI_SESSIONS_DIR_SEGMENTS), depth: 1 };
}

/** pi's own id for the session a transcript holds, pulled from the file name it always writes
 *  (`<timestamp>_<id>.jsonl`; the timestamp has colons and periods turned into dashes and never an underscore, so
 *  the first underscore always starts the id even when a caller-supplied `--session-id` contains one itself). */
function piSessionIdOf(file: string): string {
  const match = /^[^_]+_(.+)\.jsonl$/.exec(path.basename(file));
  return match ? match[1] : file;
}

const isTranscript = (name: string): boolean => name.endsWith(PI_SESSION_FILE_SUFFIX);

export const piModule: AgentModule = {
  kind: 'agent',
  id: 'pi',
  displayName: 'Pi',
  protocolVersion: 1,

  formatToolStatus,
  permissionExemptTools: new Set<string>(),
  // pi ships no built-in sub-agents: nothing here spawns one.
  subagentToolNames: new Set<string>(),
  readingTools: new Set([
    'read',
    'grep',
    'find',
    'ls',
    'list_mcp_resources',
    'list_mcp_resource_templates',
    'read_mcp_resource',
  ]),

  // pi sessions run in whatever directory the user started them in.
  adoptsSessionsOutsideWorkspace: true,
  start: (host) => {
    const { root, depth } = sessionsRoot();
    // Windows: herdr's pi integration never reports a path, only pi's own session id. Key every session by that
    // id so discovery and herdr's hand-over always agree. Elsewhere herdr reports the real path, matching the
    // default (path-keyed) store, same as omp.
    const sessionIdOf = process.platform === 'win32' ? piSessionIdOf : undefined;
    return new SessionStoreTracker(
      host,
      jsonlSessionStore({ root, depth, isTranscript, format: piTranscriptFormat, sessionIdOf }),
      DEFAULT_SESSION_STORE_TIMING,
    );
  },
};
