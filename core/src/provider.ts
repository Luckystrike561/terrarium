/**
 * Provider modules: the integration boundary between the office and the tools that run agents.
 *
 * Three kinds of module, each usable alone or together:
 *
 * - An AgentModule speaks for one agent CLI (Claude Code, omp, ...). It owns that CLI's vocabulary (tool names,
 *   status text, context windows) and knows how to read what the CLI reports (installed hooks, transcripts, or
 *   both), so it can find that CLI's sessions with no multiplexer around it.
 * - A MultiplexerModule speaks for one terminal multiplexer (herdr, ...). It knows which agents are alive, what
 *   kind of CLI each one is, its status level, name and task, but never what the agent is doing. For that it hands
 *   each agent to the AgentModule registered for its kind, and falls back to status alone when none is.
 * - A QuotaSourceModule reads an account quota of a provider that runs no agent CLI of its own. An agent module
 *   that sees its provider's quota reports it through its ModuleHost instead.
 *
 * Agent and multiplexer modules reduce what they read to AgentEvents, quota sources to QuotaReadings. The runtime
 * dispatches on `AgentEvent.kind` and never on CLI-specific names.
 */

import type { QuotaUnit } from './messages.js';

// ── Normalized Events (every agent and multiplexer module produces these) ───────────

/** How an agent sits in a team, as its module reports it. The office shows it; the runtime never interprets it. */
export interface TeamMembership {
  teamName?: string;
  /** The agent's name within the team. Absent for the lead. */
  agentName?: string;
  isTeamLead?: boolean;
  /** Session id, as emitted by the same module, of this agent's lead. */
  leadSessionId?: string;
  /** Whether the team's teammates run in their own terminals. Absent leaves the previous value in place. */
  teamUsesTmux?: boolean;
}

export type AgentEvent =
  // ── Session lifecycle ──
  | {
      kind: 'sessionStart';
      source?: string;
      /** The session's identity shared across modules: its transcript path, or the CLI's own session id when the
       *  CLI's multiplexer integration reports one. A multiplexer and an agent module that report the same ref are
       *  reporting the same agent, which then renders as one character. Also the key a restart hands back to the
       *  module (`RunningAgentModule.restoreSession`). */
      sessionRef?: string;
      /** Working directory the session was started in. Names the character when `folderName` is absent. */
      cwd?: string;
      /** The module already knows the session is live (its own discovery found it): the character appears now
       *  instead of on the session's next event. */
      live?: boolean;
      /** Label the character starts with, for modules that know a better one than the cwd's last segment. */
      folderName?: string;
      /** The session's place in a team, known when it starts. A teammate announced with its lead sits beside it. */
      team?: TeamMembership;
      /** The machine the session runs on, as a floor id. Absent means the machine the server runs on. Its character
       *  lives on that machine's floor. */
      machineId?: string;
    }
  | { kind: 'sessionEnd'; reason?: string }
  | {
      kind: 'sessionInfo';
      /** Human label for the character, replacing the cwd-derived folder name. */
      name?: string;
      /** One-line description of what the agent is working on. */
      task?: string;
    }
  // ── Turn activity, from a source that sees the turn coarsely: the runtime derives what the office shows ──
  | {
      kind: 'toolStart';
      toolId: string;
      toolName: string;
      input?: unknown;
      /** True when the tool runs in the background and outlives the turn that started it. */
      runInBackground?: boolean;
    }
  | { kind: 'toolEnd'; toolId: string }
  | {
      kind: 'turnEnd';
      /** True when the turn ended because the agent went idle waiting on the user rather than simply finishing its
       *  response. Drives the "Waiting for input" vs "Done" label. Absent/false = the agent finished its turn
       *  (Done). */
      awaitingInput?: boolean;
    }
  /** The agent is busy on a turn and the source cannot say with which tool: a user prompt landed, or a multiplexer
   *  reports the agent working. Makes the character active and withdraws any permission ask. */
  | { kind: 'working' }
  | { kind: 'permissionRequest' }
  // ── Presentation, from a module that tracks the turn itself: each event is one change the office shows ──
  | {
      kind: 'toolShown';
      toolId: string;
      toolName?: string;
      /** Status text, already formatted by the module. */
      status: string;
      /** Whether a permission ask is showing as the tool starts. */
      permissionActive?: boolean;
      /** The tool outlives the turn: a turn-end clear keeps it. */
      runInBackground?: boolean;
      /** The tool spawns a teammate, which gets its own character instead of a sub-agent one. */
      isTeammateSpawn?: boolean;
    }
  | { kind: 'toolDone'; toolId: string }
  /** Every tool that does not run in the background is over. */
  | { kind: 'toolsCleared' }
  | { kind: 'statusChanged'; status: 'active' | 'waiting'; awaitingInput?: boolean }
  | { kind: 'permissionShown' }
  | { kind: 'permissionCleared' }
  | { kind: 'subagentToolShown'; parentToolId: string; toolId: string; status: string }
  | { kind: 'subagentToolDone'; parentToolId: string; toolId: string }
  | { kind: 'subagentPermissionShown'; parentToolId: string }
  /** The sub-agent `parentToolId` spawned is gone, with all its tools. */
  | { kind: 'subagentCleared'; parentToolId: string }
  | { kind: 'teamChanged'; team: TeamMembership }
  | { kind: 'contextUsage'; contextTokens: number; maxContextTokens: number };

