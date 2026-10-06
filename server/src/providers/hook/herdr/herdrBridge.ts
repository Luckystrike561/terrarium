/**
 * Herdr bridge — connects the standalone Pixel Agents server to a local Herdr
 * instance so the office shows the live state of every agent Herdr manages.
 *
 * Herdr exposes a JSON-RPC 2.0 API over a Unix domain socket
 * (`~/.config/herdr/herdr.sock`). Two capabilities matter here:
 *   - `agent.list`        -> authoritative snapshot of every managed agent
 *                            (name, status, cwd, session .jsonl path)
 *   - `events.subscribe`  -> live pane lifecycle pushes (`pane.agent_detected`,
 *                            `pane.exited`) telling us when to re-snapshot
 * and, per agent, its omp session `.jsonl`, which we tail for the one-line tool
 * activity rendered on the character ("Reading PLAN.md").
 *
 * Everything is normalized into the wire envelope the server's hook route
 * accepts and POSTed to `http://127.0.0.1:<port>/api/hooks/herdr` with the
 * server bearer token. No prompt text, file contents or command output ever
 * leave the machine: only agent name, working directory, status and the
 * one-line tool label.
 *
 * Uses only node built-ins (net, fs, fetch) — no dependency added to the repo.
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

import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

// ── Tuning ───────────────────────────────────────────────────

const EVENT_RECONNECT_MS = 5000;
const SNAPSHOT_MS = 2500;
const RPC_TIMEOUT_MS = 6000;
const JSONL_POLL_MS = 1200;
/** Cap how much of a session file we ever read in one go (safety on big logs). */
const MAX_JSONL_BYTES = 2_000_000;

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
  pane_id?: string;
  terminal_id?: string;
  terminal_title_stripped?: string;
  agent_session?: HerdrAgentSession | null;
}

/** A tracked agent. Keyed by pane_id, which survives renames and status churn. */
interface TrackedAgent {
  paneId: string;
  sessionId: string;
  name: string;
  cwd: string;
  status: string;
  jsonlPath: string | null;
  jsonlOffset: number;
  jsonlBuffer: string;
}

export interface HerdrBridgeOptions {
  port: number;
  token: string;
  /** Test seam: override the socket path (default `~/.config/herdr/herdr.sock`). */
  socketPath?: string;
  log?: (msg: string) => void;
}

export class HerdrBridge {
  private readonly socketPath: string;
  private readonly hookUrl: string;
  private readonly token: string;
  private readonly log: (msg: string) => void;

  private eventsSock: net.Socket | null = null;
  private eventsBuf = '';
  private eventReconnect: ReturnType<typeof setTimeout> | null = null;

  private stopped = false;
  private snapshotTimer: ReturnType<typeof setInterval> | null = null;

  /** pane_id -> tracked agent */
  private readonly tracked = new Map<string, TrackedAgent>();
  private readonly jsonlTimers = new Map<string, ReturnType<typeof setInterval>>();

  private reconciling = false;
  private reconcileQueued = false;

  constructor(opts: HerdrBridgeOptions) {
    this.socketPath = opts.socketPath ?? path.join(os.homedir(), '.config', 'herdr', 'herdr.sock');
    this.hookUrl = `http://127.0.0.1:${opts.port}/api/hooks/herdr`;
    this.token = opts.token;
    this.log = opts.log ?? ((m) => console.log(`[Herdr bridge] ${m}`));
  }

  /** Connect once. Resolves true when herdr is reachable, false when it is not
   *  (the caller keeps running; we retry in the background). */
  async start(): Promise<boolean> {
    return await this.connectEvents();
  }

  stop(): void {
    this.stopped = true;
    if (this.eventReconnect) clearTimeout(this.eventReconnect);
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
    for (const t of this.jsonlTimers.values()) clearInterval(t);
    this.jsonlTimers.clear();
    this.eventsSock?.destroy();
    this.eventsSock = null;
  }

