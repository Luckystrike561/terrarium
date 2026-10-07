import * as fs from 'fs';
import * as path from 'path';

import type { AgentEvent, AgentModule, ProviderModule } from '../../core/src/provider.js';
import type { AgentStateStore } from './agentStateStore.js';
import { SESSION_END_GRACE_MS } from './constants.js';
import { pathsMatch } from './pathKey.js';
import type { ModuleSet } from './providers/index.js';
import type { PendingExternalSession, RoutedEvent, SessionRouter } from './sessionRouter.js';
import { getInlineTeammates, hasInlineTeammates, hasPromotedBackgroundAgent } from './teamUtils.js';
import { cancelPermissionTimer, cancelWaitingTimer } from './timerManager.js';
import { notifyBackgroundAgentCompleted } from './transcriptParser.js';
import type { AgentState } from './types.js';

const debug = process.env.PIXEL_AGENTS_DEBUG !== '0';

/** Normalized hook event received from any provider's hook script via the HTTP server. */
export interface HookEvent {
  /** Hook event name (e.g., 'Stop', 'PermissionRequest', 'Notification') */
  hook_event_name: string;
  /** Claude Code session ID, maps to JSONL filename */
  session_id: string;
  /** Additional provider-specific fields (notification_type, tool_name, etc.) */
  [key: string]: unknown;
}

/**
 * Dispatches normalized AgentEvents to agents based on session_id.
 * Session routing (session→agent mapping, pending sessions, event buffering)
 * is delegated to an injected SessionRouter instance.
 *
 * When an event is successfully delivered, sets `agent.hookDelivered = true` which
 * suppresses heuristic timers (permission 7s, text-idle 5s) for that agent.
 */
/** Callback for session lifecycle events detected via hooks. */
interface SessionLifecycleCallbacks {
  /** Called when an announced session is confirmed (its first event after SessionStart) and no agent reports its
   *  session file yet. The host decides whether to adopt it. */
  onExternalSessionDetected?: (pending: PendingExternalSession) => void;
  /** Called when /clear is detected via hooks (SessionEnd reason=clear + SessionStart source=clear). */
  onSessionClear?: (
    agentId: number,
    newSessionId: string,
    newTranscriptPath: string | undefined,
  ) => void;
  /** Called when a session is resumed (--resume). Clears dismissals so the file can be re-adopted. */
  onSessionResume?: (transcriptPath: string) => void;
  /** Called when a session ends (exit/logout). */
  onSessionEnd?: (agentId: number, reason: string) => void;
  /** Called when an Agent Teams teammate is detected via SubagentStart hook.
   *  Triggers scanning of the session's subagents/ directory for the teammate's JSONL. */
  onTeammateDetected?: (parentAgentId: number, sessionId: string, agentType: string) => void;
  /** Called when a teammate should be removed (e.g. no longer in team config members).
   *  Removes the teammate agent from the office. */
  onTeammateRemoved?: (teammateAgentId: number) => void;
}

export class HookEventHandler {
  private lifecycleCallbacks: SessionLifecycleCallbacks = {};

  /** Highest AgentModule.protocolVersion this handler understands. */
  private static readonly SUPPORTED_PROTOCOL_VERSION = 1;

  private readonly modulesById: ReadonlyMap<string, ProviderModule>;
  /** The agent module whose transcripts the runtime's own parser reads. Agents its scanners adopt carry no
   *  providerId, so this is their module. */
  private readonly transcriptModule: AgentModule | undefined;

  constructor(
    private agents: AgentStateStore,
    private waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
    private permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
    modules: ModuleSet,
    private sessionRouter: SessionRouter,
    private watchAllSessionsRef?: { current: boolean },
  ) {
    this.modulesById = new Map(
      [...modules.agents, ...modules.multiplexers].map((m) => [m.id, m] as const),
    );
    this.transcriptModule = modules.agents.find((m) => m.getSessionDirs !== undefined);
    for (const module of modules.agents) {
      if (module.protocolVersion !== HookEventHandler.SUPPORTED_PROTOCOL_VERSION) {
        console.warn(
          `[Pixel Agents] Module "${module.id}" reports protocolVersion=${module.protocolVersion}, ` +
            `but handler understands ${HookEventHandler.SUPPORTED_PROTOCOL_VERSION}. ` +
            `Events from this module will be dropped.`,
        );
      }
    }
  }

  /** The enabled module named `id` when it may feed events, or undefined: unknown, disabled, or speaking another
   *  protocol version (already reported at construction). */
  private sourceModule(id: string): ProviderModule | undefined {
    const module = this.modulesById.get(id);
    if (
      module?.kind === 'agent' &&
      module.protocolVersion !== HookEventHandler.SUPPORTED_PROTOCOL_VERSION
    ) {
      return undefined;
    }
    return module;
  }

