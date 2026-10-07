/**
 * Herdr bridge — reads which agents a local Herdr instance hosts.
 *
 * Herdr exposes a JSON-RPC 2.0 API over a Unix domain socket
 * (`~/.config/herdr/herdr.sock`). Two capabilities matter here:
 *   - `agent.list`        -> authoritative snapshot of every managed agent
 *                            (kind, status, cwd, session file path)
 *   - `events.subscribe`  -> live pane lifecycle pushes (`pane.agent_detected`,
 *                            `pane.exited`) telling us when to re-snapshot
 *
 * Each snapshot is reduced to MultiplexedAgents (name, task, status level, session file) and handed to the caller.
 * The bridge never reads a transcript: what an agent is doing comes from the agent module for its kind.
 *
 * Uses only node built-ins (net) — no dependency added to the repo.
 *
 * Protocol notes (protocol 22, learned the hard way):
 *   - Connection semantics differ by request type. A connection that carries a
 *     plain request (`agent.list`, ...) is **closed by herdr right after the
 *     reply** (one-shot), while a connection that carries `events.subscribe`
 *     stays open to stream pushes. Mixing both on one socket tears it down, so
 *     we keep a dedicated long-lived socket for events and open a throwaway
 *     socket per snapshot poll.
 *   - Subscription variants are dotted (`pane.agent_detected`, `pane.exited`).
 *     `pane.agent_status_changed` additionally requires a `pane_id`; we never
 *     subscribe to it, status transitions come from the snapshot poll.
 */

import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

import type { MultiplexedAgent, MultiplexedAgentStatus } from '../../../../core/src/provider.js';
import {
  HERDR_EVENT_RECONNECT_MS,
  HERDR_RPC_TIMEOUT_MS,
  HERDR_SNAPSHOT_INTERVAL_MS,
  HERDR_SOCKET_PATH_SEGMENTS,
} from './constants.js';

// ── Herdr shapes (subset we rely on) ─────────────────────────

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

/** herdr's status levels. `done` (finished, waiting on the user) reads as idle; `unknown` panes are not agents. */
const STATUS_LEVELS: Record<string, MultiplexedAgentStatus> = {
  working: 'working',
  blocked: 'blocked',
  idle: 'idle',
  done: 'idle',
};

/** omp titles its terminal `π <spinner|>> <task>`; other agents prefix a status glyph. */
function taskFromTerminalTitle(title: string | undefined): string {
  return (title ?? '')
    .trim()
    .replace(/^π\s+/u, '')
    .replace(/^[^\p{L}\p{N}\s]+\s+/u, '')
    .trim();
}

export interface HerdrBridgeOptions {
  onSnapshot: (agents: readonly MultiplexedAgent[]) => void;
  log: (msg: string) => void;
  /** Test seam: override the socket path (default `~/.config/herdr/herdr.sock`). */
  socketPath?: string;
}

export class HerdrBridge {
  private readonly socketPath: string;
  private readonly onSnapshot: (agents: readonly MultiplexedAgent[]) => void;
  private readonly log: (msg: string) => void;

  private eventsSock: net.Socket | null = null;
  private eventReconnect: NodeJS.Timeout | null = null;

  private stopped = false;
  private snapshotTimer: NodeJS.Timeout | null = null;

  private reconciling = false;
  private reconcileQueued = false;

  constructor(opts: HerdrBridgeOptions) {
    this.socketPath = opts.socketPath ?? path.join(os.homedir(), ...HERDR_SOCKET_PATH_SEGMENTS);
    this.onSnapshot = opts.onSnapshot;
    this.log = opts.log;
  }

  /** Connect once. Resolves true when herdr is reachable, false when it is not
   *  (the caller keeps running; we retry in the background). */
  async start(): Promise<boolean> {
    return await this.connectEvents();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.eventReconnect ?? undefined);
    clearInterval(this.snapshotTimer ?? undefined);
    this.eventsSock?.destroy();
    this.eventsSock = null;
  }

  // ── Long-lived event socket ────────────────────────────────

  private connectEvents(): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      let buffered = '';
      const sock = net.connect(this.socketPath);
      this.eventsSock = sock;
      sock.setEncoding('utf8');

      sock.on('connect', () => {
        // Only ever a subscription on this socket — see protocol notes.
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
        this.log(`connected to ${this.socketPath}`);
        // The snapshot poll is the authoritative source for status transitions
        // (not subscribable without a pane_id) and also catches silent churn.
        clearInterval(this.snapshotTimer ?? undefined);
        this.snapshotTimer = setInterval(() => void this.reconcile(), HERDR_SNAPSHOT_INTERVAL_MS);
        void this.reconcile();
        if (!settled) {
          settled = true;
          resolve(true);
        }
      });

      sock.on('data', (chunk: string) => {
        buffered += chunk;
        let idx: number;
        while ((idx = buffered.indexOf('\n')) >= 0) {
          const line = buffered.slice(0, idx);
          buffered = buffered.slice(idx + 1);
          // Any push (agent detected, pane exited) means the fleet changed: re-read
          // the authoritative snapshot rather than trusting the event payload shape.
          if (line.trim()) void this.reconcile();
        }
      });

      sock.on('error', () => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      });

      sock.on('close', () => {
        clearInterval(this.snapshotTimer ?? undefined);
        this.snapshotTimer = null;
        this.eventsSock = null;
        if (!settled) {
          settled = true;
          resolve(false);
        }
        if (!this.stopped) {
          this.eventReconnect = setTimeout(() => {
            this.eventReconnect = null;
            void this.connectEvents();
          }, HERDR_EVENT_RECONNECT_MS);
        }
      });
    });
  }

  // ── One-shot RPC (throwaway socket per call) ───────────────

  private rpcOnce(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve) => {
      let settled = false;
      const sock = net.connect(this.socketPath);
      let buf = '';
      const finish = (v: unknown): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          sock.destroy();
        } catch {
          /* already gone */
        }
        resolve(v);
      };
      const timer = setTimeout(() => finish(undefined), HERDR_RPC_TIMEOUT_MS);

      sock.setEncoding('utf8');
      sock.on('connect', () => {
        sock.write(`${JSON.stringify({ jsonrpc: '2.0', id: '1', method, params })}\n`);
      });
      sock.on('data', (chunk: string) => {
        buf += chunk;
        let idx: number;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          if (!line.trim()) continue;
          let msg: Record<string, unknown>;
          try {
            msg = JSON.parse(line) as Record<string, unknown>;
          } catch {
            continue;
          }
          if (msg['id'] === '1') {
            finish(msg['result'] ?? msg['error']);
            return;
          }
        }
      });
      sock.on('error', () => finish(undefined));
      sock.on('close', () => finish(undefined));
    });
  }

  // ── Snapshots ──────────────────────────────────────────────

  /** Re-read the authoritative snapshot. Coalesces concurrent calls so an event burst collapses into one pass. */
  private async reconcile(): Promise<void> {
    if (this.reconciling) {
      this.reconcileQueued = true;
      return;
    }
    this.reconciling = true;
    try {
      const agents = await this.readAgents();
      if (agents && !this.stopped) this.onSnapshot(agents);
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
      this.rpcOnce('agent.list', {}) as Promise<{ agents?: HerdrAgent[] } | undefined>,
      this.rpcOnce('workspace.list', {}) as Promise<{ workspaces?: HerdrLabeled[] } | undefined>,
      this.rpcOnce('tab.list', {}) as Promise<{ tabs?: HerdrLabeled[] } | undefined>,
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
        sessionFile: a.agent_session?.value || undefined,
      };
    });
  }
}
