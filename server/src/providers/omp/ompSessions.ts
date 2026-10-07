import * as fs from 'node:fs';
import * as path from 'node:path';

import type {
  ModuleHandle,
  ModuleHost,
  RunningAgentModule,
} from '../../../../core/src/provider.js';
import { canonicalSessionFile } from '../../pathKey.js';
import {
  OMP_DISCOVERY_INTERVAL_MS,
  OMP_MAX_READ_BYTES,
  OMP_SESSION_ACTIVE_WINDOW_MS,
  OMP_SESSION_FILE_SUFFIX,
  OMP_TAIL_POLL_MS,
} from './constants.js';
import {
  eventForTranscriptLine,
  readAppended,
  readSessionCwd,
  readTranscriptState,
} from './ompTranscript.js';

const NEWLINE = 0x0a;

/** A transcript being tailed. Alive while anything holds it: the discovery scan, or a multiplexer that found the
 *  session in one of its panes. */
interface TrackedSession {
  readonly holders: Set<symbol>;
  offset: number;
  /** Bytes after the last complete line, carried to the next poll. */
  pending: Buffer;
  readonly timer: NodeJS.Timeout;
}

/**
 * Turns omp transcripts into AgentEvents. Session id = the transcript path, which is also the `sessionFile` a
 * multiplexer reports for the same agent, so both land on one character.
 *
 * Discovery: every transcript in omp's session store written to within the active window is a live session, unless
 * its last record is `session_exit`. Tailing starts at the end of the file: history is never replayed, the last
 * records only decide whether the character starts working or idle.
 */
export class OmpSessionTracker implements RunningAgentModule {
  private readonly sessions = new Map<string, TrackedSession>();
  /** Transcripts whose session already exited, with their size then. One that grows again is live again. */
  private readonly exitedAtSize = new Map<string, number>();
  private readonly discovery = Symbol('discovery');
  private readonly discoveryTimer: NodeJS.Timeout;

  constructor(
    private readonly host: ModuleHost,
    private readonly sessionsRoot: string,
  ) {
    this.discover();
    this.discoveryTimer = setInterval(() => this.discover(), OMP_DISCOVERY_INTERVAL_MS);
  }

  followSession(sessionFile: string): ModuleHandle {
    const holder = Symbol('follow');
    const file = canonicalSessionFile(sessionFile);
    this.hold(file, holder);
    return { stop: () => this.release(file, holder) };
  }

  stop(): void {
    clearInterval(this.discoveryTimer);
    for (const session of this.sessions.values()) clearInterval(session.timer);
    this.sessions.clear();
  }

  // ── Discovery ──────────────────────────────────────────────

  private discover(): void {
    const live = new Set<string>();
    const now = Date.now();
    for (const listed of this.listTranscripts()) {
      let stat: fs.Stats;
      try {
        stat = fs.statSync(listed);
      } catch {
        continue; // removed between readdir and stat
      }
      if (now - stat.mtimeMs > OMP_SESSION_ACTIVE_WINDOW_MS) continue;
      const file = canonicalSessionFile(listed);
      const exitedSize = this.exitedAtSize.get(file);
      if (exitedSize !== undefined && stat.size <= exitedSize) continue;
      if (exitedSize === undefined && !this.sessions.has(file)) {
        if (readTranscriptState(file, stat.size) === 'exited') {
          this.exitedAtSize.set(file, stat.size);
          continue;
        }
      }
      live.add(file);
      this.hold(file, this.discovery);
    }
    for (const [file, session] of this.sessions) {
      if (session.holders.has(this.discovery) && !live.has(file))
        this.release(file, this.discovery);
    }
  }

  private listTranscripts(): string[] {
    let projectDirs: fs.Dirent[];
    try {
      projectDirs = fs.readdirSync(this.sessionsRoot, { withFileTypes: true });
    } catch {
      return []; // omp never ran on this machine
    }
    const files: string[] = [];
    for (const dir of projectDirs) {
      if (!dir.isDirectory()) continue;
      const dirPath = path.join(this.sessionsRoot, dir.name);
      let entries: string[];
      try {
        entries = fs.readdirSync(dirPath);
      } catch {
        continue;
      }
      for (const name of entries) {
        if (name.endsWith(OMP_SESSION_FILE_SUFFIX)) files.push(path.join(dirPath, name));
      }
    }
    return files;
  }

  // ── Tracking ───────────────────────────────────────────────

  private hold(file: string, holder: symbol): void {
    const tracked = this.sessions.get(file);
    if (tracked) {
      tracked.holders.add(holder);
      return;
    }
    let size = 0;
    try {
      size = fs.statSync(file).size;
    } catch {
      // Not written yet: tail from the start once it appears.
    }
    this.sessions.set(file, {
      holders: new Set([holder]),
      offset: size,
      pending: Buffer.alloc(0),
      timer: setInterval(() => this.poll(file), OMP_TAIL_POLL_MS),
    });
    this.host.emit(file, {
      kind: 'sessionStart',
      source: 'startup',
      sessionFile: file,
      cwd: readSessionCwd(file, size) || undefined,
    });
    // The first non-start event is what makes the runtime create the character.
    this.host.emit(
      file,
      readTranscriptState(file, size) === 'working' ? { kind: 'working' } : { kind: 'turnEnd' },
    );
  }

  private release(file: string, holder: symbol): void {
    const session = this.sessions.get(file);
    if (!session || !session.holders.delete(holder) || session.holders.size > 0) return;
    this.end(file, session);
  }

  private end(file: string, session: TrackedSession): void {
    clearInterval(session.timer);
    this.sessions.delete(file);
    this.host.emit(file, { kind: 'sessionEnd', reason: 'exit' });
  }

  private poll(file: string): void {
    const session = this.sessions.get(file);
    if (!session) return;
    let size: number;
    try {
      size = fs.statSync(file).size;
    } catch {
      return; // rotated or not created yet
    }
    if (size < session.offset) {
      // Truncated or replaced: start over from the head.
      session.offset = 0;
      session.pending = Buffer.alloc(0);
    }
    if (size === session.offset) return;
    let appended: Buffer;
    try {
      appended = readAppended(file, session.offset, size, OMP_MAX_READ_BYTES);
    } catch {
      return;
    }
    session.offset += appended.length;
    let buffer = Buffer.concat([session.pending, appended]);
    let newline: number;
    while ((newline = buffer.indexOf(NEWLINE)) >= 0) {
      const event = eventForTranscriptLine(buffer.subarray(0, newline).toString('utf8'));
      buffer = buffer.subarray(newline + 1);
      if (!event) continue;
      if (event.kind === 'sessionEnd') {
        this.exitedAtSize.set(file, size);
        this.end(file, session);
        return;
      }
      this.host.emit(file, event);
    }
    session.pending = buffer;
  }
}