  /** The agent module that owns an agent's vocabulary, or undefined for an agent only a multiplexer reports. */
  private agentModuleOf(agent: AgentState): AgentModule | undefined {
    const module =
      agent.providerId === undefined
        ? this.transcriptModule
        : this.modulesById.get(agent.providerId);
    return module?.kind === 'agent' ? module : undefined;
  }

  /** Merged set of tool names that spawn subagents (teammates + within-turn subagents
   *  when a team provider is attached, or the module's base set otherwise). */
  private getSubagentToolSet(module: AgentModule | undefined): ReadonlySet<string> {
    if (module?.team) {
      return new Set<string>([
        ...module.team.teammateSpawnTools,
        ...module.team.withinTurnSubagentTools,
      ]);
    }
    return module?.subagentToolNames ?? new Set();
  }

  /** Check if a session is tracked (in workspace project dir, or Watch All Sessions ON). */
  private isTrackedSession(transcriptPath?: string, cwd?: string): boolean {
    if (this.watchAllSessionsRef?.current) return true;
    const projectDir = transcriptPath ? path.dirname(transcriptPath) : cwd;
    if (!projectDir) return false;
    return [...this.agents.values()].some(
      (a) => path.resolve(a.projectDir).toLowerCase() === path.resolve(projectDir).toLowerCase(),
    );
  }

  /**
   * Route `sessionId` to the agent already reporting the same session file, when another module announced it: a
   * multiplexer pane and the agent module reporting the same session are one agent, one character. Returns whether
   * an agent claimed the session.
   *
   * A module-announced `sessionFile` matches either kind of agent; a bare `transcriptPath` (Claude's hooks) only
   * matches agents a module announced, so two Claude reports of one transcript keep their existing routing.
   */
  private claimBySessionFile(
    sessionId: string,
    sessionFile: string | undefined,
    transcriptPath: string | undefined,
  ): boolean {
    for (const [id, agent] of this.agents) {
      const announced = agent.sessionFile;
      const matches = sessionFile
        ? (announced !== undefined && pathsMatch(announced, sessionFile)) ||
          (agent.jsonlFile !== '' && pathsMatch(agent.jsonlFile, sessionFile))
        : transcriptPath !== undefined &&
          announced !== undefined &&
          pathsMatch(announced, transcriptPath);
      if (!matches) continue;
      if (debug)
        console.log(
          `[Pixel Agents] Hook: session ${sessionId.slice(0, 8)}... reports Agent ${id}'s session file, routing to it`,
        );
      this.registerAgent(sessionId, id);
      return true;
    }
    return false;
  }

  /** Set callbacks for session lifecycle events (SessionStart/SessionEnd). */
  setLifecycleCallbacks(callbacks: SessionLifecycleCallbacks): void {
    this.lifecycleCallbacks = callbacks;
  }

  /** Register an agent for hook event routing. Flushes any buffered events for this session. */
  registerAgent(sessionId: string, agentId: number): void {
    const flushed = this.sessionRouter.register(sessionId, agentId);
    if (debug && flushed.length > 0)
      console.log(
        `[Pixel Agents] Hook: flushing ${flushed.length} buffered event(s) for session ${sessionId.slice(0, 8)}...`,
      );
    for (const routed of flushed) {
      this.dispatch(routed);
    }
  }

  /** Remove an agent's session mapping (called on agent removal/terminal close). */
  unregisterAgent(sessionId: string): void {
    this.sessionRouter.unregister(sessionId);
  }

  /**
   * Process a payload POSTed to `/api/hooks/<providerId>`: normalized by that module and no other, whichever
   * modules are enabled beside it. A route naming no enabled module, or one without a hook API, is dropped.
   *
   * All raw CLI-specific fields (tool_name, tool_input, agent_type, teammate_name, task_subject,
   * notification_type, reason, source) are extracted by the module's normalizeHookEvent. Downstream dispatch uses
   * the normalized AgentEvent.kind; the raw payload rides along only for the team handlers' identity fields.
   */
  handleEvent(providerId: string, event: HookEvent): void {
    const module = this.sourceModule(providerId);
    if (module?.kind !== 'agent' || !module.normalizeHookEvent) return;
    const normalized = module.normalizeHookEvent(event);
    if (!normalized) return; // unknown / uninteresting event -- silently drop
    this.dispatch({
      sourceId: providerId,
      sessionId: event.session_id,
      event: normalized.event,
      raw: event,
    });
  }

  /** Process an event a running module emitted in-process (already normalized). */
  handleAgentEvent(sourceId: string, sessionId: string, event: AgentEvent): void {
    if (!this.sourceModule(sourceId)) return;
    this.dispatch({
      sourceId,
      sessionId,
      event,
      raw: { session_id: sessionId, hook_event_name: event.kind },
    });
  }

