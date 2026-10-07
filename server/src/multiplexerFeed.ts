import type {
  AgentEvent,
  ModuleHandle,
  ModuleHost,
  MultiplexedAgent,
  MultiplexedAgentStatus,
  MultiplexerConnection,
  MultiplexerModule,
  RunningAgentModule,
} from '../../core/src/provider.js';
import { canonicalSessionFile } from './pathKey.js';

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

/**
 * Turns a multiplexer's snapshots into AgentEvents, attributed to the multiplexer.
 *
 * Each pane is announced under `<multiplexer id>-<pane id>` with the pane's session file as its `sessionFile`
 * identity. When the agent module for the pane's kind is running, that module takes the session over
 * (`followSession`) and reports what the agent is doing, including when its turns start and end; the multiplexer
 * then adds only what a transcript cannot say: the name, the task, and a pending approval. With no such module the
 * pane's status level is all there is, and it is reported in full.
 */
export class MultiplexerFeed {
  private readonly panes = new Map<string, AnnouncedPane>();
  private connection: MultiplexerConnection | null = null;

  constructor(
    private readonly multiplexer: MultiplexerModule,
    private readonly host: ModuleHost,
    private readonly agentModules: ReadonlyMap<string, RunningAgentModule>,
  ) {}

  /** Connect; resolves with whether the multiplexer answered the first attempt. */
  start(): Promise<boolean> {
    this.connection = this.multiplexer.connect(
      (agents) => this.applySnapshot(agents),
      (message) => this.host.log(message),
    );
    return this.connection.connected;
  }

  stop(): void {
    this.connection?.stop();
    for (const pane of this.panes.values()) pane.followed?.stop();
    this.panes.clear();
  }

  private applySnapshot(agents: readonly MultiplexedAgent[]): void {
    const live = new Set<string>();
    for (const agent of agents) {
      live.add(agent.paneId);
      const sessionFile = agent.sessionFile ? canonicalSessionFile(agent.sessionFile) : undefined;
      const follower = sessionFile ? this.agentModules.get(agent.agentKind) : undefined;
      const binding = follower ? `${agent.agentKind}:${sessionFile}` : '';
      let pane = this.panes.get(agent.paneId);
      if (pane && pane.binding !== binding) {
        this.end(pane);
        pane = undefined;
      }
      if (!pane) {
        pane = this.announce(agent, sessionFile, binding, follower);
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
    sessionFile: string | undefined,
    binding: string,
    follower: RunningAgentModule | undefined,
  ): AnnouncedPane {
    const sessionId = `${this.multiplexer.id}-${agent.paneId}`;
    this.host.log(`agent detected: ${agent.name} (${agent.paneId}, ${agent.cwd || 'no cwd'})`);
    this.host.emit(sessionId, {
      kind: 'sessionStart',
      source: 'startup',
      cwd: agent.cwd,
      sessionFile,
    });
    const followed = follower && sessionFile ? follower.followSession(sessionFile) : null;
    return { sessionId, followed, binding, name: '', task: '', status: null };
  }

  private report(pane: AnnouncedPane, agent: MultiplexedAgent): void {
    if (agent.name !== pane.name || agent.task !== pane.task) {
      pane.name = agent.name;
      pane.task = agent.task;
      this.host.emit(pane.sessionId, { kind: 'sessionInfo', name: agent.name, task: agent.task });
    }
    if (agent.status === pane.status) return;
    pane.status = agent.status;
    const event = pane.followed ? approvalEvent(agent.status) : statusEvent(agent.status);
    if (event) this.host.emit(pane.sessionId, event);
  }

  private end(pane: AnnouncedPane): void {
    this.host.log(`agent ended: ${pane.name} (${pane.sessionId})`);
    // A followed session belongs to its agent module, which ends it once nothing else tracks it.
    if (pane.followed) pane.followed.stop();
    else this.host.emit(pane.sessionId, { kind: 'sessionEnd', reason: 'exit' });
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
