import * as fs from 'fs';
import * as path from 'path';

import type { ModuleHandle, RunningAgentModule } from '../../core/src/provider.js';
import { TRANSCRIPT_FOLLOW_RETRY_MS } from './constants.js';
import { canonicalSessionFile } from './pathKey.js';

/** What following a transcript needs from the runtime that parses it. */
export interface TranscriptAdoption {
  /** The directories holding the transcript module's project directories, each holding `<session id>.jsonl`. */
  sessionRoots(): string[];
  /** Put the session writing `file` on screen with its transcript watched, as agent `sessionId` reporting
   *  `sessionRef`. Returns the new agent, or undefined when an agent already reports the file or it is refused. */
  adopt(file: string, sessionId: string, sessionRef: string): number | undefined;
  /** End the session of an agent `adopt` created. */
  end(agentId: number): void;
}

interface FollowedSession {
  holders: number;
  agentId?: number;
  /** Retries finding the transcript, which the CLI only creates once the session's first record is written. */
  retry?: NodeJS.Timeout;
}

/**
 * The running side of the transcript module, which has no session discovery of its own: its transcripts are parsed
 * by the runtime. A multiplexer pane running that CLI hands its session ref here (the transcript path, or the
 * session id the transcript is named after), and the runtime watches the transcript like any adopted one, so the
 * pane shows tool activity and turn ends. A transcript some agent already reports (through hooks or the scanners)
 * stays with that agent and its own lifecycle.
 */
export class TranscriptFollower implements RunningAgentModule {
  private readonly followed = new Map<string, FollowedSession>();

  constructor(private readonly adoption: TranscriptAdoption) {}

  followSession(sessionRef: string): ModuleHandle {
    let session = this.followed.get(sessionRef);
    if (session) {
      session.holders++;
    } else {
      session = { holders: 1 };
      this.followed.set(sessionRef, session);
      if (!this.tryAdopt(sessionRef, session)) {
        session.retry = setInterval(() => {
          if (this.tryAdopt(sessionRef, session!)) clearInterval(session!.retry);
        }, TRANSCRIPT_FOLLOW_RETRY_MS);
      }
    }
    let stopped = false;
    return {
      stop: () => {
        if (stopped) return;
        stopped = true;
        this.release(sessionRef);
      },
    };
  }

  stop(): void {
    for (const session of this.followed.values()) clearInterval(session.retry);
    this.followed.clear();
  }

  /** Whether following `sessionRef` is settled: its transcript was adopted, or an agent already watches it. */
  private tryAdopt(sessionRef: string, session: FollowedSession): boolean {
    const file = this.findTranscript(sessionRef);
    if (!file) return false;
    session.agentId = this.adoption.adopt(
      file,
      path.basename(file, path.extname(file)),
      sessionRef,
    );
    return true;
  }

  private findTranscript(sessionRef: string): string | undefined {
    if (path.isAbsolute(sessionRef)) {
      return fs.existsSync(sessionRef) ? canonicalSessionFile(sessionRef) : undefined;
    }
    const fileName = `${sessionRef}.jsonl`;
    for (const root of this.adoption.sessionRoots()) {
      let projectDirs: fs.Dirent[];
      try {
        projectDirs = fs.readdirSync(root, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const dir of projectDirs) {
        if (!dir.isDirectory()) continue;
        const candidate = path.join(root, dir.name, fileName);
        if (fs.existsSync(candidate)) return canonicalSessionFile(candidate);
      }
    }
    return undefined;
  }

  private release(sessionRef: string): void {
    const session = this.followed.get(sessionRef);
    if (!session || --session.holders > 0) return;
    this.followed.delete(sessionRef);
    clearInterval(session.retry);
    if (session.agentId !== undefined) this.adoption.end(session.agentId);
  }
}