  /**
   * Looks up the agent by session_id, falls back to auto-discovery scan, or buffers if agent not yet registered.
   */
  private dispatch(routed: RoutedEvent): void {
    const { sourceId, event: normEvent } = routed;
    const event = routed.raw as HookEvent;
    const eventName = event.hook_event_name; // retained for logs only
    const sourceModule = this.modulesById.get(sourceId);
    // CI / e2e diagnostic: see agentStateStore.ts debugLogBroadcast comment.
    const debugLog = process.env['PIXEL_AGENTS_DEBUG_LOG'];
    if (debugLog) {
      try {
        const extras = normEvent.kind === 'toolStart' ? ` toolName=${normEvent.toolName}` : '';
        const startSource = normEvent.kind === 'sessionStart' ? (normEvent.source ?? '') : '';
        fs.appendFileSync(
          debugLog,
          `${new Date().toISOString()} HOOK kind=${normEvent.kind} sid=${routed.sessionId.slice(0, 8)} src=${startSource}${extras} module=${sourceId}\n`,
        );
      } catch {
        /* never crash on diagnostic failure */
      }
    }

    // --- SessionStart: handle /clear for known agents, ignore unknown sessions ---
    // External session detection via SessionStart is deferred to Phase C.
    // For now, only use SessionStart for:
    //   1. Confirming known agents (set hookDelivered)
    //   2. /clear reassignment (source=clear + pendingClear agent)
    if (normEvent.kind === 'sessionStart') {
      const sid = event.session_id.slice(0, 8);
      const source = normEvent.source ?? 'unknown';
      const transcriptPath = normEvent.transcriptPath;
      const cwd = normEvent.cwd;
      const tracked = this.isTrackedSession(transcriptPath, cwd);
      if (debug && tracked)
        console.log(`[Pixel Agents] Hook: SessionStart(source=${source}, session=${sid}...)`);

      // Check registered mapping
      const existingAgentId = this.sessionRouter.resolve(event.session_id);
      if (existingAgentId !== undefined) {
        const agent = this.agents.get(existingAgentId);
        if (agent && sourceModule?.kind === 'agent') {
          agent.hookDelivered = true;
        }
        if (debug)
          console.log(
            `[Pixel Agents] Hook: Agent ${existingAgentId} - SessionStart(source=${source}) known`,
          );
        return;
      }
      // Check auto-discovery (agent exists but not yet registered for hooks)
      for (const [id, agent] of this.agents) {
        if (agent.sessionId === event.session_id) {
          this.registerAgent(agent.sessionId, id);
          agent.hookDelivered = true;
          if (debug)
            console.log(
              `[Pixel Agents] Hook: Agent ${id} - SessionStart(source=${source}) auto-discovered`,
            );
          return;
        }
      }
      if (this.claimBySessionFile(event.session_id, normEvent.sessionFile, transcriptPath)) return;
      // /clear or /resume: reassign existing agent to new session
      if (normEvent.source === 'clear' || normEvent.source === 'resume') {
        const projectDir = transcriptPath ? path.dirname(transcriptPath) : cwd;
        if (projectDir) {
          for (const [id, agent] of this.agents) {
            // Both /clear and /resume send SessionEnd first (sets pendingClear),
            // then SessionStart. Match the agent that has pendingClear in same project dir.
            // Normalize paths for cross-platform comparison (separators + case-insensitive
            // for Windows where drive letter casing differs: c:\ vs C:\).
            const isMatch =
              agent.pendingClear &&
              path.resolve(agent.projectDir).toLowerCase() ===
                path.resolve(projectDir).toLowerCase();
            if (isMatch) {
              agent.pendingClear = false;
              console.log(
                `[Pixel Agents] Hook: Agent ${id} - /${normEvent.source} detected, reassigning to ${event.session_id}`,
              );
              this.sessionRouter.unregister(agent.sessionId);
              this.registerAgent(event.session_id, id);
              this.lifecycleCallbacks.onSessionClear?.(id, event.session_id, transcriptPath);
              return;
            }
          }
        }
      }
      // Unknown session -- store as pending, create only when a confirmation event
      // arrives (Stop, Notification, PermissionRequest). This filters transient sessions
      // from Claude Code Extension which fire SessionStart + SessionEnd without any activity.
      if (transcriptPath || cwd || normEvent.sessionFile || sourceModule?.kind === 'multiplexer') {
        // For --resume, clear dismissals so the file can be re-adopted
        if (normEvent.source === 'resume' && transcriptPath) {
          this.lifecycleCallbacks.onSessionResume?.(transcriptPath);
        }
        if (debug && tracked)
          console.log(
            `[Pixel Agents] Hook: SessionStart(source=${source}) -> pending external session ${sid}..., awaiting confirmation`,
          );
        this.sessionRouter.storePending(event.session_id, {
          sessionId: event.session_id,
          transcriptPath,
          sessionFile: normEvent.sessionFile,
          cwd: cwd ?? '',
          sourceIds: [sourceId],
        });
      } else {
        if (debug && tracked)
          console.log(
            `[Pixel Agents] Hook: SessionStart -> unknown session ${sid}..., no transcript_path`,
          );
      }
      return;
    }

    // --- All other events: standard agent lookup ---
    // If SessionEnd arrives for a pending external session, discard it (transient session)
    if (normEvent.kind === 'sessionEnd' && this.sessionRouter.hasPending(event.session_id)) {
      this.sessionRouter.discardPending(event.session_id);
      if (debug)
        console.log(
          `[Pixel Agents] Hook: SessionEnd discarded pending external session ${event.session_id.slice(0, 8)}...`,
        );
      return;
    }

    // If a confirmation event arrives for a pending external session, create the agent first
    const pending = this.sessionRouter.confirmPending(event.session_id);
    if (pending) {
      if (debug)
        console.log(
          `[Pixel Agents] Hook: ${eventName} confirmed external session ${event.session_id.slice(0, 8)}..., notifying host`,
        );
      // A module reporting a session another module already put on screen joins that character.
      if (
        !this.claimBySessionFile(pending.sessionId, pending.sessionFile, pending.transcriptPath)
      ) {
        this.lifecycleCallbacks.onExternalSessionDetected?.(pending);
      }
      // Re-process this event now that the agent exists
      this.dispatch(routed);
      return;
    }

    let agentId = this.sessionRouter.resolve(event.session_id);
    if (agentId === undefined) {
      for (const [id, agent] of this.agents) {
        if (agent.sessionId === event.session_id) {
          this.registerAgent(agent.sessionId, id);
          agentId = id;
          break;
        }
      }
    }
    if (agentId === undefined) {
      // Buffer if: pending external session, already buffering for this session,
      // OR agents exist that haven't been registered yet (internal agent race:
      // hook event arrives before registerAgent is called after launchNewTerminal).
      // Silently drop events for sessions we have no record of
      // (e.g. other projects with Watch All OFF).
      const isPending = this.sessionRouter.hasPending(event.session_id);
      const hasBuffered = this.sessionRouter.hasBuffered(event.session_id);
      const hasUnregisteredAgents = [...this.agents.values()].some(
        (a) => a.sessionId && !this.sessionRouter.hasSession(a.sessionId),
      );
      if (isPending || hasBuffered || hasUnregisteredAgents) {
        if (debug)
          console.log(
            `[Pixel Agents] Hook: ${eventName} - unknown session ${event.session_id.slice(0, 8)}..., buffering`,
          );
        this.sessionRouter.bufferEvent(routed);
      }
      return;
    }

    const agent = this.agents.get(agentId);
    if (!agent) return;

    // A multiplexer's status reports are not hooks: they must not silence the heuristic timers of an agent its own
    // module watches. The first event from an agent module names the agent's vocabulary.
    if (sourceModule?.kind === 'agent') {
      agent.hookDelivered = true;
      agent.providerId = sourceModule.id;
    }
    const module = this.agentModuleOf(agent);
    if (debug)
      console.log(
        `[Pixel Agents] Hook: Agent ${agentId} - ${eventName} (session=${event.session_id.slice(0, 8)}...)`,
      );

    // Dispatch on normalized AgentEvent.kind, not raw hook event names.
    // The TeammateIdle / TaskCompleted hooks normalize to `subagentTurnEnd` -- both
    // retain their raw payload for the team-routing handler's identity extraction.
    switch (normEvent.kind) {
      case 'sessionEnd':
        return this.handleSessionEnd(normEvent, agent, agentId);
      case 'toolStart':
        return this.handlePreToolUse(normEvent, agent, agentId, module);
      case 'toolEnd':
        // Both PostToolUse and PostToolUseFailure normalize to toolEnd. Distinguishing
        // them inside handlers would require extra info; the existing behavior was
        // identical for both (agentToolDone + clear currentHookToolId), so one branch suffices.
        return this.handlePostToolUse(agent, agentId);
      case 'subagentStart':
        return module?.team ? this.handleSubagentStart(event, agent, agentId, module) : undefined;
      case 'subagentEnd':
        return module?.team ? this.handleSubagentStop(agent, agentId) : undefined;
      case 'permissionRequest':
        // Handles BOTH the PermissionRequest hook AND the Notification(permission_prompt)
        // hook -- normalizeHookEvent collapses them into one event kind.
        return this.handlePermissionRequest(agent, agentId);
      case 'working':
        return this.handleWorking(agent, agentId);
      case 'turnEnd':
        // Handles Stop AND Notification(idle_prompt) -- both normalize to turnEnd.
        // awaitingInput discriminates them: idle_prompt sets it (-> "Waiting for
        // input"), Stop leaves it absent (-> "Done").
        return this.handleStop(agent, agentId, normEvent.awaitingInput === true);
      case 'subagentTurnEnd':
        // Handles TeammateIdle AND TaskCompleted -- both normalize here. The normalized
        // `reason` field discriminates; the team-provider's extractTeammateNameFromEvent(raw)
        // still routes to the specific teammate. (TaskCreated normalizes to null in the provider.)
        if (!module?.team) return;
        if (normEvent.reason === 'completed') {
          return this.handleTaskCompleted(event, agentId, module);
        }
        return this.handleTeammateIdle(event, agent, agentId, module);
      case 'progress':
        // Not yet consumed by the office visualization. Silently drop.
        return;
      case 'sessionInfo':
        return this.handleSessionInfo(normEvent, agent, agentId);
    }
  }

