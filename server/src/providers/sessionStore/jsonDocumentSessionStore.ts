import * as fs from 'node:fs';

import type { AgentEvent } from '../../../../core/src/provider.js';
import type { JsonlFormat, JsonRecord } from './jsonlSessionStore.js';
import { listTranscriptFiles, stateFromEvents } from './jsonlSessionStore.js';
import type { ListedSession, SessionCursor, SessionStore } from './sessionStoreTracker.js';

/** How one CLI's whole-document session files read: the CLI rewrites the file on every change. */
export interface JsonDocumentFormat extends JsonlFormat {
  /** The session's records, oldest first. New records are appended to this list between rewrites. */
  records(document: unknown): JsonRecord[];
}

export interface JsonDocumentStoreOptions {
  readonly root: string;
  readonly depth: number;
  readonly isTranscript: (fileName: string, filePath: string) => boolean;
  readonly format: JsonDocumentFormat;
  /** The CLI's own id for the session, when its multiplexer integration reports one. Absent: keyed by real path. */
  readonly sessionIdOf?: (file: string) => string;
  /** The working directory recorded beside the session file. */
  readonly cwdOf?: (file: string) => string;
}

function readRecords(file: string, format: JsonDocumentFormat): JsonRecord[] | null {
  try {
    return format.records(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return null; // missing, or caught mid-rewrite: try again on the next read
  }
}

const eventsOf = (records: JsonRecord[], format: JsonDocumentFormat): AgentEvent[] =>
  records.flatMap((record) => format.events(record));

class JsonDocumentCursor implements SessionCursor {
  readonly cwd: string;
  readonly state;
  private count: number;
  private stat: { mtimeMs: number; size: number };

  constructor(
    private readonly file: string,
    private readonly format: JsonDocumentFormat,
    cwdOf: ((file: string) => string) | undefined,
  ) {
    this.stat = statOf(file);
    const records = readRecords(file, format) ?? [];
    this.count = records.length;
    this.cwd = records.map((r) => format.cwd(r)).find(Boolean) ?? cwdOf?.(file) ?? '';
    this.state = stateFromEvents(eventsOf(records, format));
  }

  /** File bytes at the last read, on the same scale the store lists sessions by. */
  get size(): number {
    return this.stat.size;
  }

  read(): AgentEvent[] {
    const stat = statOf(this.file);
    if (stat.mtimeMs === this.stat.mtimeMs) return [];
    const records = readRecords(this.file, this.format);
    if (!records) return [];
    this.stat = stat;
    // A shorter list was rewound or compacted: nothing new to show, read on from its new end.
    const fresh = records.length > this.count ? records.slice(this.count) : [];
    this.count = records.length;
    return eventsOf(fresh, this.format);
  }
}

function statOf(file: string): { mtimeMs: number; size: number } {
  try {
    const { mtimeMs, size } = fs.statSync(file);
    return { mtimeMs, size };
  } catch {
    return { mtimeMs: 0, size: 0 };
  }
}

/** A session store of whole-document JSON files, one per session, rewritten by the CLI on every change. */
export function jsonDocumentSessionStore(options: JsonDocumentStoreOptions): SessionStore {
  const { sessionIdOf } = options;
  const fileOfId = new Map<string, string>();

  const listSessions = (): ListedSession[] => {
    const listed: ListedSession[] = [];
    for (const file of listTranscriptFiles(options.root, options.depth, options.isTranscript)) {
      try {
        const realFile = fs.realpathSync(file);
        const key = sessionIdOf ? sessionIdOf(realFile) : realFile;
        if (sessionIdOf) fileOfId.set(key, realFile);
        const stat = fs.statSync(realFile);
        listed.push({ key, mtimeMs: stat.mtimeMs, size: stat.size });
      } catch {
        // removed between readdir and stat
      }
    }
    return listed;
  };

  return {
    listSessions,
    canonicalKey: sessionIdOf ? (sessionRef) => sessionRef : undefined,
    open(key) {
      if (sessionIdOf && !fileOfId.has(key)) listSessions();
      const file = sessionIdOf ? fileOfId.get(key) : key;
      return file ? new JsonDocumentCursor(file, options.format, options.cwdOf) : null;
    },
  };
}
