/**
 * Herdr bridge: reads which agents one Herdr server hosts.
 *
 * Herdr exposes a JSON-RPC 2.0 API over a Unix domain socket (its own, or the local end of an SSH forward of a remote
 * one). Two capabilities matter here:
 *   - `agent.list`        -> authoritative snapshot of every managed agent
 *                            (kind, status, cwd, session file path)
 *   - `events.subscribe`  -> live pane lifecycle pushes (`pane.agent_detected`,
 *                            `pane.exited`) telling us when to re-snapshot
 *
 * Each snapshot is reduced to MultiplexedAgents (name, task, status level, session file) and handed to the caller.
 * The bridge never reads a transcript: what an agent is doing comes from the agent module for its kind.
 *
 * Uses only node built-ins (net): no dependency added to the repo.
 *
 * Protocol notes (protocol 22):
 *   - Connection semantics differ by request type. A connection that carries a
 *     plain request (`agent.list`, ...) is **closed by herdr right after the
 *     reply** (one-shot), while a connection that carries `events.subscribe`
 *     stays open to stream pushes. Mixing both on one socket tears it down, so
 *     we keep a dedicated long-lived socket for events and open a throwaway
 *     socket per snapshot poll.
 *   - Subscription variants are dotted (`pane.agent_detected`, `pane.exited`).
 *     `pane.agent_status_changed` additionally requires a `pane_id`, and we never
 *     subscribe to it: status transitions come from the snapshot poll.
 */

import * as net from 'node:net';
import * as path from 'node:path';

import type {
  MultiplexedAgent,
  MultiplexedAgentStatus,
  MultiplexerWatcher,
} from '../../../../core/src/provider.js';
import { canonicalSessionFile } from '../../pathKey.js';
import {
  HERDR_EVENT_RECONNECT_MS,
  HERDR_REPLY_EXCERPT_CHARS,
  HERDR_RPC_TIMEOUT_MS,
  HERDR_SESSION_KIND_PATH,
  HERDR_SNAPSHOT_INTERVAL_MS,
} from './constants.js';

interface HerdrAgentSession {
  source?: string;
  agent?: string;
  kind?: string;
  value?: string;
}

interface HerdrAgent {
  name?: string;
  agent?: string;
  agent_status?: string;
  cwd?: string;
  foreground_cwd?: string;
  workspace_id?: string;
  tab_id?: string;
  pane_id?: string;
  terminal_id?: string;
  terminal_title_stripped?: string;
  agent_session?: HerdrAgentSession | null;
}

interface HerdrLabeled {
  workspace_id?: string;
  tab_id?: string;
  label?: string;
}

/** herdr's status levels. `done` (finished, waiting on the user) reads as idle, `unknown` panes are not agents. */
const STATUS_LEVELS: Record<string, MultiplexedAgentStatus> = {
  working: 'working',
  blocked: 'blocked',
  idle: 'idle',
  done: 'idle',
};

/** omp titles its terminal `π <spinner|>> <task>`, other agents prefix a status glyph. */
function taskFromTerminalTitle(title: string | undefined): string {
  return (title ?? '')
    .trim()
    .replace(/^π\s+/u, '')
    .replace(/^[^\p{L}\p{N}\s]+\s+/u, '')
    .trim();
}

export interface HerdrBridgeOptions {
  socketPath: string;
  watcher: MultiplexerWatcher;
}

/** A one-shot request's outcome: herdr's result, or why there is none. */
export type HerdrReply = { readonly result: unknown } | { readonly error: string };

export class HerdrBridge {
  private readonly socketPath: string;
  private readonly watcher: MultiplexerWatcher;

  private eventsSock: net.Socket | null = null;
  private eventReconnect: NodeJS.Timeout | null = null;

  private stopped = false;
  private snapshotTimer: NodeJS.Timeout | null = null;

  private reconciling = false;
  private reconcileQueued = false;

  constructor(opts: HerdrBridgeOptions) {
    this.socketPath = opts.socketPath;
    this.watcher = opts.watcher;
  }