  /**
   * Handle SessionEnd: /clear marks pendingClear (SessionStart follows),
   * exit/logout marks agent waiting or triggers cleanup.
   */
  private handleSessionEnd(
    normEvent: Extract<AgentEvent, { kind: 'sessionEnd' }>,
    agent: AgentState,
    agentId: number,
  ): void {
    const reason = normEvent.reason;
    if (debug)
      console.log(
        `[Pixel Agents] Hook: Agent ${agentId} - SessionEnd(reason=${reason ?? 'unknown'})`,
      );

    // /clear and /resume send SessionEnd then SessionStart. Wait briefly for the follow-up.
    // All other reasons (exit, logout, prompt_input_exit) are final -- despawn immediately.
    const expectsFollowUp = reason === 'clear' || reason === 'resume';

    if (expectsFollowUp) {
      agent.pendingClear = true;
      this.markAgentWaiting(agent, agentId);
      if (debug)
        console.log(
          `[Pixel Agents] Hook: Agent ${agentId} - SessionEnd(reason=${reason}), awaiting possible SessionStart`,
        );
      // Safety net: if SessionStart never arrives, clean up the zombie agent
      setTimeout(() => {
        if (agent.pendingClear) {
          agent.pendingClear = false;
          this.lifecycleCallbacks.onSessionEnd?.(agentId, reason);
        }
      }, SESSION_END_GRACE_MS);
    } else {
      // Immediate cleanup for exit/logout. onSessionEnd → removeTeammates in the
      // ViewProvider cleans up all teammates of this lead at once.
      this.markAgentWaiting(agent, agentId);
      this.lifecycleCallbacks.onSessionEnd?.(agentId, reason ?? 'unknown');
    }
  }