// ── Running modules ───────────────────────────────────────────

/** What a running module feeds. One host per module, bound to its id: every event emitted through it is attributed
 *  to that module. */
export interface ModuleHost extends QuotaHost {
  emit(sessionId: string, event: AgentEvent): void;
}

export interface ModuleHandle {
  stop(): void;
}

/** A session a module reported before the server restarted, handed back so the module can resume it. */
export interface RestoredSession {
  /** The `sessionRef` the module announced for it. */
  readonly sessionRef: string;
  /** Its team as last reported, with the lead named by the lead's own `sessionRef`. */
  readonly team?: Omit<TeamMembership, 'leadSessionId'> & { leadSessionRef?: string };
  /** Background tools it still had running. */
  readonly backgroundToolIds: readonly string[];
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
  /** A payload POSTed to `/api/hooks/<module id>`. Absent for CLIs without a hook API: POSTs to their route are
   *  dropped. */
  receiveHook?(payload: Record<string, unknown>): void;
  /** Whether this module's hooks are meant to be delivering. Called once after start and on every change. */
  setHooksEnabled?(enabled: boolean): void;
  /** Resume reporting a session from before a restart, if it is still live. Its `sessionStart` must carry the same
   *  ref: the runtime then gives it back its character. Without this, persisted agents of the module are dropped. */
  restoreSession?(session: RestoredSession): void;
  /** The user closed the character of session `sessionId`: stop reporting it, and do not rediscover it at once. */
  dismissSession?(sessionId: string): void;
}

// ── Agent modules ─────────────────────────────────────────────

/** Hooks written into a third-party settings file. Writing there is consent-gated: the consent gate asks once per
 *  (module, subject) that has one of these, with the subject's own disclosure. A module lists every subject it
 *  writes — Claude's hook entries and its status line are two independent subjects, asked and revised separately —
 *  so nothing is written for a subject until ITS OWN ask is answered `install`. */
export interface HookInstaller {
  /** Stable id of what this installer writes, scoped to the owning module (e.g. 'hooks' | 'statusLine' for Claude).
   *  Echoed on every consent-bearing wire message beside the module's own id, never branched on by value outside
   *  the module that defined it. */
  readonly id: string;
  /** Install this subject's write, POSTing to this server's `/api/hooks/<module id>` where relevant. */
  installHooks(serverUrl: string, authToken: string): Promise<void>;
  uninstallHooks(): Promise<void>;
  areHooksInstalled(): Promise<boolean>;
  /** First-run consent copy for THIS subject's install: the headline titles the ask, the disclosure is its body
   *  (what is written, what data moves, how to undo; paragraphs split on blank lines), and actionLabel is the
   *  consent step's Install button text. Required, not optional: a subject that installs anything must state its
   *  terms, and the gate ships these verbatim so no client copy can drift. */
  consentDisclosure(): { headline: string; disclosure: string; actionLabel: string };
}

export interface AgentModule {
  readonly kind: 'agent';
  readonly id: string;
  readonly displayName: string;
  /** Protocol version. Server refuses to dispatch events from a module whose
   *  version it doesn't understand. Bump on every breaking change to AgentEvent
   *  / AgentModule / RunningAgentModule. */
  readonly protocolVersion: number;