  /** Start watching. Failures are reported through the watcher and retried in the background until stop(). */
  start(): void {
    this.watcher.onState('connecting');
    this.connectEvents();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.eventReconnect ?? undefined);
    clearInterval(this.snapshotTimer ?? undefined);
    this.eventsSock?.destroy();
    this.eventsSock = null;
  }

  private connectEvents(): void {
    let buffered = '';
    let answered = false;
    let failure: string | undefined;
    const sock = net.connect(this.socketPath);
    this.eventsSock = sock;
    sock.setEncoding('utf8');

    sock.on('connect', () => {
      // Only ever a subscription on this socket: other request types close after replying.
      sock.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: '1',
          method: 'events.subscribe',
          params: {
            subscriptions: [{ type: 'pane.agent_detected' }, { type: 'pane.exited' }],
          },
        })}\n`,
      );
    });

    sock.on('data', (chunk: string) => {
      buffered += chunk;
      let idx: number;
      while ((idx = buffered.indexOf('\n')) >= 0) {
        const line = buffered.slice(0, idx);
        buffered = buffered.slice(idx + 1);
        if (!line.trim()) continue;
        if (!answered) {
          // Connecting proves nothing through an SSH forward, whose local end accepts before the remote herdr is
          // reached: only herdr's reply to the subscription does.
          failure = subscriptionError(line);
          if (failure !== undefined) {
            sock.destroy();
            return;
          }
          answered = true;
          this.onAnswered();
        }
        // Any push (agent detected, pane exited) means the fleet changed: re-read
        // the authoritative snapshot rather than trusting the event payload shape.
        void this.reconcile();
      }
    });

    sock.on('error', (err: NodeJS.ErrnoException) => {
      failure = describeSocketError(err, this.socketPath);
    });

    sock.on('close', () => {
      clearInterval(this.snapshotTimer ?? undefined);
      this.snapshotTimer = null;
      this.eventsSock = null;
      if (this.stopped) return;
      if (answered) this.watcher.onState('reconnecting', failure ?? 'herdr closed the connection');
      else
        this.watcher.onState('error', failure ?? 'herdr closed the connection without answering');
      this.eventReconnect = setTimeout(() => {
        this.eventReconnect = null;
        this.connectEvents();
      }, HERDR_EVENT_RECONNECT_MS);
    });
  }

  private onAnswered(): void {
    this.watcher.log(`connected to ${this.socketPath}`);
    this.watcher.onState('connected');
    // The snapshot poll is the authoritative source for status transitions
    // (not subscribable without a pane_id) and also catches silent churn.
    clearInterval(this.snapshotTimer ?? undefined);
    this.snapshotTimer = setInterval(() => void this.reconcile(), HERDR_SNAPSHOT_INTERVAL_MS);
  }

  private async rpcOnce(method: string): Promise<unknown> {
    const reply = await herdrRequest(this.socketPath, method, HERDR_RPC_TIMEOUT_MS);
    return 'result' in reply ? reply.result : undefined;
  }

  /** Re-read the authoritative snapshot. Coalesces concurrent calls so an event burst collapses into one pass. */
  private async reconcile(): Promise<void> {
    if (this.reconciling) {
      this.reconcileQueued = true;
      return;
    }
    this.reconciling = true;
    try {
      const agents = await this.readAgents();
      if (agents && !this.stopped) this.watcher.onSnapshot(agents);
    } finally {
      this.reconciling = false;
      if (this.reconcileQueued) {
        this.reconcileQueued = false;
        void this.reconcile();
      }
    }
  }

  /** The live agents, or undefined when herdr did not answer (an unanswered poll must not read as "all ended"). */
  private async readAgents(): Promise<MultiplexedAgent[] | undefined> {
    const [res, workspaces, tabs] = await Promise.all([
      this.rpcOnce('agent.list') as Promise<{ agents?: HerdrAgent[] } | undefined>,
      this.rpcOnce('workspace.list') as Promise<{ workspaces?: HerdrLabeled[] } | undefined>,
      this.rpcOnce('tab.list') as Promise<{ tabs?: HerdrLabeled[] } | undefined>,
    ]);
    if (!Array.isArray(res?.agents)) return undefined;
    // herdr keeps a pane's `agent` after the agent process exits, so a pane
    // back at its shell still reads as an idle agent. The shell retitles the
    // terminal to its prompt (`user@host:path`), which no agent does.
    const agents = res.agents.filter(
      (a) =>
        a.pane_id &&
        STATUS_LEVELS[a.agent_status ?? ''] !== undefined &&
        !/^\S+@\S+:/.test((a.terminal_title_stripped ?? '').trim()),
    );

    const workspaceLabels = new Map(
      (workspaces?.workspaces ?? []).map((w) => [w.workspace_id, w.label]),
    );
    const tabLabels = new Map((tabs?.tabs ?? []).map((t) => [t.tab_id, t.label]));
    const agentsPerWorkspace = new Map<string | undefined, number>();
    for (const a of agents) {
      agentsPerWorkspace.set(a.workspace_id, (agentsPerWorkspace.get(a.workspace_id) ?? 0) + 1);
    }

    return agents.map((a) => {
      const paneId = a.pane_id as string;
      const cwd = a.foreground_cwd ?? a.cwd ?? '';
      const tabLabel = tabLabels.get(a.tab_id);
      const baseName =
        workspaceLabels.get(a.workspace_id) ?? a.name ?? (cwd ? path.basename(cwd) : paneId);
      return {
        paneId,
        agentKind: a.agent ?? '',
        status: STATUS_LEVELS[a.agent_status as string],
        cwd,
        name:
          tabLabel && (agentsPerWorkspace.get(a.workspace_id) ?? 0) > 1
            ? `${baseName} #${tabLabel}`
            : baseName,
        task: taskFromTerminalTitle(a.terminal_title_stripped),
        sessionRef: sessionRefOf(a.agent_session),
      };
    });
  }
}