  /**
   * Handle PreToolUse: instantly mark agent as active (cancel waiting state).
   * JSONL still handles detailed tool tracking (toolId, status text, webview messages).
   * This just ensures the character starts animating without waiting for the 500ms JSONL poll.
   */
  private handlePreToolUse(
    normEvent: Extract<AgentEvent, { kind: 'toolStart' }>,
    agent: AgentState,
    agentId: number,
    module: AgentModule | undefined,
  ): void {
    const toolName = normEvent.toolName;
    const toolInput = (normEvent.input as Record<string, unknown> | undefined) ?? {};
    const status = module?.formatToolStatus(toolName, toolInput) ?? toolName;
    const hookToolId = `hook-${Date.now()}`;

    // Track for PostToolUse/SubagentStart correlation (always, even if suppressed below).
    // currentHookIsTeammateSpawn is the authoritative teammate-vs-subagent discriminator.
    // It is NOT cleared in PostToolUse to survive the PostToolUse-before-SubagentStart race.
    agent.currentHookToolId = hookToolId;
    agent.currentHookToolName = toolName;
    agent.currentHookIsTeammateSpawn =
      module?.team?.isTeammateSpawnCall(toolName, toolInput) ?? false;

    // When a lead has inline teammates, hook tool events are ambiguous (could be
    // from the lead or any teammate -- they share session_id). Suppress hook-originated
    // tool display on the lead. Both lead and teammate tools display via JSONL polling.
    if (hasInlineTeammates(agentId, this.agents)) return;

    // Cancel waiting, mark active
    cancelWaitingTimer(agentId, this.waitingTimers);
    agent.isWaiting = false;
    agent.permissionSent = false;
    agent.hadToolsInTurn = true;

    // Send tool start + active state to webview (instant, no 500ms JSONL delay).
    // Skip for sub-agent spawns — their sub-agent characters need the stable JSONL
    // tool ID (not the transient hook ID) so that SubagentStop/tool_result cleanup
    // can find and remove them. JSONL handles agentToolStart (with runInBackground)
    // for these tools.
    if (!module?.subagentToolNames.has(toolName)) {
      this.agents.broadcast({
        type: 'agentToolStart',
        id: agentId,
        toolId: hookToolId,
        status,
        toolName,
      });
    }
    this.agents.broadcast({
      type: 'agentStatus',
      id: agentId,
      status: 'active',
    });
  }

