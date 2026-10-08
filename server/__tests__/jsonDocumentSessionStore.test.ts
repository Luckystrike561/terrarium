import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AgentEvent } from '../../core/src/provider.js';
import type { JsonDocumentFormat } from '../src/providers/sessionStore/jsonDocumentSessionStore.js';
import { jsonDocumentSessionStore } from '../src/providers/sessionStore/jsonDocumentSessionStore.js';
import type { JsonRecord } from '../src/providers/sessionStore/jsonlSessionStore.js';

interface DocumentRecordLiteral {
  type: string;
  id?: string;
  name?: string;
  cwd?: string;
}

/** A minimal whole-document format: the CLI rewrites `{ records: [...] }` on every change. */
const format: JsonDocumentFormat = {
  records(document) {
    if (!document || typeof document !== 'object' || !('records' in document)) return [];
    const { records } = document;
    return Array.isArray(records) ? (records as JsonRecord[]) : [];
  },
  events(record): AgentEvent[] {
    if (record['type'] === 'tool') {
      return [{ kind: 'toolStart', toolId: record['id'] as string, toolName: record['name'] as string }];
    }
    if (record['type'] === 'end') return [{ kind: 'turnEnd' }];
    return [];
  },
  cwd: (record) => (typeof record['cwd'] === 'string' ? (record['cwd'] as string) : undefined),
};

let root: string;
let clockMs: number;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'json-document-session-store-'));
  clockMs = 1_000_000;
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const isTranscript = (name: string): boolean => name.endsWith('.json');

/** Writes the whole document and stamps its mtime explicitly: two rewrites in the same real millisecond must still
 *  register as distinct changes, which `fs.utimesSync` guarantees where relying on wall-clock resolution would not. */
function writeDocument(file: string, records: DocumentRecordLiteral[]): void {
  fs.writeFileSync(file, JSON.stringify({ records }));
  clockMs += 1000;
  const stamp = new Date(clockMs);
  fs.utimesSync(file, stamp, stamp);
}

function writeRaw(file: string, content: string): void {
  fs.writeFileSync(file, content);
  clockMs += 1000;
  const stamp = new Date(clockMs);
  fs.utimesSync(file, stamp, stamp);
}

describe('jsonDocumentSessionStore rewrite diffing', () => {
  it('emits only the records appended since the previous rewrite', () => {
    const file = path.join(root, 'session.json');
    writeDocument(file, [{ type: 'tool', id: 't1', name: 'Bash' }, { type: 'end' }]);
    const store = jsonDocumentSessionStore({ root, depth: 0, isTranscript, format });
    const cursor = store.open(file)!;
    expect(cursor.read()).toEqual([]);

    writeDocument(file, [
      { type: 'tool', id: 't1', name: 'Bash' },
      { type: 'end' },
      { type: 'tool', id: 't2', name: 'Read' },
      { type: 'end' },
    ]);

    expect(cursor.read()).toEqual([
      { kind: 'toolStart', toolId: 't2', toolName: 'Read' },
      { kind: 'turnEnd' },
    ]);
  });

  it('reports no new events when the mtime is unchanged', () => {
    const file = path.join(root, 'session.json');
    writeDocument(file, [{ type: 'end' }]);
    const store = jsonDocumentSessionStore({ root, depth: 0, isTranscript, format });
    const cursor = store.open(file)!;

    expect(cursor.read()).toEqual([]);
  });
});

describe('jsonDocumentSessionStore shrinking', () => {
  it('reads nothing from a rewrite with fewer records than it already counted, then resumes from the new end', () => {
    const file = path.join(root, 'session.json');
    writeDocument(file, [
      { type: 'tool', id: 't1', name: 'Bash' },
      { type: 'tool', id: 't2', name: 'Read' },
      { type: 'end' },
    ]);
    const store = jsonDocumentSessionStore({ root, depth: 0, isTranscript, format });
    const cursor = store.open(file)!;
    expect(cursor.read()).toEqual([]);

    writeDocument(file, [{ type: 'tool', id: 't3', name: 'Grep' }]); // compacted to a single record

    expect(cursor.read()).toEqual([]);

    writeDocument(file, [{ type: 'tool', id: 't3', name: 'Grep' }, { type: 'end' }]);
    expect(cursor.read()).toEqual([{ kind: 'turnEnd' }]);
  });
});

describe('jsonDocumentSessionStore mid-write reads', () => {
  it('tolerates invalid JSON caught mid-rewrite and picks up cleanly on the next valid write', () => {
    const file = path.join(root, 'session.json');
    writeDocument(file, [{ type: 'tool', id: 't1', name: 'Bash' }]);
    const store = jsonDocumentSessionStore({ root, depth: 0, isTranscript, format });
    const cursor = store.open(file)!;
    expect(cursor.read()).toEqual([]);

    writeRaw(file, '{"records":[{"type":"tool","id":"t1","name":"Bash"},{"type":"en'); // caught mid-rewrite
    expect(cursor.read()).toEqual([]);

    writeDocument(file, [
      { type: 'tool', id: 't1', name: 'Bash' },
      { type: 'end' },
      { type: 'tool', id: 't2', name: 'Read' },
    ]);

    expect(cursor.read()).toEqual([
      { kind: 'turnEnd' },
      { kind: 'toolStart', toolId: 't2', toolName: 'Read' },
    ]);
  });
});
