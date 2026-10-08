/**
 * Letta Code agent module. Letta Code's default Cloud backend keeps conversations server-side, with only
 * stats on disk; this module reads the local backend (`--backend local`), whose per-conversation transcripts
 * are the only sessions it can show. Nothing is written outside `~/.pixel-agents/`, so there is nothing to
 * consent to.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { AgentModule } from '../../../../core/src/provider.js';
import { DEFAULT_SESSION_STORE_TIMING } from '../sessionStore/constants.js';
import { jsonlSessionStore } from '../sessionStore/jsonlSessionStore.js';
import { SessionStoreTracker } from '../sessionStore/sessionStoreTracker.js';
import {
  LETTA_CONVERSATION_KEY_PREFIX,
  LETTA_CONVERSATION_RECORD_FILE_NAME,
  LETTA_CONVERSATIONS_DIR_SEGMENT,
  LETTA_LOCAL_BACKEND_DIR_ENV,
  LETTA_LOCAL_BACKEND_DIR_SEGMENTS,
  LETTA_SESSION_FILE_NAME,
  LETTA_STATUS_DETAIL_MAX_LENGTH,
  LETTA_STATUS_MAX_LENGTH,
  LETTA_SUBAGENT_RECORD_FIELD,
} from './constants.js';
import { lettaTranscriptFormat } from './lettaTranscript.js';

type ToolInput = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\u2026` : s;
}

/** Status text for a Letta Code tool call, from the tool's own input schema (Letta has no agent-authored
 *  intent line the way omp does). */
export function formatToolStatus(toolName: string, input?: unknown): string {
  const args = (input ?? {}) as ToolInput;
  const file = path.basename(str(args['file_path']) ?? '');
  switch (toolName) {
    case 'Read':
    case 'ReadLSP':
    case 'ViewImage':
    case 'read_artifact_file':
      return `Reading ${file}`.trim();
    case 'Write':
    case 'write_artifact_file':
      return `Writing ${file}`.trim();
    case 'Edit':
    case 'ApplyPatch':
      return `Editing ${file}`.trim();
    case 'Bash': {
      const command = str(args['command']) ?? '';
      return command
        ? `Running: ${truncate(command, LETTA_STATUS_DETAIL_MAX_LENGTH)}`
        : 'Running a command';
    }
    case 'exec_command': {
      const command = str(args['cmd']) ?? '';
      return command
        ? `Running: ${truncate(command, LETTA_STATUS_DETAIL_MAX_LENGTH)}`
        : 'Running a command';
    }
    case 'Glob':
    case 'Grep':
    case 'LS':
      return 'Searching code';
    case 'web_search':
      return 'Searching the web';
    case 'conversation_search':
      return 'Searching conversation';
    case 'Task': {
      const description = str(args['description']) ?? '';
      return description
        ? `Subtask: ${truncate(description, LETTA_STATUS_DETAIL_MAX_LENGTH)}`
        : 'Running subtask';
    }
    default:
      return truncate(toolName, LETTA_STATUS_MAX_LENGTH);
  }
}

/** Letta Code keys a conversation's transcript directory by `conversationKey(conversationId, agentId)`,
 *  base64url-encoded: `default:<agentId>` for an agent's default conversation, else
 *  `conversation:<conversationId>`. herdr reports that same identity as `agent_session.value`, but without the
 *  `conversation:` prefix, so the module strips it to land on the same key herdr uses. */
function conversationKeyOf(file: string): string {
  const encoded = path.basename(path.dirname(file));
  const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
  return decoded.startsWith(LETTA_CONVERSATION_KEY_PREFIX)
    ? decoded.slice(LETTA_CONVERSATION_KEY_PREFIX.length)
    : decoded;
}

/** `Task` spawns its sub-agent as its own conversation, sibling to the lead's, with no interleaved record of
 *  it in the lead's transcript. Left undiscovered it would surface as an unrelated standalone character, so
 *  the store excludes any conversation whose record marks it a sub-agent's. A record this process cannot yet
 *  read (still being written) is treated as a lead conversation: filtering out something we cannot classify
 *  would risk hiding a real one. */
function isSubagentConversation(messagesFile: string): boolean {
  const recordFile = path.join(path.dirname(messagesFile), LETTA_CONVERSATION_RECORD_FILE_NAME);
  try {
    const record = JSON.parse(fs.readFileSync(recordFile, 'utf8')) as Record<string, unknown>;
    return record[LETTA_SUBAGENT_RECORD_FIELD] === true;
  } catch {
    return false;
  }
}

export const lettaModule: AgentModule = {
  kind: 'agent',
  id: 'letta',
  displayName: 'Letta Code',
  protocolVersion: 1,

  formatToolStatus,
  permissionExemptTools: new Set<string>(),
  // Task runs its sub-agent as a separate conversation: the child's tool calls never appear in this transcript.
  subagentToolNames: new Set<string>(),
  readingTools: new Set([
    'Read',
    'Glob',
    'Grep',
    'LS',
    'read_artifact_file',
    'ReadLSP',
    'ViewImage',
    'web_search',
    'conversation_search',
  ]),

  // Letta Code sessions run in whatever directory the user started them in.
  adoptsSessionsOutsideWorkspace: true,
  start: (host) =>
    new SessionStoreTracker(
      host,
      jsonlSessionStore({
        root: path.join(
          process.env[LETTA_LOCAL_BACKEND_DIR_ENV] ||
            path.join(os.homedir(), ...LETTA_LOCAL_BACKEND_DIR_SEGMENTS),
          LETTA_CONVERSATIONS_DIR_SEGMENT,
        ),
        depth: 1,
        isTranscript: (name, filePath) =>
          name === LETTA_SESSION_FILE_NAME && !isSubagentConversation(filePath),
        format: lettaTranscriptFormat,
        sessionIdOf: conversationKeyOf,
      }),
      DEFAULT_SESSION_STORE_TIMING,
    ),
};
