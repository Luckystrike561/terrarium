import type { AgentEvent } from '../../core/src/provider.js';
import { HOOK_EVENT_BUFFER_MS } from './constants.js';

/** Pending external session info (waiting for confirmation event before creating agent). */
export interface PendingExternalSession {
  sessionId: string;
  /** Transcript file path. Undefined for providers without transcripts (OpenCode, Copilot). */
  transcriptPath: string | undefined;
  /** File the session writes, as announced by a module (see AgentEvent sessionStart.sessionFile). */
  sessionFile?: string;
  cwd: string;
  /** Every module that announced this session. Decides whether it is adopted outside the workspace and which agent
   *  module it belongs to. */
  sourceIds: string[];
}

/** A normalized event on its way to an agent, with the module it came from. */
export interface RoutedEvent {
  sourceId: string;
  sessionId: string;
  event: AgentEvent;
  /** The payload as received, for the team handlers that read identity fields AgentEvent does not carry. */
  raw: Record<string, unknown>;
}

/** An event waiting to be dispatched once its agent registers. */
interface BufferedEvent {
  routed: RoutedEvent;
  timestamp: number;
}

/**
 * Maps session IDs to agent IDs, manages pending external sessions, and
 * buffers events that arrive before their agent registers.
 *
 * Extracted from HookEventHandler to separate session-routing concerns
 * from event dispatch and webview messaging.
 */
export class SessionRouter {
  private sessionToAgentId = new Map<string, number>();
  private pendingSessions = new Map<string, PendingExternalSession>();
  private buffer: BufferedEvent[] = [];
  private bufferTimer: ReturnType<typeof setInterval> | null = null;

  // ── Session → Agent mapping ────────────────────────────────────────

  /** Register a session→agent mapping. Returns any buffered events for this
   *  session so the caller can re-dispatch them. */
  register(sessionId: string, agentId: number): RoutedEvent[] {
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

  // ── Pending external sessions ──────────────────────────────────────

  /** Store (or extend) a pending session. Several modules may announce the same session before it is confirmed;
   *  the latest announcement's fields win and the sources accumulate. */
  storePending(sessionId: string, info: PendingExternalSession): void {
    const previous = this.pendingSessions.get(sessionId);
    if (!previous) {
      this.pendingSessions.set(sessionId, info);
      return;
    }
    this.pendingSessions.set(sessionId, {
      sessionId,
      transcriptPath: info.transcriptPath ?? previous.transcriptPath,
      sessionFile: info.sessionFile ?? previous.sessionFile,
      cwd: info.cwd || previous.cwd,
      sourceIds: [...new Set([...previous.sourceIds, ...info.sourceIds])],
    });
  }

  confirmPending(sessionId: string): PendingExternalSession | undefined {
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

  bufferEvent(routed: RoutedEvent): void {
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

  private flushBuffered(sessionId: string): RoutedEvent[] {
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
