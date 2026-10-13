import * as fs from 'fs';

import type {
  AgentEvent,
  AgentModule,
  ProviderModule,
  TeamMembership,
} from '../../core/src/provider.js';
import type { AgentStateStore } from './agentStateStore.js';
import { pathsMatch } from './pathKey.js';
import type { ModuleSet } from './providers/index.js';
import type { PendingSession, RoutedEvent, SessionRouter } from './sessionRouter.js';
import type { AgentState, AgentTeam } from './types.js';

const debug = process.env.TERRARIUM_DEBUG !== '0';

/** A session announced to the runtime, with what its module knew about it when it started. */
export interface AnnouncedSession extends PendingSession {
  folderName?: string;
  team?: TeamMembership;
  machineId?: string;
}

interface AgentLifecycleCallbacks {
  /** A session no agent reports yet is live: its first event after `sessionStart` arrived, or it was announced
   *  live. The host creates its agent and registers the session. */
  onSessionDetected?: (session: AnnouncedSession) => void;
  /** The session an agent was created for ended. */
  onSessionEnd?: (agentId: number) => void;
}

/**
 * Applies the AgentEvents every module emits to the agents they report.
 *
 * Session routing (session → agent mapping, pending sessions, event buffering) is delegated to an injected
 * SessionRouter. Several sessions may route to one agent: a multiplexer pane and the agent module reporting the
 * same session ref are one agent, one character.
 */
export class AgentEventHandler {
  private lifecycleCallbacks: AgentLifecycleCallbacks = {};

  /** Highest AgentModule.protocolVersion this handler understands. */
  static readonly SUPPORTED_PROTOCOL_VERSION = 2;

  private readonly modulesById: ReadonlyMap<string, ProviderModule>;
  /** The module each routed session came from. */
  private readonly sessionSources = new Map<string, string>();

  constructor(
    private agents: AgentStateStore,
    modules: ModuleSet,
    private sessionRouter: SessionRouter<RoutedEvent, AnnouncedSession>,
  ) {
    this.modulesById = new Map(
      [...modules.agents, ...modules.multiplexers].map((m) => [m.id, m] as const),
    );
    for (const module of modules.agents) {
      if (module.protocolVersion !== AgentEventHandler.SUPPORTED_PROTOCOL_VERSION) {
        console.warn(
          `[Terrarium] Module "${module.id}" reports protocolVersion=${module.protocolVersion}, ` +
            `but handler understands ${AgentEventHandler.SUPPORTED_PROTOCOL_VERSION}. ` +
            `Events from this module will be dropped.`,
        );
      }
    }
  }

  /** The enabled module named `id` when it may feed events, or undefined: unknown, disabled, or speaking another
   *  protocol version (already reported at construction). */
  sourceModule(id: string): ProviderModule | undefined {
    const module = this.modulesById.get(id);
    if (
      module?.kind === 'agent' &&
      module.protocolVersion !== AgentEventHandler.SUPPORTED_PROTOCOL_VERSION
    ) {
      return undefined;
    }
    return module;
  }

  /** The agent module that owns an agent's vocabulary, or undefined for an agent only a multiplexer reports. */
  private agentModuleOf(agent: AgentState): AgentModule | undefined {
    const module = this.modulesById.get(agent.providerId);
    return module?.kind === 'agent' ? module : undefined;
  }

  /** Route `sessionId` to the agent already reporting the same session ref, when another module announced it.
   *  Returns whether an agent claimed the session. */
  private claimBySessionRef(
    sessionId: string,
    sourceId: string,
    sessionRef: string | undefined,
  ): boolean {
    if (sessionRef === undefined) return false;
    for (const [id, agent] of this.agents) {
      if (agent.sessionRef === undefined || !pathsMatch(agent.sessionRef, sessionRef)) continue;
      if (debug)
        console.log(
          `[Terrarium] Event: session ${sessionId.slice(0, 8)}... reports Agent ${id}'s session, routing to it`,
        );
      this.registerAgent(sessionId, id, sourceId);
      return true;
    }
    return false;
  }

  setLifecycleCallbacks(callbacks: AgentLifecycleCallbacks): void {
    this.lifecycleCallbacks = callbacks;
  }

  /** Route `sessionId`, emitted by module `sourceId`, to an agent. */
  registerAgent(sessionId: string, agentId: number, sourceId: string): void {
    this.sessionSources.set(sessionId, sourceId);
    this.sessionRouter.register(sessionId, agentId);
  }