  // ── Long-lived event socket ────────────────────────────────

  private connectEvents(): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const sock = net.connect(this.socketPath);
      this.eventsSock = sock;
      this.eventsBuf = '';
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
        if (this.snapshotTimer) clearInterval(this.snapshotTimer);
        this.snapshotTimer = setInterval(() => void this.reconcile(), SNAPSHOT_MS);
        void this.reconcile();
        if (!settled) {
          settled = true;
          resolve(true);
        }
      });

      sock.on('data', (chunk: string) => this.onEventData(chunk));

      sock.on('error', () => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      });

      sock.on('close', () => {
        if (this.snapshotTimer) clearInterval(this.snapshotTimer);
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
          }, EVENT_RECONNECT_MS);
        }
      });
    });
  }

  private onEventData(chunk: string): void {
    this.eventsBuf += chunk;
    let idx: number;
    while ((idx = this.eventsBuf.indexOf('\n')) >= 0) {
      const line = this.eventsBuf.slice(0, idx);
      this.eventsBuf = this.eventsBuf.slice(idx + 1);
      if (!line.trim()) continue;
      // Any push (agent detected, pane exited) means the fleet changed: re-read
      // the authoritative snapshot rather than trusting the event payload shape.
      void this.reconcile();
    }
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
      const timer = setTimeout(() => finish(undefined), RPC_TIMEOUT_MS);

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

  // ── Reconciliation ─────────────────────────────────────────

  /** Re-read the authoritative snapshot and diff it against what we track.
   *  Coalesces concurrent calls so an event burst collapses into one pass. */
  private async reconcile(): Promise<void> {
    if (this.reconciling) {
      this.reconcileQueued = true;
      return;
    }
    this.reconciling = true;
    try {
      await this.reconcileOnce();
    } finally {
      this.reconciling = false;
      if (this.reconcileQueued) {
        this.reconcileQueued = false;
        void this.reconcile();
      }
    }
  }

  private async reconcileOnce(): Promise<void> {
    const res = (await this.rpcOnce('agent.list', {})) as { agents?: HerdrAgent[] } | undefined;
    const agents = res?.agents;
    if (!Array.isArray(agents)) return;

    const seen = new Set<string>();
    for (const a of agents) {
      const paneId = a.pane_id;
      const status = a.agent_status ?? 'unknown';
      // Only panes actually running a detectable agent.
      if (!paneId || status === 'unknown') continue;
      seen.add(paneId);
      const previous = this.tracked.get(paneId);

      if (!previous) {
        const cwd = a.foreground_cwd ?? a.cwd ?? '';
        const agent: TrackedAgent = {
          paneId,
          sessionId: `herdr-${paneId}`,
          name: a.name ?? (cwd ? path.basename(cwd) : paneId),
          cwd,
          status: '',
          jsonlPath: a.agent_session?.value ?? null,
          jsonlOffset: 0,
          jsonlBuffer: '',
        };
        this.tracked.set(paneId, agent);
        this.log(`agent detected: ${agent.name} (${paneId}, ${cwd || 'no cwd'})`);
        // SessionStart -> the server adopts a hooks-only agent (folder = cwd basename).
        await this.post({ session_id: agent.sessionId, hook_event_name: 'SessionStart', cwd });
        if (agent.jsonlPath) this.watchJsonl(agent);
        await this.applyStatus(agent, status);
        continue;
      }

      // Keep cwd/jsonl fresh (herdr can re-point a pane after a worktree move).
      previous.cwd = a.foreground_cwd ?? a.cwd ?? previous.cwd;
      const jsonl = a.agent_session?.value ?? null;
      if (jsonl && jsonl !== previous.jsonlPath) {
        previous.jsonlPath = jsonl;
        previous.jsonlOffset = 0;
        this.watchJsonl(previous);
      }
      await this.applyStatus(previous, status);
    }

    // Agents that vanished from the snapshot have ended.
    for (const [paneId, agent] of [...this.tracked]) {
      if (seen.has(paneId)) continue;
      await this.post({
        session_id: agent.sessionId,
        hook_event_name: 'SessionEnd',
        data: 'exit',
      });
      this.stopJsonl(paneId);
      this.tracked.delete(paneId);
      this.log(`agent ended: ${agent.name} (${paneId})`);
    }
  }

  /**
   * Map a herdr status (a *level*) to a hook event (a *transition*), emitting
   * only on change:
   *   blocked        -> PermissionRequest (needs approval)
   *   idle | done    -> Stop (turn finished -> character sits Down)
   *   working        -> handled by the per-tool JSONL events
   */
  private async applyStatus(agent: TrackedAgent, status: string): Promise<void> {
    if (status === agent.status) return;
    agent.status = status;

    if (status === 'blocked') {
      await this.post({ session_id: agent.sessionId, hook_event_name: 'PermissionRequest' });
    } else if (status === 'idle' || status === 'done') {
      await this.post({ session_id: agent.sessionId, hook_event_name: 'Stop' });
    }
  }

  // ── JSONL tailing (tool detail) ────────────────────────────

  private watchJsonl(agent: TrackedAgent): void {
    this.stopJsonl(agent.paneId);
    if (!agent.jsonlPath) return;
    try {
      const st = fs.statSync(agent.jsonlPath);
      // Start from the tail: historical tool calls are irrelevant, we only want
      // activity from now on.
      agent.jsonlOffset = Math.max(0, st.size - 8192);
    } catch {
      agent.jsonlOffset = 0;
    }
    this.jsonlTimers.set(
      agent.paneId,
      setInterval(() => this.pollJsonl(agent), JSONL_POLL_MS),
    );
  }

  private stopJsonl(paneId: string): void {
    const t = this.jsonlTimers.get(paneId);
    if (t) clearInterval(t);
    this.jsonlTimers.delete(paneId);
  }

  private pollJsonl(agent: TrackedAgent): void {
    const file = agent.jsonlPath;
    if (!file) return;
    let st: fs.Stats;
    try {
      st = fs.statSync(file);
    } catch {
      return; // file rotated/removed
    }
    if (st.size < agent.jsonlOffset) {
      // Truncated or replaced -> restart from the head.
      agent.jsonlOffset = 0;
      agent.jsonlBuffer = '';
    }
    if (st.size === agent.jsonlOffset) return;

    let chunk = '';
    try {
      const end = Math.min(st.size, agent.jsonlOffset + MAX_JSONL_BYTES);
      const len = end - agent.jsonlOffset;
      const buf = Buffer.allocUnsafe(len);
      const fd = fs.openSync(file, 'r');
      try {
        fs.readSync(fd, buf, 0, len, agent.jsonlOffset);
      } finally {
        fs.closeSync(fd);
      }
      agent.jsonlOffset = end;
      chunk = buf.toString('utf8');
    } catch {
      return;
    }

    agent.jsonlBuffer += chunk;
    let idx: number;
    while ((idx = agent.jsonlBuffer.indexOf('\n')) >= 0) {
      const line = agent.jsonlBuffer.slice(0, idx);
      agent.jsonlBuffer = agent.jsonlBuffer.slice(idx + 1);
      if (!line.trim()) continue;
      this.onJsonlLine(agent, line);
    }
  }

  private onJsonlLine(agent: TrackedAgent, line: string): void {
    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    if (rec['type'] !== 'custom' || rec['customType'] !== 'tool_execution_start') return;
    const data = (rec['data'] ?? {}) as Record<string, unknown>;
    void this.post({ session_id: agent.sessionId, hook_event_name: 'PreToolUse', data });
  }

  // ── HTTP delivery ──────────────────────────────────────────

  private async post(payload: Record<string, unknown>): Promise<void> {
    try {
      await fetch(this.hookUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify(payload),
      });
    } catch {
      // Server not up yet / shutting down — the next snapshot tick retries.
    }
  }
}