  /** Handle working: a turn is under way with no tool known (a prompt landed, or a multiplexer reports the agent
   *  busy). Active again, and any approval it was waiting on is no longer pending. */
  private handleWorking(agent: AgentState, agentId: number): void {
    cancelWaitingTimer(agentId, this.waitingTimers);
    cancelPermissionTimer(agentId, this.permissionTimers);
    agent.isWaiting = false;
    if (agent.permissionSent) {
      agent.permissionSent = false;
      this.agents.broadcast({ type: 'agentToolPermissionClear', id: agentId });
    }
    this.agents.broadcast({ type: 'agentStatus', id: agentId, status: 'active' });
  }

  /**
   * Handle PostToolUse: no action needed. JSONL handles tool_result processing.
   * Stop hook handles the idle transition. This is here for completeness and
   * to serve as a confirmation event for pending external sessions.
   */
  private handlePostToolUse(agent: AgentState, agentId: number): void {
    if (agent.currentHookToolId) {
      // Suppress tool display when lead has inline teammates (see handlePreToolUse)
      if (!hasInlineTeammates(agentId, this.agents)) {
        this.agents.broadcast({
          type: 'agentToolDone',
          id: agentId,
          toolId: agent.currentHookToolId,
        });
      }
      agent.currentHookToolId = undefined;
      agent.currentHookToolName = undefined;
    }
  }

  // NOTE: PostToolUseFailure used to have its own handler. The behavior was identical
  // to PostToolUse (emit agentToolDone, clear currentHookToolId). Both now normalize to
  // the 'toolEnd' AgentEvent kind and share handlePostToolUse.

  /**
   * Handle SubagentStart: notify webview that a sub-agent is spawning.
   *
   * For Agent Teams teammates (Agent tool with run_in_background), triggers
   * teammate discovery via lifecycle callback -- teammates become independent
   * agents with their own JSONL file watching.
   *
   * For old-style Task/Agent subagents (inline, no run_in_background), creates
   * the child character immediately via hooks without waiting for JSONL polling.
   */
  private handleSubagentStart(
    event: HookEvent,
    agent: AgentState,
    agentId: number,
    module: AgentModule,
  ): void {
    const agentType = module.team?.extractTeammateNameFromEvent(event) ?? 'unknown';

    // Decide path: teammate spawn vs basic within-turn subagent.
    // Two conditions must BOTH hold for the teammate path:
    //   1. currentHookIsTeammateSpawn === true -- this specific tool call has the
    //      teammate-spawn flag (e.g. Agent with run_in_background=true)
    //   2. agent.teamName set -- JSONL has confirmed this agent is a team lead.
    //      Without this guard, external sessions firing run_in_background=true
    //      for parallel basic subagents would be mis-routed to teammate discovery.
    // Mirrors the same gate used by the periodic scanAllTeammateFiles fallback.
    if (module.team && agent.currentHookIsTeammateSpawn === true && agent.teamName) {
      if (debug)
        console.log(
          `[Pixel Agents] Hook: Agent ${agentId} - SubagentStart: teammate "${agentType}" detected, triggering discovery`,
        );
      this.lifecycleCallbacks.onTeammateDetected?.(agentId, event.session_id, agentType);
      return;
    }

    // Basic within-turn subagent path: find parent tool ID from activeToolNames.
    // Use only the real JSONL-populated id -- no synthetic fallback here, or we'd
    // double-track parents once JSONL catches up.
    const parentTools = this.getSubagentToolSet(module);
    let parentToolId: string | undefined;
    for (const [toolId, toolName] of agent.activeToolNames) {
      if (parentTools.has(toolName)) {
        parentToolId = toolId;
        break;
      }
    }
    if (!parentToolId) return; // JSONL will handle it via agent_progress tool_use

    // Create child sub-agent character immediately (same as old behavior).
    const subToolId = `hook-sub-${agentType}-${Date.now()}`;
    const status = `Subtask: ${agentType}`;

    // Track sub-agent
    let subTools = agent.activeSubagentToolIds.get(parentToolId);
    if (!subTools) {
      subTools = new Set();
      agent.activeSubagentToolIds.set(parentToolId, subTools);
    }
    subTools.add(subToolId);

    let subNames = agent.activeSubagentToolNames.get(parentToolId);
    if (!subNames) {
      subNames = new Map();
      agent.activeSubagentToolNames.set(parentToolId, subNames);
    }
    subNames.set(subToolId, agentType);

    this.agents.broadcast({
      type: 'subagentToolStart',
      id: agentId,
      parentToolId,
      toolId: subToolId,
      status,
    });
  }