  /** Drop every session routed to an agent (called on agent removal). */
  unregisterAgent(agentId: number): void {
    for (const sessionId of this.sessionRouter.sessionsOf(agentId)) {
      this.sessionRouter.unregister(sessionId);
      this.sessionSources.delete(sessionId);
    }
  }

  /** Every session routed to `agentId`, with the module it came from. */
  sessionsOf(agentId: number): Array<{ sessionId: string; sourceId: string | undefined }> {
    return this.sessionRouter
      .sessionsOf(agentId)
      .map((sessionId) => ({ sessionId, sourceId: this.sessionSources.get(sessionId) }));
  }

  /** Process an event a running module emitted. */
  handleAgentEvent(sourceId: string, sessionId: string, event: AgentEvent): void {
    if (!this.sourceModule(sourceId)) return;
    this.dispatch({ sourceId, sessionId, event });
  }

  private dispatch(routed: RoutedEvent): void {
    const { sourceId, sessionId, event } = routed;
    const sourceModule = this.modulesById.get(sourceId);
    // CI / e2e diagnostic: see agentStateStore.ts debugLogBroadcast comment.
    const debugLog = process.env['TERRARIUM_DEBUG_LOG'];
    if (debugLog) {
      try {
        const extras = event.kind === 'toolStart' ? ` toolName=${event.toolName}` : '';
        fs.appendFileSync(
          debugLog,
          `${new Date().toISOString()} EVENT kind=${event.kind} sid=${sessionId.slice(0, 8)}${extras} module=${sourceId}\n`,
        );
      } catch {
        /* never crash on diagnostic failure */
      }
    }

    if (event.kind === 'sessionStart') {
      this.handleSessionStart(routed, event, sourceModule);
      return;
    }

    // A session that ends before its first event was transient: it never gets a character.
    if (event.kind === 'sessionEnd' && this.sessionRouter.hasPending(sessionId)) {
      this.sessionRouter.discardPending(sessionId);
      return;
    }

    const pending = this.sessionRouter.confirmPending(sessionId);
    if (pending) {
      if (!this.claimBySessionRef(sessionId, sourceId, pending.sessionRef)) {
        this.lifecycleCallbacks.onSessionDetected?.(pending);
      }
      this.dispatch(routed);
      return;
    }

    const agentId = this.sessionRouter.resolve(sessionId);
    if (agentId === undefined) return;
    const agent = this.agents.get(agentId);
    if (!agent) return;

    // A multiplexer's reports never rename the vocabulary an agent module gave the agent.
    if (sourceModule?.kind === 'agent') agent.providerId = sourceModule.id;

    switch (event.kind) {
      case 'sessionEnd':
        this.lifecycleCallbacks.onSessionEnd?.(agentId);
        return;
      case 'sessionInfo':
        return this.handleSessionInfo(event, agent);
      case 'toolStart':
        return this.handleToolStart(event, agent);
      case 'toolEnd':
        return this.handleToolEnd(event.toolId, agent);
      case 'turnEnd':
        return this.markAgentWaiting(agent, event.awaitingInput === true);
      case 'working':
        return this.handleWorking(agent);
      case 'permissionRequest':
        return this.handlePermissionRequest(agent);
      case 'toolShown':
        return this.showTool(agent, event);
      case 'toolDone':
        return this.handleToolEnd(event.toolId, agent);
      case 'toolsCleared':
        this.clearForegroundTools(agent);
        this.agents.broadcast({ type: 'agentToolsClear', id: agent.id });
        return;
      case 'statusChanged':
        agent.isWaiting = event.status === 'waiting';
        if (agent.isWaiting) agent.permissionSent = false;
        this.agents.broadcast({
          type: 'agentStatus',
          id: agent.id,
          status: event.status,
          awaitingInput: event.awaitingInput,
        });
        return;
      case 'permissionShown':
        agent.permissionSent = true;
        this.agents.broadcast({ type: 'agentToolPermission', id: agent.id });
        return;
      case 'permissionCleared':
        agent.permissionSent = false;
        this.agents.broadcast({ type: 'agentToolPermissionClear', id: agent.id });
        return;
      case 'subagentToolShown': {
        let subTools = agent.activeSubagentToolIds.get(event.parentToolId);
        if (!subTools) {
          subTools = new Set();
          agent.activeSubagentToolIds.set(event.parentToolId, subTools);
        }
        subTools.add(event.toolId);
        this.agents.broadcast({
          type: 'subagentToolStart',
          id: agent.id,
          parentToolId: event.parentToolId,
          toolId: event.toolId,
          status: event.status,
        });
        return;
      }
      case 'subagentToolDone':
        agent.activeSubagentToolIds.get(event.parentToolId)?.delete(event.toolId);
        this.agents.broadcast({
          type: 'subagentToolDone',
          id: agent.id,
          parentToolId: event.parentToolId,
          toolId: event.toolId,
        });
        return;
      case 'subagentPermissionShown':
        this.agents.broadcast({
          type: 'subagentToolPermission',
          id: agent.id,
          parentToolId: event.parentToolId,
        });
        return;
      case 'subagentCleared':
        agent.activeSubagentToolIds.delete(event.parentToolId);
        this.agents.broadcast({
          type: 'subagentClear',
          id: agent.id,
          parentToolId: event.parentToolId,
        });
        return;
      case 'teamChanged':
        return this.handleTeamChanged(agent, event.team);
      case 'contextUsage':
        agent.contextTokens = event.contextTokens;
        agent.maxContextTokens = event.maxContextTokens;
        this.agents.broadcast({
          type: 'agentContextUsage',
          id: agent.id,
          contextTokens: event.contextTokens,
          maxContextTokens: event.maxContextTokens,
        });
        return;
    }
  }

