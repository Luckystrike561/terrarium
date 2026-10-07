/**
 * Herdr provider — normalizes events pushed by the local Herdr bridge
 * (see herdrBridge.ts) into the common AgentEvent vocabulary.
 *
 * Herdr is not a CLI with a hook API. It is a local session multiplexer that
 * exposes the state of every agent it manages through `herdr api snapshot`
 * (a JSON-RPC call over ~/.herdr/herdr.sock). The bridge polls that snapshot
 * and POSTs normalized events to this server, so from the server's point of
 * view Herdr is a hooks-only provider: no transcript file, all state arrives
 * as events. This mirrors the "hooks-only provider" path already used for
 * OpenCode / Copilot (see adoptExternalSessionFromHook: transcriptPath
 * undefined -> agent created with hooksOnly: true).
 *
 * Wire contract (bridge -> POST /api/hooks/herdr), same envelope the HTTP route
 * requires for every provider:
 *   { session_id: string, hook_event_name: string, ...payload }
 *
 * hook_event_name vocabulary emitted by the bridge:
 *   - SessionStart       (first time an agent is observed)
 *   - PreToolUse         (a tool started; `data` = { toolCallId, toolName,
 *                         args, intent })
 *   - PermissionRequest  (agent is blocked / awaiting approval)
 *   - Stop               (agent finished its turn -> Done)
 *   - Notification       (agent is idle waiting for the user -> Waiting)
 *   - SessionEnd         (agent disappeared from the snapshot / exited)
 */

import type { AgentEvent, HookProvider } from '../../../../../core/src/provider.js';

// ── Envelope helpers ─────────────────────────────────────────

type Wire = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** omp reports tool names lower-case with its own vocabulary. Older/other
 *  agents on the same box report Claude-ish capitalized names. Normalize to a
 *  lower-case key so both map to the same display string. */
function toolKey(name: string): string {
  return name.trim().toLowerCase();
}

// ── normalizeHookEvent ───────────────────────────────────────

export function normalizeHookEvent(raw: Wire): { sessionId: string; event: AgentEvent } | null {
  const sessionId = str(raw['session_id']);
  if (!sessionId) return null;
  const name = str(raw['hook_event_name']);
  if (!name) return null;

  const data = raw['data'];
  const payload = (data && typeof data === 'object' ? data : {}) as Wire;
  const dataStr = str(data);

  switch (name) {
    case 'SessionStart':
      return {
        sessionId,
        event: {
          kind: 'sessionStart',
          source: 'startup',
          // No transcript: herdr agents are hooks-only. `cwd` is what the
          // adoption path uses to name the character's folder.
          transcriptPath: str(raw['transcript_path']),
          cwd: str(raw['cwd']),
        },
      };

    case 'PreToolUse': {
      const toolId = str(payload['toolCallId']) ?? str(raw['tool_use_id']) ?? `herdr-${Date.now()}`;
      const toolName = str(payload['toolName']) ?? str(raw['tool_name']) ?? 'tool';
      // Prefer the agent's own one-line intent ("Reading project plan") when
      // present — it reads better than anything we could reconstruct from args.
      const input: Wire = { ...payload };
      const intent = str(payload['intent']);
      if (intent) input['__intent'] = intent;
      return {
        sessionId,
        event: { kind: 'toolStart', toolId, toolName, input },
      };
    }

    case 'PermissionRequest':
      return { sessionId, event: { kind: 'permissionRequest' } };

    // Stop = turn finished (Done). Notification = idle_prompt equivalent, i.e.
    // the agent is waiting on the user (Waiting for input).
    case 'Stop':
      return { sessionId, event: { kind: 'turnEnd' } };
    case 'Notification':
      return { sessionId, event: { kind: 'turnEnd', awaitingInput: true } };

    case 'SessionInfo':
      return {
        sessionId,
        event: { kind: 'sessionInfo', name: str(raw['name']), task: str(raw['task']) },
      };

    case 'SessionEnd':
      return { sessionId, event: { kind: 'sessionEnd', reason: dataStr ?? 'exit' } };

    default:
      return null; // unknown -> silently drop
  }
}