  /** Consent-gated subjects this module writes outside `~/.terrarium/`, asked in array order. Absent/empty when
   *  nothing is written. The running module receives what they POST (`RunningAgentModule.receiveHook`). */
  readonly hooks?: readonly HookInstaller[];
  /** Put the files every subject's hook entries execute in place, from the installed package root. A shared
   *  prerequisite, not one subject's own: callers run it BEFORE any subject's `installHooks` and abort on false —
   *  an entry whose command points at a missing file is worse than no hook. */
  stageHookFiles?(packageRoot: string): boolean;

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
  /** Context window, in tokens, for a model id this CLI reports in its
   *  transcripts. Transcripts state token usage but never the limit it counts
   *  against, so only the module can say, and getting it wrong is visible:
   *  the office renders usage/window as a context gauge over every character.
   *  Return undefined for an unrecognized model. */
  contextWindowForModel?(model: string | undefined): number | undefined;

  /** Start this module's own session discovery. Absent for modules that never report a session on their own. */
  start?(host: ModuleHost): RunningAgentModule;
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

/** Where a multiplexer server lives. `local` is reached through its socket on this machine, `ssh` through an OpenSSH
 *  forward of the remote socket. */
export interface MultiplexerEndpoint {
  /** Unique among the endpoints one process watches. Session ids carry it, so equal pane ids on two servers stay two
   *  agents. */
  readonly id: string;
  readonly kind: 'local' | 'ssh';
  /** SSH destination (`host`, `user@host`, `ssh://user@host:2222`, an SSH config alias). Set for `ssh` only. */
  readonly target?: string;
  /** Named multiplexer session. Absent means the multiplexer's default session. */
  readonly session?: string;
}

/** How a watched endpoint is doing. `connected` once the multiplexer answered, `reconnecting` after a connection that
 *  worked was lost, `error` when an attempt failed. Both of the last two keep retrying in the background. */
export type MultiplexerLinkState = 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface MultiplexerWatcher {
  /** The full list of live agents, every time it may have changed. An agent missing from a snapshot has ended. Never
   *  called with an empty list for a multiplexer that did not answer. Counts only while the link is `connected`: a
   *  snapshot that arrives after the link was lost is ignored. */
  onSnapshot(agents: readonly MultiplexedAgent[]): void;
  /** `message` is the SSH or multiplexer error text, for `error` and `reconnecting`. */
  onState(state: MultiplexerLinkState, message?: string): void;
  log(message: string): void;
}

export interface MultiplexerModule {
  readonly kind: 'multiplexer';
  readonly id: string;
  readonly displayName: string;
  /** Watch the multiplexer at `endpoint` until the handle is stopped. Stopping ends every process it started. */
  connect(endpoint: MultiplexerEndpoint, watcher: MultiplexerWatcher): ModuleHandle;
  /** One request/answer round-trip with the multiplexer at `endpoint`, holding nothing open afterwards. Resolves with
   *  the SSH or multiplexer error text, or undefined when it answered. */
  probe(endpoint: MultiplexerEndpoint): Promise<string | undefined>;
}

// ── Quota sources ─────────────────────────────────────────────

/** How much of a quota is used: a share the provider computed, or an amount against a limit. An amount may carry the
 *  provider's own share beside it when the two are read at different times: the share is then the one shown. */
export type QuotaUsage =
  | { readonly kind: 'fraction'; readonly usedFraction: number }
  | {
      readonly kind: 'amount';
      readonly usedAmount: number;
      readonly limitAmount: number;
      readonly unit: QuotaUnit;
      readonly usedFraction?: number;
    };

/** One reading of one quota meter, as its source saw it. */
export interface QuotaReading {
  /** Unique within the reporting module ('five_hour', 'month', ...). A new reading replaces the last one. */
  readonly meterId: string;
  /** What the office shows for the meter ('Claude · 5h'). */
  readonly label: string;
  /** Null when the source cannot read the meter (no credentials, an expired session): shown as unavailable, never as
   *  empty or full. */
  readonly usage: QuotaUsage | null;
  /** Epoch ms when the provider resets the meter. The reading goes stale then: it belongs to an ended window. */
  readonly resetsAt?: number;
  /** Epoch ms when the source took the reading. */
  readonly observedAt: number;
  /** How long the reading counts as fresh: the interval the source expects to report in. */
  readonly staleAfterMs: number;
}

/** What a quota source reports to. Push or poll is the source's choice: the runtime keeps the latest reading of each
 *  meter and broadcasts it. */
export interface QuotaHost {
  reportQuota(reading: QuotaReading): void;
  log(message: string): void;
}

export interface QuotaSourceModule {
  readonly kind: 'quota';
  readonly id: string;
  readonly displayName: string;
  /** Start reading quotas until the handle is stopped. */
  start(host: QuotaHost): ModuleHandle;
}

export type ProviderModule = AgentModule | MultiplexerModule | QuotaSourceModule;
