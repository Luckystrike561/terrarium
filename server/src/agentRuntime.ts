/**
 * AgentRuntime: the agent lifecycle core of the standalone server.
 *
 * Starts the enabled modules, applies the AgentEvents they emit to CLI-neutral agent state, creates and removes
 * agents, and hands persisted agents back to their module on startup. It knows no CLI: everything a CLI writes
 * (transcripts, hooks, teams) is read by that CLI's module.
 */

import * as path from 'path';

import type {
  ModuleHandle,
  ModuleHost,
  ProviderModule,
  RunningAgentModule,
} from '../../core/src/provider.js';
import type { PersistedAgent } from '../../core/src/schemas.js';
import type { AnnouncedSession } from './agentEventHandler.js';
import { AgentEventHandler } from './agentEventHandler.js';
import type { AgentStateStore } from './agentStateStore.js';
import { DEFAULT_MAX_CONTEXT_TOKENS } from './constants.js';
import { MultiplexerConnections } from './multiplexerConnections.js';
import { assignPaletteIfNeeded } from './paletteAssigner.js';
import type { ModuleSet } from './providers/index.js';
import type { RoutedEvent } from './sessionRouter.js';
import { SessionRouter } from './sessionRouter.js';
import type { AgentState } from './types.js';

/** Key of a persisted agent waiting for its module to resume its session. */
function restoreKey(providerId: string, sessionRef: string): string {
  return `${providerId}\u0000${sessionRef}`;
}

export class AgentRuntime {
  private readonly eventHandler: AgentEventHandler;
  /** Running agent modules by id, once startModules ran. */
  private readonly runningAgentModules = new Map<string, RunningAgentModule>();
  /** Modules started by startModules, stopped on dispose. */
  private readonly runningModules: ModuleHandle[] = [];
  /** Each hook module's preference, handed to it when it starts and on every change. */
  private readonly hooksEnabled = new Map<string, boolean>();
  /** Persisted agents whose module was asked to resume them, by module and session ref: the session gets its old
   *  id, colors and name back when its module announces it. */
  private readonly pendingRestores = new Map<string, PersistedAgent>();
  /** The herdr servers this process listens to, once startModules ran with a multiplexer module enabled. */
  connections: MultiplexerConnections | undefined;
  /** Set by dispose: modules winding down (a multiplexer ending its panes) must not edit the persisted agents. */
  private isDisposed = false;

  constructor(
    private readonly store: AgentStateStore,
    /** The provider modules this process runs. */
    readonly modules: ModuleSet,
  ) {
    this.eventHandler = new AgentEventHandler(
      store,
      modules,
      new SessionRouter<RoutedEvent, AnnouncedSession>(),
    );
    this.eventHandler.setLifecycleCallbacks({
      onSessionDetected: (session) => this.createAgent(session),
      onSessionEnd: (agentId) => this.removeAgent(agentId),
    });
  }

  /** The enabled module named `id`. */
  private findModule(id: string): ProviderModule | undefined {
    return [...this.modules.agents, ...this.modules.multiplexers].find((m) => m.id === id);
  }

  /** Put a live session on screen: a session a persisted agent stood for gets that agent back. */
  private createAgent(session: AnnouncedSession): void {
    const providerId =
      session.sourceIds.find((id) => this.findModule(id)?.kind === 'agent') ?? session.sourceIds[0];
    const key =
      session.sessionRef === undefined ? undefined : restoreKey(providerId, session.sessionRef);
    const restored = key === undefined ? undefined : this.pendingRestores.get(key);
    if (key !== undefined) this.pendingRestores.delete(key);
    const id =
      restored && !this.store.has(restored.id) ? restored.id : this.store.nextAgentId.current++;
    const agent: AgentState = {
      id,
      sessionId: session.sessionId,
      providerId,
      sessionRef: session.sessionRef,
      activeToolIds: new Set(),
      activeToolStatuses: new Map(),
      activeToolNames: new Map(),
      activeSubagentToolIds: new Map(),
      backgroundToolIds: new Set(restored?.backgroundToolIds),
      teammateSpawnToolIds: new Set(),
      isWaiting: false,
      permissionSent: false,
      folderName:
        session.folderName ??
        restored?.folderName ??
        (session.cwd ? path.basename(session.cwd) : undefined),
      contextTokens: 0,
      maxContextTokens: DEFAULT_MAX_CONTEXT_TOKENS,
      team: session.team ? this.eventHandler.resolveTeam(session.team) : undefined,
      palette: restored?.palette,
      hueShift: restored?.hueShift,
    };
    const lead =
      agent.team?.leadAgentId === undefined ? undefined : this.store.get(agent.team.leadAgentId);
    if (lead && agent.palette === undefined) {
      agent.palette = lead.palette;
      agent.hueShift = lead.hueShift ?? 0;
    }
    assignPaletteIfNeeded(agent, this.store);
    this.store.set(id, agent);
    this.eventHandler.registerAgent(session.sessionId, id, session.sourceIds[0]);
    this.store.persist();
    console.log(
      `[Terrarium] Agent ${id} - ${restored ? 'restored' : 'detected'} ${providerId} session${agent.folderName ? ` (${agent.folderName})` : ''}`,
    );
  }

