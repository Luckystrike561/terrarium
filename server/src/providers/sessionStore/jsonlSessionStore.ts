import * as fs from 'node:fs';
import * as path from 'node:path';

import type { AgentEvent } from '../../../../core/src/provider.js';
import {
  SESSION_HEAD_MAX_BYTES,
  SESSION_MAX_READ_BYTES,
  SESSION_STATE_TAIL_BYTES,
} from './constants.js';
import type {
  ListedSession,
  SessionCursor,
  SessionState,
  SessionStore,
} from './sessionStoreTracker.js';

export type JsonRecord = Record<string, unknown>;

/** How one CLI's JSONL transcripts read. */
export interface JsonlFormat {
  /** The events one record stands for, in order. Most records stand for none. */
  events(record: JsonRecord): AgentEvent[];
  /** The working directory a record names, for records near the head of the transcript. */
  cwd(record: JsonRecord): string | undefined;
}

export interface JsonlStoreOptions {
  /** Directory holding the transcripts. */
  readonly root: string;
  /** How many directory levels below `root` the transcripts sit (0 = directly in it). */
  readonly depth: number;
  /** Whether a file is a transcript, by its name or its full path (for stores that keep other files of the same
   *  name beside the transcripts, such as sub-agent logs). */
  readonly isTranscript: (fileName: string, filePath: string) => boolean;
  readonly format: JsonlFormat;
  /** The CLI's own id for the session a transcript holds, for CLIs whose multiplexer integration reports that id.
   *  Sessions are then keyed by it. Absent: keyed by the transcript's real path. */
  readonly sessionIdOf?: (file: string) => string;
  /** The working directory recorded beside the transcript, for CLIs that keep it out of the transcript itself. */
  readonly cwdOf?: (file: string) => string;
}

const NEWLINE = 0x0a;

export function parseJsonRecord(line: string): JsonRecord | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as JsonRecord)
      : null;
  } catch {
    return null; // a partial or foreign line carries nothing to show
  }
}

export const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export const obj = (v: unknown): JsonRecord =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as JsonRecord) : {};

function readRange(file: string, start: number, length: number): Buffer {
  const buf = Buffer.alloc(Math.max(0, length));
  const fd = fs.openSync(file, 'r');
  try {
    return buf.subarray(0, fs.readSync(fd, buf, 0, buf.length, start));
  } finally {
    fs.closeSync(fd);
  }
}

function fileSize(file: string): number | undefined {
  try {
    return fs.statSync(file).size;
  } catch {
    return undefined;
  }
}

/** Files `depth` directory levels below `dir` that `isTranscript` accepts. */
export function listTranscriptFiles(
  dir: string,
  depth: number,
  isTranscript: (fileName: string, filePath: string) => boolean,
): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return []; // the CLI never ran on this machine, or the directory went away
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (depth > 0) {
      if (entry.isDirectory()) files.push(...listTranscriptFiles(full, depth - 1, isTranscript));
    } else if (entry.isFile() && isTranscript(entry.name, full)) {
      files.push(full);
    }
  }
  return files;
}

function readCwd(file: string, size: number, format: JsonlFormat): string {
  try {
    const head = readRange(file, 0, Math.min(size, SESSION_HEAD_MAX_BYTES)).toString('utf8');
    for (const line of head.split('\n')) {
      const record = parseJsonRecord(line);
      const cwd = record ? format.cwd(record) : undefined;
      if (cwd) return cwd;
    }
  } catch {
    // unreadable head: the store does not say
  }
  return '';
}

/** Where the session stands at the end of the transcript, from its last records. */
export function stateFromEvents(events: Iterable<AgentEvent>): SessionState {
  let state: SessionState = 'idle';
  for (const event of events) {
    if (event.kind === 'working' || event.kind === 'toolStart') state = 'working';
    else if (event.kind === 'turnEnd') state = 'idle';
    else if (event.kind === 'sessionEnd') state = 'exited';
  }
  return state;
}

function readState(file: string, size: number, format: JsonlFormat): SessionState {
  const start = Math.max(0, size - SESSION_STATE_TAIL_BYTES);
  let tail: string;
  try {
    tail = readRange(file, start, size - start).toString('utf8');
  } catch {
    return 'idle';
  }
  const lines = tail.split('\n');
  if (start > 0) lines.shift(); // cut mid-record
  return stateFromEvents(eventsOfLines(lines, format));
}

function* eventsOfLines(lines: Iterable<string>, format: JsonlFormat): Generator<AgentEvent> {
  for (const line of lines) {
    const record = parseJsonRecord(line);
    if (record) yield* format.events(record);
  }
}

class JsonlCursor implements SessionCursor {
  readonly cwd: string;
  readonly state: SessionState;
  private offset: number;
  /** Bytes after the last complete line, carried to the next read. */
  private pending = Buffer.alloc(0);

  constructor(
    private readonly file: string,
    private readonly format: JsonlFormat,
    cwdOf: ((file: string) => string) | undefined,
  ) {
    // Not written yet: read from the start once it appears.
    const size = fileSize(file) ?? 0;
    this.offset = size;
    this.cwd = (size > 0 ? readCwd(file, size, format) : '') || (cwdOf?.(file) ?? '');
    this.state = size > 0 ? readState(file, size, format) : 'idle';
  }

  get size(): number {
    return this.offset;
  }

  read(): AgentEvent[] {
    const size = fileSize(this.file);
    if (size === undefined) return []; // rotated or not created yet
    if (size < this.offset) {
      // Rewritten shorter (compaction, or replaced): its records are history now, read on from its new end.
      this.offset = size;
      this.pending = Buffer.alloc(0);
      return [];
    }
    if (size === this.offset) return [];
    let appended: Buffer;
    try {
      appended = readRange(
        this.file,
        this.offset,
        Math.min(size - this.offset, SESSION_MAX_READ_BYTES),
      );
    } catch {
      return [];
    }
    this.offset += appended.length;
    let buffer = Buffer.concat([this.pending, appended]);
    const lines: string[] = [];
    let newline: number;
    while ((newline = buffer.indexOf(NEWLINE)) >= 0) {
      lines.push(buffer.subarray(0, newline).toString('utf8'));
      buffer = buffer.subarray(newline + 1);
    }
    this.pending = buffer;
    return [...eventsOfLines(lines, this.format)];
  }
}

/** A session store of append-only JSONL transcripts, one file per session. */
export function jsonlSessionStore(options: JsonlStoreOptions): SessionStore {
  const { sessionIdOf } = options;
  /** Transcript of each session id, from the latest listing. */
  const fileOfId = new Map<string, string>();

  const listSessions = (): ListedSession[] => {
    const listed: ListedSession[] = [];
    for (const file of listTranscriptFiles(options.root, options.depth, options.isTranscript)) {
      try {
        const stat = fs.statSync(file);
        const realFile = fs.realpathSync(file);
        const key = sessionIdOf ? sessionIdOf(realFile) : realFile;
        if (sessionIdOf) fileOfId.set(key, realFile);
        listed.push({ key, mtimeMs: stat.mtimeMs, size: stat.size });
      } catch {
        // removed between readdir and stat
      }
    }
    return listed;
  };

  const fileOf = (key: string): string | undefined => {
    if (!sessionIdOf) return key;
    if (!fileOfId.has(key)) listSessions();
    return fileOfId.get(key);
  };

  return {
    listSessions,
    canonicalKey: sessionIdOf ? (sessionRef) => sessionRef : undefined,
    open(key) {
      const file = fileOf(key);
      return file ? new JsonlCursor(file, options.format, options.cwdOf) : null;
    },
  };
}
