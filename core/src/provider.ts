/**
 * Provider modules: the integration boundary between the office and the tools that run agents.
 *
 * Two kinds of module, each usable alone or together:
 *
 * - An AgentModule speaks for one agent CLI (Claude Code, omp, ...). It owns that CLI's vocabulary (tool names,
 *   status text, context windows) and knows how to read what the CLI reports (installed hooks, transcripts, or
 *   both), so it can find that CLI's sessions with no multiplexer around it.
 * - A MultiplexerModule speaks for one terminal multiplexer (herdr, ...). It knows which agents are alive, what
 *   kind of CLI each one is, its status level, name and task, but never what the agent is doing. For that it hands
 *   each agent to the AgentModule registered for its kind, and falls back to status alone when none is.
 *
 * Every module reduces what it reads to AgentEvents. The runtime dispatches on `AgentEvent.kind` and never on
 * CLI-specific names.
 */

import type { TeamProvider } from './teamProvider.js';

// ── Normalized Events (every module produces these) ───────────

export type AgentEvent =
  | {
      kind: 'toolStart';
      toolId: string;
      toolName: string;
      input?: unknown;
      /** True when the tool was spawned to run in the background (e.g. Claude's
       *  `run_in_background` on Agent/Task). Handlers use this to suppress ghost
       *  sub-agent characters for teammate spawns. */
      runInBackground?: boolean;
    }
  | { kind: 'toolEnd'; toolId: string }
  | {
      kind: 'turnEnd';
      /** True when the turn ended because the agent went idle waiting on the
       *  user (Claude's Notification(idle_prompt)) rather than simply finishing
       *  its response (Stop). Drives the "Waiting for input" vs "Done" label.
       *  Absent/false = the agent finished its turn (Done). */
      awaitingInput?: boolean;
    }
  /** The agent is busy on a turn and the source cannot say with which tool: a user prompt landed, or a multiplexer
   *  reports the agent working. Makes the character active and withdraws any permission ask. */
  | { kind: 'working' }
  | {
      kind: 'subagentStart';
      parentToolId: string;
      toolId: string;
      toolName: string;
      input?: unknown;
      runInBackground?: boolean;
    }
  | { kind: 'subagentEnd'; parentToolId: string; toolId: string }
  | {
      kind: 'subagentTurnEnd';
      parentToolId: string;
      /** 'idle' = subagent is idle and ready for more work; 'completed' = subagent
       *  reported its task done. Some providers emit only one; both route to the
       *  same handler but with different downstream cleanup. */
      reason: 'idle' | 'completed';
    }
  | { kind: 'progress'; toolId: string; data: unknown }
  | { kind: 'permissionRequest' }
  | {
      kind: 'sessionStart';
      source?: string;
      /** Transcript the runtime's own transcript parser should follow for this session. Only set by the module whose
       *  transcripts that parser reads (the one declaring `getSessionDirs`). */
      transcriptPath?: string;
      /** The session's identity shared across modules: its transcript path, or the CLI's own session id when the
       *  CLI's multiplexer integration reports one. A multiplexer and an agent module that report the same ref are
       *  reporting the same agent, which then renders as one character. Never parsed by the runtime, unlike
       *  `transcriptPath`. */
      sessionRef?: string;
      /** Working directory the session was started in. Used to match pending
       *  external sessions against known workspace folders. */
      cwd?: string;
    }
  | { kind: 'sessionEnd'; reason?: string }
  | {
      kind: 'sessionInfo';
      /** Human label for the character, replacing the cwd-derived folder name. */
      name?: string;
      /** One-line description of what the agent is working on. */
      task?: string;
    };

// ── Running modules ───────────────────────────────────────────

/** What a running module feeds. One host per module, bound to its id: every event emitted through it is attributed
 *  to that module. */
export interface ModuleHost {
  emit(sessionId: string, event: AgentEvent): void;
  log(message: string): void;
}

export interface ModuleHandle {
  stop(): void;
}

/** An agent module once started: its own session discovery is running, and it can take over sessions a multiplexer
 *  found. */
export interface RunningAgentModule extends ModuleHandle {
  /** Report the activity of the session `sessionRef` names, which a multiplexer found. The module emits under its
   *  own session ids and must announce the same ref as `sessionStart.sessionRef`, so the multiplexer's events for the
   *  same session land on the same agent. Stopping the returned handle ends the session only when nothing else (the
   *  module's own discovery) still tracks it. */
  followSession(sessionRef: string): ModuleHandle;
  /** The ref of the one live session running in `cwd`, for multiplexers that report no session identity for this
   *  CLI. Undefined when none or several run there: guessing would merge two agents into one character. */
  sessionInDirectory?(cwd: string): string | undefined;
}

// ── Agent modules ─────────────────────────────────────────────

/** Hooks written into a third-party settings file. Writing there is consent-gated: the consent gate asks once per
 *  module that has one of these, with the module's own disclosure. */
export interface HookInstaller {
  /** Install hook entries that POST to this server's `/api/hooks/<module id>`. */
  installHooks(serverUrl: string, authToken: string): Promise<void>;
  uninstallHooks(): Promise<void>;
  areHooksInstalled(): Promise<boolean>;
  /** First-run consent copy for THIS module's hook install: the headline titles the ask, the disclosure is its body
   *  (what is written, what data moves, how to undo; paragraphs split on blank lines). Required, not optional: a
   *  module that installs anything must state its terms, and the gate ships these verbatim so no client copy can
   *  drift. */
  consentDisclosure(): { headline: string; disclosure: string };
  /** Put the files the hook entries execute in place, from the installed package root. Callers run it BEFORE
   *  `installHooks` and abort on false: an entry whose command points at a missing file is worse than no hook. */
  stageHookFiles?(packageRoot: string): boolean;
}

