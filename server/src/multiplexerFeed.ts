import type {
  AgentEvent,
  ModuleHandle,
  ModuleHost,
  MultiplexedAgent,
  MultiplexedAgentStatus,
  MultiplexerEndpoint,
  MultiplexerLinkState,
  MultiplexerModule,
  RunningAgentModule,
} from '../../core/src/provider.js';

/** A pane this feed has announced. */
interface AnnouncedPane {
  readonly sessionId: string;
  /** The agent module reporting this pane's activity, when one took the session over. */
  readonly followed: ModuleHandle | null;
  /** The session this pane was announced for. A different one (herdr re-pointed the pane, or its file appeared
   *  late) ends the old announcement and starts a new one. */
  readonly binding: string;
  name: string;
  task: string;
  status: MultiplexedAgentStatus | null;
}

export interface MultiplexerFeedOptions {
  readonly multiplexer: MultiplexerModule;
  readonly endpoint: MultiplexerEndpoint;
  readonly host: ModuleHost;
  readonly agentModules: ReadonlyMap<string, RunningAgentModule>;
  /** Appended to every pane's name as ` @<label>`, so a character shows which machine or session it runs on. */
  readonly label?: string;
  /** Floor id of the machine the endpoint runs on, carried by every pane's `sessionStart`. */
  readonly machineId: string;
  onState(state: MultiplexerLinkState, message?: string): void;
}

/**
 * Turns the snapshots of one multiplexer endpoint into AgentEvents, attributed to the multiplexer.
 *
 * Each pane is announced under `<multiplexer id>-<endpoint id>-<pane id>` (pane ids are only unique within one
 * server) with the pane's session ref as its `sessionRef` identity. When the agent module for the pane's kind is
 * running, that module takes the session over (`followSession`) and reports what the agent is doing, including when
 * its turns start and end. The multiplexer then adds only what a transcript cannot say: the name, the task, and a
 * pending approval. A pane the multiplexer knows no session for is bound to the module's one live session in the
 * pane's directory, once there is exactly one. With no such module the pane's status level is all there is, and it
 * is reported in full.
 *
 * A pane on another machine is never handed to an agent module: its session ref names a file or session on that
 * machine, which this one cannot read and must not mistake for one of its own. It reports status alone.
 *
 * Losing the connection ends every pane: nothing says those agents still exist until the multiplexer answers again.
 */
export class MultiplexerFeed {
  private readonly panes = new Map<string, AnnouncedPane>();
  private connection: ModuleHandle | null = null;
  private readonly isRemote: boolean;
  private label: string | undefined;
  /** A snapshot from a reconcile that outlived the link would re-announce panes endAll() already removed. */
  private isLinkUp = false;

  constructor(private readonly options: MultiplexerFeedOptions) {
    this.isRemote = options.endpoint.kind === 'ssh';
    this.label = options.label;
  }

  /** Rename every character from the next snapshot on. */
  relabel(label: string | undefined): void {
    this.label = label;
  }

  start(): void {
    const { multiplexer, endpoint, host } = this.options;
    this.connection = multiplexer.connect(endpoint, {
      onSnapshot: (agents) => {
        if (this.isLinkUp) this.applySnapshot(agents);
      },
      onState: (state, message) => {
        this.isLinkUp = state === 'connected';
        if (!this.isLinkUp) this.endAll();
        this.options.onState(state, message);
      },
      log: (message) => host.log(message),
    });
  }

  /** Disconnect and end every pane this feed announced. */
  stop(): void {
    this.connection?.stop();
    this.connection = null;
    this.endAll();
  }

  private endAll(): void {
    for (const pane of this.panes.values()) this.end(pane);
    this.panes.clear();
  }

  private applySnapshot(agents: readonly MultiplexedAgent[]): void {
    const live = new Set<string>();
    for (const agent of agents) {
      live.add(agent.paneId);
      const module = this.isRemote ? undefined : this.options.agentModules.get(agent.agentKind);
      const sessionRef = this.isRemote
        ? undefined
        : (agent.sessionRef ?? module?.sessionInDirectory?.(agent.cwd));
      const follower = sessionRef ? module : undefined;
      const binding = follower ? `${agent.agentKind}:${sessionRef}` : '';
      let pane = this.panes.get(agent.paneId);
      if (pane && pane.binding !== binding) {
        this.end(pane);
        pane = undefined;
      }
      if (!pane) {
        pane = this.announce(agent, sessionRef, binding, follower);
        this.panes.set(agent.paneId, pane);
      }
      this.report(pane, agent);
    }
    for (const [paneId, pane] of this.panes) {
      if (live.has(paneId)) continue;
      this.end(pane);
      this.panes.delete(paneId);
    }
  }

  private announce(
    agent: MultiplexedAgent,
    sessionRef: string | undefined,
    binding: string,
    follower: RunningAgentModule | undefined,
  ): AnnouncedPane {
    const { multiplexer, endpoint, host } = this.options;
    const sessionId = `${multiplexer.id}-${endpoint.id}-${agent.paneId}`;
    host.log(`agent detected: ${agent.name} (${agent.paneId}, ${agent.cwd || 'no cwd'})`);
    host.emit(sessionId, {
      kind: 'sessionStart',
      source: 'startup',
      cwd: agent.cwd,
      sessionRef,
      machineId: this.options.machineId,
    });
    const followed = follower && sessionRef ? follower.followSession(sessionRef) : null;
    return { sessionId, followed, binding, name: '', task: '', status: null };
  }

  private report(pane: AnnouncedPane, agent: MultiplexedAgent): void {
    const { host } = this.options;
    const name = this.label ? `${agent.name} @${this.label}` : agent.name;
    if (name !== pane.name || agent.task !== pane.task) {
      pane.name = name;
      pane.task = agent.task;
      host.emit(pane.sessionId, { kind: 'sessionInfo', name, task: agent.task });
    }
    if (agent.status === pane.status) return;
    pane.status = agent.status;
    const event = pane.followed ? approvalEvent(agent.status) : statusEvent(agent.status);
    if (event) host.emit(pane.sessionId, event);
  }

  private end(pane: AnnouncedPane): void {
    this.options.host.log(`agent ended: ${pane.name} (${pane.sessionId})`);
    // A followed session belongs to its agent module, which ends it once nothing else tracks it.
    if (pane.followed) pane.followed.stop();
    else this.options.host.emit(pane.sessionId, { kind: 'sessionEnd', reason: 'exit' });
  }
}

/** A status level reported as the transition into it. */
function statusEvent(status: MultiplexedAgentStatus): AgentEvent {
  if (status === 'blocked') return { kind: 'permissionRequest' };
  return status === 'working' ? { kind: 'working' } : { kind: 'turnEnd' };
}

/** What a multiplexer adds to a session an agent module reports: a pending approval never reaches a transcript. */
function approvalEvent(status: MultiplexedAgentStatus): AgentEvent | null {
  return status === 'blocked' ? { kind: 'permissionRequest' } : null;
}
