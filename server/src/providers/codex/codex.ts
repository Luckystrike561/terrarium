/**
 * Codex agent module. Codex has no hook API this module uses for discovery: sessions are found by scanning its
 * rollout store, keyed by the thread id its file name encodes. That id is also what Codex reports through its own
 * SessionStart hook payload (`session_id`), which is what herdr's codex integration forwards as the pane's session
 * ref, so the store is keyed to match it instead of a transcript path. Nothing is written outside
 * `~/.pixel-agents/`, so there is nothing to consent to.
 */

import * as os from 'node:os';
import * as path from 'node:path';

import type { AgentModule } from '../../../../core/src/provider.js';
import { DEFAULT_SESSION_STORE_TIMING } from '../sessionStore/constants.js';
import { jsonlSessionStore } from '../sessionStore/jsonlSessionStore.js';
import { SessionStoreTracker } from '../sessionStore/sessionStoreTracker.js';
import { codexTranscriptFormat } from './codexTranscript.js';
import {
  CODEX_HOME_ENV_VAR,
  CODEX_SESSION_FILE_SUFFIX,
  CODEX_SESSIONS_DIR_DEPTH,
  CODEX_SESSIONS_DIR_SEGMENTS,
  CODEX_STATUS_DETAIL_MAX_LENGTH,
  CODEX_STATUS_MAX_LENGTH,
  CODEX_TOOL_APPLY_PATCH,
  CODEX_TOOL_EXEC_COMMAND,
  CODEX_TOOL_UPDATE_PLAN,
} from './constants.js';

type ToolInput = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\u2026` : s;
}

/** apply_patch is a freeform tool: its call carries the raw patch text, not JSON. File paths come from its own
 *  `*** Add/Update/Delete File: <path>` markers. */
const PATCH_FILE_LINE = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm;

function patchFileLabel(patch: string): string {
  const files = [...patch.matchAll(PATCH_FILE_LINE)].map((m) => path.basename(m[1].trim()));
  if (files.length === 1) return `Editing ${files[0]}`;
  if (files.length > 1) return `Editing ${files.length} files`;
  return 'Editing files';
}

export function formatToolStatus(toolName: string, input?: unknown): string {
  const args = (input ?? {}) as ToolInput;
  switch (toolName) {
    case CODEX_TOOL_EXEC_COMMAND: {
      const cmd = str(args['cmd']);
      return cmd
        ? `Running: ${truncate(cmd, CODEX_STATUS_DETAIL_MAX_LENGTH)}`
        : 'Running a command';
    }
    case CODEX_TOOL_APPLY_PATCH:
      return patchFileLabel(str(args['input']) ?? '');
    case CODEX_TOOL_UPDATE_PLAN:
      return 'Planning tasks';
    default:
      return truncate(toolName, CODEX_STATUS_MAX_LENGTH);
  }
}

function codexHome(): string {
  const override = process.env[CODEX_HOME_ENV_VAR];
  return override && override.trim() ? override : path.join(os.homedir(), '.codex');
}

/** The thread id a rollout's file name encodes: `rollout-<19-char-UTC-timestamp>-<thread-id>[_<rollout-id>].jsonl`.
 *  The thread id is always the first id component, stable across a reverted thread's extra `_<rollout-id>`
 *  suffix, and equals `SessionMeta.session_id` (the id Codex's own hooks report and herdr forwards as the pane's
 *  session ref). */
function threadIdFromFile(file: string): string {
  const name = path.basename(file, CODEX_SESSION_FILE_SUFFIX);
  const match = /^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-(.+)$/.exec(name);
  const ids = match ? match[1] : name;
  return ids.split('_')[0] || ids;
}

export const codexModule: AgentModule = {
  kind: 'agent',
  id: 'codex',
  displayName: 'Codex',
  protocolVersion: 1,

  formatToolStatus,
  permissionExemptTools: new Set<string>(),
  // Codex's multi-agent tools spawn sub-agents in their own sessions; nothing here reports their results in this one.
  subagentToolNames: new Set<string>(),
  // Codex has one general-purpose exec tool, not separate read/write tools: no reliable read-vs-write distinction.
  readingTools: new Set<string>(),

  start: (host) =>
    new SessionStoreTracker(
      host,
      jsonlSessionStore({
        root: path.join(codexHome(), ...CODEX_SESSIONS_DIR_SEGMENTS),
        depth: CODEX_SESSIONS_DIR_DEPTH,
        isTranscript: (name) => name.endsWith(CODEX_SESSION_FILE_SUFFIX),
        format: codexTranscriptFormat,
        sessionIdOf: threadIdFromFile,
      }),
      DEFAULT_SESSION_STORE_TIMING,
    ),
};