  /** Announce a session: a known one only refreshes its ref, one another module already put on screen joins that
   *  agent, a live one gets its agent now, and any other waits for its first event (a session that ends without one
   *  never gets a character). */
  private handleSessionStart(
    routed: RoutedEvent,
    event: Extract<AgentEvent, { kind: 'sessionStart' }>,
    sourceModule: ProviderModule | undefined,
  ): void {
    const { sourceId, sessionId } = routed;
    const existingAgentId = this.sessionRouter.resolve(sessionId);
    if (existingAgentId !== undefined) {
      const agent = this.agents.get(existingAgentId);
      if (agent && event.sessionRef !== undefined && agent.sessionRef !== event.sessionRef) {
        agent.sessionRef = event.sessionRef;
        this.agents.persist();
      }
      return;
    }
    if (this.claimBySessionRef(sessionId, sourceId, event.sessionRef)) return;
    const announced: AnnouncedSession = {
      sessionId,
      sessionRef: event.sessionRef,
      cwd: event.cwd ?? '',
      sourceIds: [sourceId],
      folderName: event.folderName,
      team: event.team,
      machineId: event.machineId,
    };
    if (event.live) {
      this.lifecycleCallbacks.onSessionDetected?.(announced);
      return;
    }
    if (event.cwd || event.sessionRef || sourceModule?.kind === 'multiplexer') {
      if (debug)
        console.log(
          `[Terrarium] Event: sessionStart -> pending session ${sessionId.slice(0, 8)}..., awaiting confirmation`,
        );
      this.sessionRouter.storePending(sessionId, announced);
    }
  }

  /** The agent a module's team record names as lead, by the lead's session. */
  resolveTeam(team: TeamMembership, previous?: AgentTeam): AgentTeam {
    const leadAgentId =
      team.leadSessionId === undefined ? undefined : this.sessionRouter.resolve(team.leadSessionId);
    return {
      teamName: team.teamName,
      agentName: team.agentName,
      isTeamLead: team.isTeamLead,
      leadAgentId,
      teamUsesTmux: team.teamUsesTmux ?? previous?.teamUsesTmux,
    };
  }

  private handleTeamChanged(agent: AgentState, team: TeamMembership): void {
    agent.team = this.resolveTeam(team, agent.team);
    this.agents.broadcast({
      type: 'agentTeamInfo',
      id: agent.id,
      teamName: agent.team.teamName,
      agentName: agent.team.agentName,
      isTeamLead: agent.team.isTeamLead,
      leadAgentId: agent.team.leadAgentId,
      teamUsesTmux: team.teamUsesTmux,
    });
    this.agents.persist();
  }

  private handleSessionInfo(event: { name?: string; task?: string }, agent: AgentState): void {
    if (event.name !== undefined) agent.folderName = event.name;
    if (event.task !== undefined) agent.task = event.task;
    this.agents.broadcast({ type: 'agentInfo', id: agent.id, name: event.name, task: event.task });
  }