  /**
   * Handle SubagentStop: notify webview that a sub-agent finished.
   *
   * For Agent Teams teammates: marks all teammate agents as waiting (they're
   * independent agents, not sub-agent characters to destroy).
   *
   * For old-style Task subagents: removes the child character from the office.
   */
  private handleSubagentStop(agent: AgentState, agentId: number): void {
    // Check if this agent has inline teammates (independent agents with leadAgentId).
    // Just mark them waiting -- SubagentStop fires per-task-iteration; teammates may
    // sit idle for minutes between lead requests before being re-invoked.
    // Actual removal is driven by:
    //   - Periodic team config polling (scanTeamConfigsForRemovals) -- teammate
    //     removed when no longer in team config members list
    //   - SessionEnd on lead (removeTeammates in ViewProvider)
    const inlineTeammates = getInlineTeammates(agentId, this.agents);
    if (inlineTeammates.length > 0) {
      if (debug)
        console.log(
          `[Pixel Agents] Hook: Agent ${agentId} - SubagentStop: marking inline teammates as waiting`,
        );
      for (const [id, a] of inlineTeammates) {
        this.markAgentWaiting(a, id);
      }
      return;
    }

    // Old-style within-turn subagents: find a parent tool that actually has tracked
    // sub-agents. The `activeSubagentToolIds.has(toolId)` gate below prevents us
    // from picking a subagent-spawning parent that already had its sub-agents
    // cleared in the same turn.
    const subagentParentTools = this.getSubagentToolSet(this.agentModuleOf(agent));
    let parentToolId: string | undefined;
    for (const [toolId, toolName] of agent.activeToolNames) {
      if (subagentParentTools.has(toolName) && agent.activeSubagentToolIds.has(toolId)) {
        parentToolId = toolId;
        break;
      }
    }
    if (!parentToolId) return; // JSONL will handle it via agent_progress tool_result

    agent.activeSubagentToolIds.delete(parentToolId);
    agent.activeSubagentToolNames.delete(parentToolId);
    this.agents.broadcast({
      type: 'subagentClear',
      id: agentId,
      parentToolId,
    });
  }

  /** Handle PermissionRequest: cancel heuristic timer, show permission bubble on agent + sub-agents. */
  private handlePermissionRequest(agent: AgentState, agentId: number): void {
    // When lead has inline teammates, route permission to the teammates instead.
    // The hook fires on the lead's session_id but the permission is for a teammate.
    const inlineTeammates = getInlineTeammates(agentId, this.agents);
    if (inlineTeammates.length > 0) {
      for (const [id, a] of inlineTeammates) {
        cancelPermissionTimer(id, this.permissionTimers);
        a.permissionSent = true;
        this.agents.broadcast({ type: 'agentToolPermission', id });
      }
      return;
    }

    cancelPermissionTimer(agentId, this.permissionTimers);
    agent.permissionSent = true;
    this.agents.broadcast({
      type: 'agentToolPermission',
      id: agentId,
    });
    // Also notify any sub-agents with active tools
    for (const parentToolId of agent.activeSubagentToolNames.keys()) {
      this.agents.broadcast({
        type: 'subagentToolPermission',
        id: agentId,
        parentToolId,
      });
    }
  }

  private handleSessionInfo(
    event: { name?: string; task?: string },
    agent: AgentState,
    agentId: number,
  ): void {
    if (event.name !== undefined) agent.folderName = event.name;
    if (event.task !== undefined) agent.task = event.task;
    this.agents.broadcast({ type: 'agentInfo', id: agentId, name: event.name, task: event.task });
  }

  /** Handle Stop: Claude finished responding, mark agent as waiting. */
  private handleStop(agent: AgentState, agentId: number, awaitingInput = false): void {
    this.markAgentWaiting(agent, agentId, awaitingInput);
  }

  /**
   * Handle TeammateIdle: teammate signaled it's idle and available for work.
   * Routes to the specific teammate if identifiable by teammate_name, otherwise
   * marks all inline teammates of this lead as waiting.
   * Fallback: if the agent has no inline teammates, mark the agent itself.
   */
  private handleTeammateIdle(
    event: HookEvent,
    agent: AgentState,
    agentId: number,
    module: AgentModule,
  ): void {
    const teammateName = module.team?.extractTeammateNameFromEvent(event);
    const inlineTeammates = getInlineTeammates(agentId, this.agents);

    if (inlineTeammates.length === 0) {
      // No inline teammates — treat as a completed turn for this agent.
      this.markAgentWaiting(agent, agentId);
      return;
    }

    // Match by agentName if provider extracted a name from the event
    if (teammateName) {
      const match = inlineTeammates.find(([, a]) => a.agentName === teammateName);
      if (match) {
        const [id, a] = match;
        if (debug)
          console.log(
            `[Pixel Agents] Hook: TeammateIdle "${teammateName}" -> teammate Agent ${id}`,
          );
        this.markAgentWaiting(a, id);
        return;
      }
    }

    // Fallback: mark all inline teammates as waiting
    if (debug)
      console.log(
        `[Pixel Agents] Hook: TeammateIdle (no teammate_name match) -> marking ${inlineTeammates.length} teammate(s) done`,
      );
    for (const [id, a] of inlineTeammates) {
      this.markAgentWaiting(a, id);
    }
  }

