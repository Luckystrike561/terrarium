import type {
  AgentEvent,
  ModuleHandle,
  ModuleHost,
  RunningAgentModule,
} from '../../../../core/src/provider.js';
import { canonicalSessionFile, pathsMatch } from '../../pathKey.js';

export type SessionState = 'working' | 'idle' | 'exited';

/** A session as the store lists it: its identity, when it last changed, and a size that grows with every record. */
export interface ListedSession {
  /** The session's identity: the `sessionRef` a multiplexer reports for the same agent. */
  readonly key: string;
  readonly mtimeMs: number;
  readonly size: number;
}

/** One session, read from where it stood when opened. History is never replayed. */
export interface SessionCursor {
  /** Working directory the session runs in, or '' when the store does not say. */
  readonly cwd: string;
  /** Where the session stood when opened, from its last records. Decides only the state a character starts in. */
  readonly state: SessionState;
  /** How far the cursor has read, on the same scale as `ListedSession.size`. */
  readonly size: number;
  /** Events recorded since the previous read. */
  read(): AgentEvent[];
}

/** An agent CLI's session store. */
export interface SessionStore {
  listSessions(): ListedSession[];
  /** Open `key` at its current end, or null when it cannot be read yet. */
  open(key: string): SessionCursor | null;
  /** The key a multiplexer's session ref names in this store. Defaults to the file's real path, for stores whose
   *  sessions are files; stores keyed by the CLI's own session id return the ref unchanged. */
  canonicalKey?(sessionRef: string): string;
}

export interface SessionStoreTiming {
  /** How often the store is rescanned for sessions that started or went quiet. */
  readonly discoveryMs: number;
  /** How often a tracked session is read for new records. */
  readonly pollMs: number;
  /** A session untouched for this long is no longer discovered as live. Bounds how long a crashed session lingers. */
  readonly activeWindowMs: number;
}

/** A session being read. Alive while anything holds it: the discovery scan, or a multiplexer that found the session
 *  in one of its panes. */
interface TrackedSession {
  readonly holders: Set<symbol>;
  cursor: SessionCursor | null;
  readonly timer: NodeJS.Timeout;
}

/**
 * Turns an agent CLI's session store into AgentEvents. Session id = the store's key, which is also the `sessionRef`
 * a multiplexer reports for the same agent, so both land on one character.
 *
 * Discovery: every session changed within the active window is live, unless its last records say it exited.
 */
export class SessionStoreTracker implements RunningAgentModule {
  private readonly sessions = new Map<string, TrackedSession>();
  /** Sessions that already exited, with their size then. One that grows again is live again. */
  private readonly exitedAtSize = new Map<string, number>();
  private readonly discovery = Symbol('discovery');
  private readonly discoveryTimer: NodeJS.Timeout;

  constructor(
    private readonly host: ModuleHost,
    private readonly store: SessionStore,
    private readonly timing: SessionStoreTiming,
  ) {
    this.discover();
    this.discoveryTimer = setInterval(() => this.discover(), timing.discoveryMs);
  }

  followSession(sessionRef: string): ModuleHandle {
    const holder = Symbol('follow');
    const key = this.store.canonicalKey?.(sessionRef) ?? canonicalSessionFile(sessionRef);
    this.hold(key, holder, this.sessions.has(key) ? null : this.store.open(key));
    return { stop: () => this.release(key, holder) };
  }

  sessionInDirectory(cwd: string): string | undefined {
    const matches = [...this.sessions].filter(
      ([, session]) => session.cursor?.cwd && pathsMatch(session.cursor.cwd, cwd),
    );
    return matches.length === 1 ? matches[0][0] : undefined;
  }

  stop(): void {
    clearInterval(this.discoveryTimer);
    for (const session of this.sessions.values()) clearInterval(session.timer);
    this.sessions.clear();
  }

  private discover(): void {
    const live = new Set<string>();
    const now = Date.now();
    for (const listed of this.store.listSessions()) {
      if (now - listed.mtimeMs > this.timing.activeWindowMs) continue;
      const exitedSize = this.exitedAtSize.get(listed.key);
      if (exitedSize !== undefined && listed.size <= exitedSize) continue;
      if (this.sessions.has(listed.key)) {
        live.add(listed.key);
        this.hold(listed.key, this.discovery, null);
        continue;
      }
      const cursor = this.store.open(listed.key);
      if (cursor?.state === 'exited') {
        this.exitedAtSize.set(listed.key, listed.size);
        continue;
      }
      this.exitedAtSize.delete(listed.key);
      live.add(listed.key);
      this.hold(listed.key, this.discovery, cursor);
    }
    for (const [key, session] of this.sessions) {
      if (session.holders.has(this.discovery) && !live.has(key)) this.release(key, this.discovery);
    }
  }

  private hold(key: string, holder: symbol, cursor: SessionCursor | null): void {
    const tracked = this.sessions.get(key);
    if (tracked) {
      tracked.holders.add(holder);
      return;
    }
    this.sessions.set(key, {
      holders: new Set([holder]),
      cursor,
      timer: setInterval(() => this.poll(key), this.timing.pollMs),
    });
    this.host.emit(key, {
      kind: 'sessionStart',
      source: 'startup',
      sessionRef: key,
      cwd: cursor?.cwd || undefined,
    });
    // The first non-start event is what makes the runtime create the character.
    this.host.emit(key, cursor?.state === 'working' ? { kind: 'working' } : { kind: 'turnEnd' });
  }

  private release(key: string, holder: symbol): void {
    const session = this.sessions.get(key);
    if (!session || !session.holders.delete(holder) || session.holders.size > 0) return;
    this.end(key, session);
  }

  private end(key: string, session: TrackedSession): void {
    clearInterval(session.timer);
    this.sessions.delete(key);
    this.host.emit(key, { kind: 'sessionEnd', reason: 'exit' });
  }

  private poll(key: string): void {
    const session = this.sessions.get(key);
    if (!session) return;
    session.cursor ??= this.store.open(key);
    if (!session.cursor) return;
    for (const event of session.cursor.read()) {
      if (event.kind === 'sessionEnd') {
        this.exitedAtSize.set(key, session.cursor.size);
        this.end(key, session);
        return;
      }
      this.host.emit(key, event);
    }
  }
}