/** herdr's session ref for a pane: a transcript path (compared by real path, since herdr reports the path the CLI
 *  resolved and an agent module scans its own spelling of it) or the CLI's own session id, kept as is. */
function sessionRefOf(session: HerdrAgentSession | null | undefined): string | undefined {
  const value = session?.value;
  if (!value) return undefined;
  return session.kind === HERDR_SESSION_KIND_PATH ? canonicalSessionFile(value) : value;
}

/** One request on its own connection, which herdr closes after replying. */
export function herdrRequest(
  socketPath: string,
  method: string,
  timeoutMs: number,
): Promise<HerdrReply> {
  return new Promise((resolve) => {
    let settled = false;
    let failure: string | undefined;
    let buf = '';
    const sock = net.connect(socketPath);
    const finish = (reply: HerdrReply): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.destroy();
      resolve(reply);
    };
    const timer = setTimeout(
      () => finish({ error: `herdr did not answer ${method} within ${timeoutMs} ms` }),
      timeoutMs,
    );

    sock.setEncoding('utf8');
    sock.on('connect', () => {
      sock.write(`${JSON.stringify({ jsonrpc: '2.0', id: '1', method, params: {} })}\n`);
    });
    sock.on('data', (chunk: string) => {
      buf += chunk;
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        const msg = parseJsonObject(line);
        if (msg?.['id'] !== '1') continue;
        const error = rpcErrorMessage(msg['error']);
        finish(error === undefined ? { result: msg['result'] } : { error });
        return;
      }
    });
    sock.on('error', (err: NodeJS.ErrnoException) => {
      failure = describeSocketError(err, socketPath);
    });
    sock.on('close', () =>
      finish({ error: failure ?? 'herdr closed the connection without answering' }),
    );
  });
}

/** The error herdr answered a subscription with, or undefined when it accepted it. */
function subscriptionError(line: string): string | undefined {
  const msg = parseJsonObject(line);
  if (!msg) {
    return `herdr answered with something other than JSON: ${line.slice(0, HERDR_REPLY_EXCERPT_CHARS)}`;
  }
  return rpcErrorMessage(msg['error']);
}

function parseJsonObject(line: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(line);
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** A JSON-RPC `error` member as text, or undefined when there is none. */
function rpcErrorMessage(error: unknown): string | undefined {
  if (error === undefined || error === null) return undefined;
  const message =
    typeof error === 'object' && 'message' in error && typeof error.message === 'string'
      ? error.message
      : JSON.stringify(error);
  return `herdr refused the request: ${message}`;
}

function describeSocketError(err: NodeJS.ErrnoException, socketPath: string): string {
  switch (err.code) {
    case 'ENOENT':
      return `no herdr socket at ${socketPath} (is herdr running?)`;
    case 'ECONNREFUSED':
      return `herdr is not listening on ${socketPath} (is herdr running?)`;
    case 'ECONNRESET':
    case 'EPIPE':
      return 'herdr dropped the connection';
    default:
      return err.message;
  }
}
