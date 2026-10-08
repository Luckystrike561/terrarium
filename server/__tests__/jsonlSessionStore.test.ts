import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AgentEvent } from '../../core/src/provider.js';
import type { JsonlFormat } from '../src/providers/sessionStore/jsonlSessionStore.js';
import { jsonlSessionStore } from '../src/providers/sessionStore/jsonlSessionStore.js';

/** A minimal transcript format: `{"type":"tool",...}` starts a tool, `{"type":"end"}` ends the turn, `{"cwd":...}`
 *  near the head names the working directory. */
const format: JsonlFormat = {
  events(record): AgentEvent[] {
    if (record['type'] === 'tool') {
      return [
        { kind: 'toolStart', toolId: record['id'] as string, toolName: record['name'] as string },
      ];
    }
    if (record['type'] === 'end') return [{ kind: 'turnEnd' }];
    return [];
  },
  cwd: (record) => (typeof record['cwd'] === 'string' ? (record['cwd'] as string) : undefined),
};

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonl-session-store-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const isTranscript = (name: string): boolean => name.endsWith('.jsonl');

describe('jsonlSessionStore partial-line buffering', () => {
  it('carries an unterminated line across polls and completes it once the rest arrives', () => {
    const file = path.join(root, 'session.jsonl');
    fs.writeFileSync(
      file,
      `${JSON.stringify({ cwd: '/work' })}\n${JSON.stringify({ type: 'end' })}\n`,
    );
    const store = jsonlSessionStore({ root, depth: 0, isTranscript, format });
    const cursor = store.open(file)!;

    fs.appendFileSync(file, '{"type":"to');
    expect(cursor.read()).toEqual([]);

    fs.appendFileSync(file, `ol","id":"t1","name":"Bash"}\n${JSON.stringify({ type: 'end' })}\n`);
    expect(cursor.read()).toEqual([
      { kind: 'toolStart', toolId: 't1', toolName: 'Bash' },
      { kind: 'turnEnd' },
    ]);
  });
});

describe('jsonlSessionStore keying', () => {
  it('keys sessions by real path when no sessionIdOf is given', () => {
    const file = path.join(root, 'session.jsonl');
    fs.writeFileSync(file, `${JSON.stringify({ type: 'end' })}\n`);
    const store = jsonlSessionStore({ root, depth: 0, isTranscript, format });

    const [listed] = store.listSessions();
    expect(listed.key).toBe(fs.realpathSync(file));
    expect(store.canonicalKey).toBeUndefined();
  });

  it('keys sessions by sessionIdOf when given, resolving back to the file on open', () => {
    const file = path.join(root, 'conversation-77.jsonl');
    fs.writeFileSync(file, `${JSON.stringify({ cwd: '/work/77' })}\n`);
    const store = jsonlSessionStore({
      root,
      depth: 0,
      isTranscript,
      format,
      sessionIdOf: (filePath) => path.basename(filePath, '.jsonl').replace('conversation-', ''),
    });

    const [listed] = store.listSessions();
    expect(listed.key).toBe('77');
    expect(store.canonicalKey?.('77')).toBe('77');

    const cursor = store.open('77');
    expect(cursor?.cwd).toBe('/work/77');
  });
});

describe('jsonlSessionStore truncation and rotation', () => {
  it('resets its offset on truncation and reads only what is appended afterward', () => {
    const file = path.join(root, 'session.jsonl');
    fs.writeFileSync(file, `${JSON.stringify({ type: 'tool', id: 'old', name: 'Bash' })}\n`);
    const store = jsonlSessionStore({ root, depth: 0, isTranscript, format });
    const cursor = store.open(file)!;
    expect(cursor.read()).toEqual([]);

    fs.truncateSync(file, 0);
    expect(cursor.read()).toEqual([]);
    expect(cursor.size).toBe(0);

    fs.appendFileSync(file, `${JSON.stringify({ type: 'tool', id: 'new', name: 'Read' })}\n`);
    expect(cursor.read()).toEqual([{ kind: 'toolStart', toolId: 'new', toolName: 'Read' }]);
  });

  it('reads nothing once the file disappears, without throwing', () => {
    const file = path.join(root, 'session.jsonl');
    fs.writeFileSync(file, `${JSON.stringify({ type: 'end' })}\n`);
    const store = jsonlSessionStore({ root, depth: 0, isTranscript, format });
    const cursor = store.open(file)!;

    fs.rmSync(file);
    expect(cursor.read()).toEqual([]);
  });
});

describe('jsonlSessionStore malformed lines', () => {
  it('ignores a malformed line while still reading the valid lines around it', () => {
    const file = path.join(root, 'session.jsonl');
    fs.writeFileSync(file, '');
    const store = jsonlSessionStore({ root, depth: 0, isTranscript, format });
    const cursor = store.open(file)!;

    fs.appendFileSync(
      file,
      [
        JSON.stringify({ type: 'tool', id: 'before', name: 'Bash' }),
        '{not valid json',
        '["an", "array", "not", "an", "object"]',
        JSON.stringify({ type: 'tool', id: 'after', name: 'Read' }),
        '',
      ].join('\n'),
    );

    expect(cursor.read()).toEqual([
      { kind: 'toolStart', toolId: 'before', toolName: 'Bash' },
      { kind: 'toolStart', toolId: 'after', toolName: 'Read' },
    ]);
  });
});