  /** A tool started, as a coarse source reports it: the agent is active and the tool shows with the module's status
   *  text. */
  private handleToolStart(
    event: Extract<AgentEvent, { kind: 'toolStart' }>,
    agent: AgentState,
  ): void {
    const module = this.agentModuleOf(agent);
    agent.isWaiting = false;
    agent.permissionSent = false;
    this.showTool(agent, {
      toolId: event.toolId,
      toolName: event.toolName,
      status: module?.formatToolStatus(event.toolName, event.input) ?? event.toolName,
      runInBackground: event.runInBackground || undefined,
    });
    this.agents.broadcast({ type: 'agentStatus', id: agent.id, status: 'active' });
  }

  private showTool(
    agent: AgentState,
    tool: Omit<Extract<AgentEvent, { kind: 'toolShown' }>, 'kind'>,
  ): void {
    agent.activeToolIds.add(tool.toolId);
    agent.activeToolStatuses.set(tool.toolId, tool.status);
    if (tool.toolName !== undefined) agent.activeToolNames.set(tool.toolId, tool.toolName);
    if (tool.isTeammateSpawn) agent.teammateSpawnToolIds.add(tool.toolId);
    if (tool.runInBackground && !agent.backgroundToolIds.has(tool.toolId)) {
      agent.backgroundToolIds.add(tool.toolId);
      this.agents.persist();
    }
    this.agents.broadcast({
      type: 'agentToolStart',
      id: agent.id,
      toolId: tool.toolId,
      status: tool.status,
      toolName: tool.toolName,
      permissionActive: tool.permissionActive,
      runInBackground: tool.runInBackground,
      isTeammateSpawn: tool.isTeammateSpawn,
    });
  }

  private handleToolEnd(toolId: string, agent: AgentState): void {
    agent.activeToolIds.delete(toolId);
    agent.activeToolStatuses.delete(toolId);
    agent.activeToolNames.delete(toolId);
    agent.activeSubagentToolIds.delete(toolId);
    agent.teammateSpawnToolIds.delete(toolId);
    if (agent.backgroundToolIds.delete(toolId)) this.agents.persist();
    this.agents.broadcast({ type: 'agentToolDone', id: agent.id, toolId });
  }

  /** Forget every tool that does not run in the background, with the sub-agent tools under it. */
  private clearForegroundTools(agent: AgentState): void {
    for (const toolId of [...agent.activeToolIds]) {
      if (agent.backgroundToolIds.has(toolId)) continue;
      agent.activeToolIds.delete(toolId);
      agent.activeToolStatuses.delete(toolId);
      agent.activeToolNames.delete(toolId);
      agent.activeSubagentToolIds.delete(toolId);
      agent.teammateSpawnToolIds.delete(toolId);
    }
  }

  /** Busy on a turn with no tool known (a prompt landed, or a multiplexer reports the agent busy). Active again,
   *  and any approval it was waiting on is no longer pending. */
  private handleWorking(agent: AgentState): void {
    agent.isWaiting = false;
    if (agent.permissionSent) {
      agent.permissionSent = false;
      this.agents.broadcast({ type: 'agentToolPermissionClear', id: agent.id });
    }
    this.agents.broadcast({ type: 'agentStatus', id: agent.id, status: 'active' });
  }

  /** Show the permission bubble on the agent and on every sub-agent with tools running. */
  private handlePermissionRequest(agent: AgentState): void {
    agent.permissionSent = true;
    this.agents.broadcast({ type: 'agentToolPermission', id: agent.id });
    for (const parentToolId of agent.activeSubagentToolIds.keys()) {
      this.agents.broadcast({ type: 'subagentToolPermission', id: agent.id, parentToolId });
    }
  }

  /**
   * The turn is over: foreground tools are cleared, background ones are shown again (toolName + runInBackground
   * let the webview recreate their sub-agent characters after the clear), and the agent waits.
   */
  private markAgentWaiting(agent: AgentState, awaitingInput: boolean): void {
    this.clearForegroundTools(agent);
    this.agents.broadcast({ type: 'agentToolsClear', id: agent.id });
    for (const toolId of agent.backgroundToolIds) {
      const status = agent.activeToolStatuses.get(toolId);
      if (!status) continue;
      this.agents.broadcast({
        type: 'agentToolStart',
        id: agent.id,
        toolId,
        status,
        toolName: agent.activeToolNames.get(toolId),
        runInBackground: true,
        isTeammateSpawn: agent.teammateSpawnToolIds.has(toolId) || undefined,
      });
    }
    agent.isWaiting = true;
    agent.permissionSent = false;
    this.agents.broadcast({
      type: 'agentStatus',
      id: agent.id,
      status: 'waiting',
      awaitingInput,
    });
  }

  dispose(): void {
    this.sessionRouter.dispose();
    this.sessionSources.clear();
  }
}
