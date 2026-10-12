import type { AgentEvent } from '../../core/src/provider.js';
import { HOOK_EVENT_BUFFER_MS } from './constants.js';

/** A session announced but not confirmed yet (waiting for its first event before an agent is created for it). */
export interface PendingSession {
  sessionId: string;
  /** The session's identity, as announced by a module (see AgentEvent sessionStart.sessionRef). */
  sessionRef?: string;
  cwd: string;
  /** Every module that announced this session. Decides which agent module it belongs to. */
  sourceIds: string[];
}

/** A normalized event on its way to an agent, with the module it came from. */
export interface RoutedEvent {
  sourceId: string;
  sessionId: string;
  event: AgentEvent;
}

/** An event waiting to be dispatched once its agent registers. */
interface BufferedEvent<E> {
  routed: E;
  timestamp: number;
}

/**
 * Maps session IDs to agent IDs, manages pending sessions, and buffers events that arrive before their agent
 * registers. Generic over the routed event and the pending-session record, so a module routing its own CLI's
 * sessions can carry fields the runtime never sees.
 */
export class SessionRouter<
  E extends { sessionId: string } = RoutedEvent,
  P extends PendingSession = PendingSession,
> {
  private sessionToAgentId = new Map<string, number>();
  private pendingSessions = new Map<string, P>();
  private buffer: Array<BufferedEvent<E>> = [];
  private bufferTimer: NodeJS.Timeout | null = null;

  // ── Session → Agent mapping ────────────────────────────────────────

  /** Register a session→agent mapping. Returns any buffered events for this
   *  session so the caller can re-dispatch them. */
  register(sessionId: string, agentId: number): E[] {
    this.sessionToAgentId.set(sessionId, agentId);
    return this.flushBuffered(sessionId);
  }

  unregister(sessionId: string): void {
    this.sessionToAgentId.delete(sessionId);
  }

  resolve(sessionId: string): number | undefined {
    return this.sessionToAgentId.get(sessionId);
  }

  hasSession(sessionId: string): boolean {
    return this.sessionToAgentId.has(sessionId);
  }

  /** Every session id routed to `agentId`. */
  sessionsOf(agentId: number): string[] {
    return [...this.sessionToAgentId]
      .filter(([, id]) => id === agentId)
      .map(([session]) => session);
  }

  // ── Pending sessions ───────────────────────────────────────────────

  /** Store (or extend) a pending session. Several modules may announce the same session before it is confirmed;
   *  the latest announcement's defined fields win and the sources accumulate. */
  storePending(sessionId: string, info: P): void {
    const previous = this.pendingSessions.get(sessionId);
    if (!previous) {
      this.pendingSessions.set(sessionId, info);
      return;
    }
    const defined = Object.fromEntries(Object.entries(info).filter(([, v]) => v !== undefined));
    this.pendingSessions.set(sessionId, {
      ...previous,
      ...defined,
      cwd: info.cwd || previous.cwd,
      sourceIds: [...new Set([...previous.sourceIds, ...info.sourceIds])],
    });
  }

  confirmPending(sessionId: string): P | undefined {
    const info = this.pendingSessions.get(sessionId);
    if (info) this.pendingSessions.delete(sessionId);
    return info;
  }

  hasPending(sessionId: string): boolean {
    return this.pendingSessions.has(sessionId);
  }

  discardPending(sessionId: string): void {
    this.pendingSessions.delete(sessionId);
  }

  // ── Event buffering ────────────────────────────────────────────────

  bufferEvent(routed: E): void {
    this.buffer.push({ routed, timestamp: Date.now() });
    if (!this.bufferTimer) {
      this.bufferTimer = setInterval(() => {
        this.pruneExpired();
      }, HOOK_EVENT_BUFFER_MS);
    }
  }

  hasBuffered(sessionId: string): boolean {
    return this.buffer.some((b) => b.routed.sessionId === sessionId);
  }

  pruneExpired(): void {
    const cutoff = Date.now() - HOOK_EVENT_BUFFER_MS;
    this.buffer = this.buffer.filter((b) => b.timestamp > cutoff);
    this.cleanupBufferTimer();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  dispose(): void {
    if (this.bufferTimer) {
      clearInterval(this.bufferTimer);
      this.bufferTimer = null;
    }
    this.sessionToAgentId.clear();
    this.buffer = [];
    this.pendingSessions.clear();
  }

  // ── Private ────────────────────────────────────────────────────────

  private flushBuffered(sessionId: string): E[] {
    const toFlush = this.buffer.filter((b) => b.routed.sessionId === sessionId);
    this.buffer = this.buffer.filter((b) => b.routed.sessionId !== sessionId);
    this.cleanupBufferTimer();
    return toFlush.map((b) => b.routed);
  }

  private cleanupBufferTimer(): void {
    if (this.buffer.length === 0 && this.bufferTimer) {
      clearInterval(this.bufferTimer);
      this.bufferTimer = null;
    }
  }
}