export interface AgentModule {
  readonly kind: 'agent';
  readonly id: string;
  readonly displayName: string;
  /** Protocol version. Server refuses to dispatch events from a module whose
   *  version it doesn't understand. Bump on every breaking change to AgentEvent
   *  / TeamProvider / AgentModule. Start at 1. */
  readonly protocolVersion: number;

  /** Normalize a payload POSTed to `/api/hooks/<id>` into an AgentEvent. Each CLI sends different JSON (Claude:
   *  snake_case, Copilot: camelCase, etc.). Return null for events to ignore. Absent for CLIs without a hook API:
   *  POSTs to their route are dropped. */
  normalizeHookEvent?(raw: Record<string, unknown>): {
    sessionId: string;
    event: AgentEvent;
  } | null;

  /** Hooks this module installs into its CLI's settings. Absent when nothing is written outside `~/.pixel-agents/`. */
  readonly hooks?: HookInstaller;

  /** Format tool status for display (e.g., "Read" -> "Reading foo.ts") */
  formatToolStatus(toolName: string, input?: unknown): string;
  /** Tools that don't trigger permission timers */
  readonly permissionExemptTools: ReadonlySet<string>;
  /** Tools that spawn sub-agent characters */
  readonly subagentToolNames: ReadonlySet<string>;
  /** Tools that should show the "reading" character animation instead of "typing".
   *  The module classifies tools as read-like or write-like; the webview renders
   *  the animation. Allows new modules to override without webview edits. */
  readonly readingTools: ReadonlySet<string>;
  /** Terminal name prefix used when launching this CLI. Used by the extension to
   *  match VS Code terminals to agents for heuristic adoption. */
  readonly terminalNamePrefix?: string;

  /** Context window, in tokens, for a model id this CLI reports in its
   *  transcripts. Transcripts state token usage but never the limit it counts
   *  against, so only the module can say, and getting it wrong is visible:
   *  the office renders usage/window as a context gauge over every character.
   *  Return undefined for an unrecognized model; the runtime then keeps its
   *  previous estimate and widens it if a context ever exceeds it. */
  contextWindowForModel?(model: string | undefined): number | undefined;

  /** Sessions of this CLI live wherever its user started them, not in the workspace's project dirs, so the runtime
   *  adopts every session this module announces regardless of Watch All Sessions. Scoped to this module: another
   *  module's sessions keep the workspace rule. */
  readonly adoptsSessionsOutsideWorkspace?: boolean;

  /** Start this module's own session discovery. Absent for modules fed entirely by hooks and the runtime's own
   *  transcript scanners. */
  start?(host: ModuleHost): RunningAgentModule;

  // ── Optional file fallback (heuristic mode, read by the runtime's own transcript parser) ──

  /** Session directories to scan. Undefined = no file fallback. */
  getSessionDirs?(workspacePath: string): string[];
  /** Root directories containing every session this module may have started
   *  (across all workspaces). Used by global session discovery / "Watch All
   *  Sessions". Each returned dir contains subdirs whose entries are session
   *  transcript files. Undefined = this module doesn't support global scan. */
  getAllSessionRoots?(): string[];
  /** Glob pattern for session files (e.g., '*.jsonl'). */
  readonly sessionFilePattern?: string;
  /** Build CLI launch command for +Agent button. */
  buildLaunchCommand?(
    sessionId: string,
    cwd: string,
    opts?: { bypassPermissions?: boolean },
  ): {
    command: string;
    args: string[];
    env?: Record<string, string>;
  };

  // ── Optional team/subagent extension (Agent Teams on Claude; empty for single-agent CLIs) ──

  /** Optional reference to a TeamProvider. When set, the hook handler registers team-aware
   *  branches (subagent routing, teammate discovery, permission forwarding, etc.). */
  readonly team?: TeamProvider;
}

// ── Multiplexer modules ───────────────────────────────────────

/** Status level of a hosted agent, as a multiplexer sees it. */
export type MultiplexedAgentStatus = 'working' | 'blocked' | 'idle';

/** One live agent in a multiplexer pane. */
export interface MultiplexedAgent {
  /** Stable id of the pane hosting the agent, unique within the multiplexer. */
  readonly paneId: string;
  /** Which CLI runs in the pane, as an agent module id ('omp', 'claude', ...). */
  readonly agentKind: string;
  readonly status: MultiplexedAgentStatus;
  readonly cwd: string;
  /** Human label for the character. */
  readonly name: string;
  /** One-line description of what the agent is working on. */
  readonly task: string;
  /** The agent's session, as the multiplexer's integration with the CLI reports it: an absolute transcript path or
   *  the CLI's own session id. Absent when the multiplexer only watches the screen. */
  readonly sessionRef?: string;
}

export interface MultiplexerConnection extends ModuleHandle {
  /** Settles once the first connection attempt does: true when the multiplexer answered. A false start keeps
   *  retrying in the background. */
  readonly connected: Promise<boolean>;
}

export interface MultiplexerModule {
  readonly kind: 'multiplexer';
  readonly id: string;
  readonly displayName: string;
  /** Watch the multiplexer. `onSnapshot` receives the full list of live agents every time it may have changed; an
   *  agent missing from a snapshot has ended. */
  connect(
    onSnapshot: (agents: readonly MultiplexedAgent[]) => void,
    log: (message: string) => void,
  ): MultiplexerConnection;
}

export type ProviderModule = AgentModule | MultiplexerModule;