  /**
   * Handle TaskCompleted: a teammate marked its task done.
   * Routes to the specific teammate when identifiable, marking it waiting instantly.
   */
  private handleTaskCompleted(event: HookEvent, agentId: number, module: AgentModule): void {
    const taskSubject =
      typeof event.task_subject === 'string'
        ? event.task_subject
        : typeof event.subject === 'string'
          ? event.subject
          : '';
    const teammateName = module.team?.extractTeammateNameFromEvent(event);
    if (debug)
      console.log(
        `[Pixel Agents] Hook: Agent ${agentId} - TaskCompleted: ${taskSubject}${teammateName ? ` (teammate_name=${teammateName})` : ''}`,
      );

    const inlineTeammates = getInlineTeammates(agentId, this.agents);
    if (inlineTeammates.length === 0) return;

    // Match by agentName if available, otherwise mark all inline teammates waiting
    if (teammateName) {
      const match = inlineTeammates.find(([, a]) => a.agentName === teammateName);
      if (match) {
        const [id, a] = match;
        this.markAgentWaiting(a, id);
        return;
      }
    }
    for (const [id, a] of inlineTeammates) {
      this.markAgentWaiting(a, id);
    }
  }

  /**
   * Transition agent to waiting state. Clears foreground tools (preserves background
   * agents), cancels timers, and notifies the webview. Same logic as the turn_duration
   * handler in transcriptParser.ts.
   */
  private markAgentWaiting(agent: AgentState, agentId: number, awaitingInput = false): void {
    cancelWaitingTimer(agentId, this.waitingTimers);
    cancelPermissionTimer(agentId, this.permissionTimers);

    // Clear foreground tools, preserve background agents (same logic as turn_duration handler).
    // ALWAYS send agentToolsClear at turn end -- even when activeToolIds is empty by now
    // (because tool_results already processed and removed them). Without this, stale
    // sub-agent characters and permission bubbles from the turn would never clear.
    const parentTools = this.getSubagentToolSet(this.agentModuleOf(agent));
    for (const toolId of [...agent.activeToolIds]) {
      if (agent.backgroundAgentToolIds.has(toolId)) continue;
      agent.activeToolIds.delete(toolId);
      agent.activeToolStatuses.delete(toolId);
      const toolName = agent.activeToolNames.get(toolId);
      agent.activeToolNames.delete(toolId);
      if (toolName && parentTools.has(toolName)) {
        agent.activeSubagentToolIds.delete(toolId);
        agent.activeSubagentToolNames.delete(toolId);
        // A foreground spawn dropped at Stop without a tool_result: stop its
        // shadow watch too, or it lingers until sessionEnd.
        notifyBackgroundAgentCompleted(agentId, toolId);
      }
    }
    this.agents.broadcast({ type: 'agentToolsClear', id: agentId });
    // Re-send background agent tools to restore them after the clear.
    // toolName + runInBackground are REQUIRED: without them the webview can't
    // recognize the re-sent tool as a subagent spawn and never recreates the
    // Subtask sub-character (extractToolName("Subtask: ...") is not a tool).
    // Skip tools whose background agent was promoted to its own character.
    for (const toolId of agent.backgroundAgentToolIds) {
      if (hasPromotedBackgroundAgent(agentId, toolId, this.agents)) continue;
      const status = agent.activeToolStatuses.get(toolId);
      if (status) {
        this.agents.broadcast({
          type: 'agentToolStart',
          id: agentId,
          toolId,
          status,
          toolName: agent.activeToolNames.get(toolId),
          runInBackground: true,
          isTeammateSpawn: agent.teammateSpawnToolIds?.has(toolId) || undefined,
        });
      }
    }

    agent.isWaiting = true;
    agent.permissionSent = false;
    agent.hadToolsInTurn = false;
    agent.currentHookToolId = undefined;
    this.agents.broadcast({
      type: 'agentStatus',
      id: agentId,
      status: 'waiting',
      awaitingInput,
    });
  }

  /** Clean up timers and maps. Called when the extension disposes. */
  dispose(): void {
    this.sessionRouter.dispose();
  }
}