// ── Display ──────────────────────────────────────────────────

const BASENAME_MAX = 40;

function basename(p: unknown): string {
  if (typeof p !== 'string') return '';
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] ?? '';
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\u2026` : s;
}

export function formatToolStatus(toolName: string, input?: unknown): string {
  const inp = (input ?? {}) as Wire;
  // The agent's own intent line wins when available.
  const intent = str(inp['__intent']);
  if (intent) return truncate(intent, 60);

  const key = toolKey(toolName);
  switch (key) {
    case 'read':
      return `Reading ${basename(inp['path'] ?? inp['file_path'])}`.trim();
    case 'write':
      return `Writing ${basename(inp['path'] ?? inp['file_path'])}`.trim();
    case 'edit':
    case 'multiedit':
    case 'str_replace':
      return `Editing ${basename(inp['path'] ?? inp['file_path'])}`.trim();
    case 'shell':
    case 'bash':
    case 'exec': {
      const cmd = str(inp['command']) ?? str(inp['cmd']) ?? '';
      return cmd ? `Running: ${truncate(cmd, 50)}` : 'Running a command';
    }
    case 'grep':
    case 'glob':
    case 'search':
      return 'Searching code';
    case 'webfetch':
      return 'Fetching web content';
    case 'websearch':
      return 'Searching the web';
    case 'task':
    case 'agent': {
      const desc = str(inp['description']) ?? str(inp['prompt']) ?? '';
      return desc ? `Subtask: ${truncate(desc, 50)}` : 'Running subtask';
    }
    case 'todowrite':
    case 'todo':
      return 'Planning tasks';
    default:
      return truncate(toolName, BASENAME_MAX);
  }
}

// ── Hooks installation ───────────────────────────────────────
// Herdr needs no hook install: nothing is written into a third-party config
// file. The bridge is spawned by the standalone CLI and talks to the local
// Herdr socket only. These are therefore deliberate no-ops (fail-open on
// areHooksInstalled so the UI never nags for a consent that does not apply).

async function installHooks(): Promise<void> {
  /* no-op: the bridge is started by the standalone CLI, not installed. */
}
async function uninstallHooks(): Promise<void> {
  /* no-op */
}
async function areHooksInstalled(): Promise<boolean> {
  return true;
}

function consentDisclosure(): { headline: string; disclosure: string } {
  return {
    headline: 'Connect to Herdr',
    disclosure:
      'The Herdr provider reads the live state of the agents Herdr manages by running the ' +
      'local command `herdr api snapshot` and parsing its JSON output. It never writes to ' +
      'any Herdr file, and it does not modify any other tool configuration.\n\n' +
      'Normalized state changes (agent created, tool started, blocked, idle, ended) are sent ' +
      'over HTTP to this Pixel Agents server on 127.0.0.1 only, using the server token. No ' +
      'prompt text, file contents, or command output leave your machine: only the agent name, ' +
      'working directory, status, and the one-line tool label shown on screen.\n\n' +
      'Disable it by stopping the bridge (it is a child process of this server); nothing is ' +
      'left behind in your configuration.',
  };
}

export const herdrProvider: HookProvider = {
  kind: 'hook',
  id: 'herdr',
  displayName: 'Herdr',
  protocolVersion: 1,

  normalizeHookEvent,

  installHooks,
  uninstallHooks,
  areHooksInstalled,
  consentDisclosure,

  formatToolStatus,
  permissionExemptTools: new Set<string>(),
  subagentToolNames: new Set<string>(['task', 'agent', 'Task', 'Agent']),
  readingTools: new Set<string>(['read', 'grep', 'glob', 'webfetch', 'websearch']),

  // No file fallback and no team extension: herdr state is push-only through
  // the bridge, so getSessionDirs / getAllSessionRoots / team stay unset.
};