  /** Record a module's hooks preference and pass it to the module once it runs. */
  setHooksEnabled(moduleId: string, enabled: boolean): void {
    this.hooksEnabled.set(moduleId, enabled);
    this.runningAgentModules.get(moduleId)?.setHooksEnabled?.(enabled);
  }

  /** Start every enabled module that runs on its own (agent modules' session discovery, then the multiplexer
   *  connections, whose feeds hand each local pane to the running agent module for its kind), and hand each
   *  persisted agent back to its module. The persisted list is read before any module starts: a module that
   *  discovers a session while starting persists it, which would otherwise overwrite the list. */
  startModules(): void {
    const persisted = this.store.loadPersistedAgents();
    const maxPersistedId = Math.max(0, ...persisted.map((p) => p.id));
    if (maxPersistedId >= this.store.nextAgentId.current)
      this.store.nextAgentId.current = maxPersistedId + 1;
    for (const module of this.modules.agents) {
      if (!module.start) continue;
      const started = module.start(this.hostFor(module));
      this.runningAgentModules.set(module.id, started);
      this.runningModules.push(started);
      const hooksEnabled = this.hooksEnabled.get(module.id);
      if (hooksEnabled !== undefined) started.setHooksEnabled?.(hooksEnabled);
    }
    this.restorePersistedAgents(persisted);
    if (this.modules.multiplexers.length > 0) {
      const connections = new MultiplexerConnections({
        multiplexers: this.modules.multiplexers,
        hostFor: (multiplexer) => this.hostFor(multiplexer),
        agentModules: this.runningAgentModules,
      });
      this.connections = connections;
      this.runningModules.push(connections);
      connections.start();
    }
  }

  private hostFor(module: ProviderModule): ModuleHost {
    return {
      emit: (sessionId, event) => {
        if (!this.isDisposed) this.eventHandler.handleAgentEvent(module.id, sessionId, event);
      },
      log: (message) => console.log(`[${module.displayName}] ${message}`),
    };
  }

  /**
   * Hand every persisted agent to the module that reported it, leads before their teammates. The module resumes
   * the sessions that are still live; announcing one gives it its persisted agent back (id, seat, colors). Agents
   * whose module is not running, or does not resume sessions, stay gone.
   */
  private restorePersistedAgents(persisted: PersistedAgent[]): void {
    const refById = new Map(persisted.map((p) => [p.id, p.sessionRef] as const));
    const leadsFirst = [...persisted].sort(
      (a, b) =>
        Number(a.team?.leadAgentId !== undefined) - Number(b.team?.leadAgentId !== undefined),
    );
    for (const p of leadsFirst) {
      const module = this.runningAgentModules.get(p.providerId);
      if (!module?.restoreSession || this.store.has(p.id)) continue;
      this.pendingRestores.set(restoreKey(p.providerId, p.sessionRef), p);
      const { leadAgentId, ...team } = p.team ?? {};
      module.restoreSession({
        sessionRef: p.sessionRef,
        team: p.team
          ? {
              ...team,
              leadSessionRef: leadAgentId === undefined ? undefined : refById.get(leadAgentId),
            }
          : undefined,
        backgroundToolIds: p.backgroundToolIds ?? [],
      });
    }
  }

  // ── Hook routing ──

  /** Hand a payload POSTed to `/api/hooks/<providerId>` to that module, and no other. A route naming no enabled
   *  module, or one that takes no hooks, is dropped. */
  handleHookEvent(providerId: string, payload: Record<string, unknown>): void {
    if (this.eventHandler.sourceModule(providerId)?.kind !== 'agent') return;
    this.runningAgentModules.get(providerId)?.receiveHook?.(payload);
  }

  // ── Agent removal ──

  /** The user closed an agent's character: every module reporting it stops, then the agent goes. */
  closeAgent(id: number): void {
    for (const { sessionId, sourceId } of this.eventHandler.sessionsOf(id)) {
      if (sourceId !== undefined)
        this.runningAgentModules.get(sourceId)?.dismissSession?.(sessionId);
    }
    this.removeAgent(id);
  }

  removeAgent(id: number): void {
    if (!this.store.has(id)) return;
    this.eventHandler.unregisterAgent(id);
    this.store.delete(id);
    this.store.persist();
  }

  // ── Cleanup ──

  /** Stop every module and drop every agent. Called on shutdown: the persisted agents stay, so the next start hands
   *  them back to their modules. */
  dispose(): void {
    this.isDisposed = true;
    for (const module of this.runningModules.splice(0)) module.stop();
    this.runningAgentModules.clear();
    this.eventHandler.dispose();
    for (const id of [...this.store.keys()]) this.store.delete(id);
  }
}
