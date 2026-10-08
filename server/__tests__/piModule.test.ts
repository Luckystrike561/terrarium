import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MultiplexedAgent, MultiplexerModule } from '../../core/src/provider.js';
import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { piModule } from '../src/providers/pi/pi.js';
import { SESSION_POLL_INTERVAL_MS } from '../src/providers/sessionStore/constants.js';

// pi's session store and the server's ~/.pixel-agents/ both resolve against the home directory.
let tmpHome: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpHome };
});

type Message = Record<string, unknown>;

const userPrompt = { type: 'message', message: { role: 'user' } };
const turnEnded = { type: 'message', message: { role: 'assistant', stopReason: 'stop' } };
function toolCall(id: string, name: string, args: Record<string, unknown>) {
  return {
    type: 'message',
    message: {
      role: 'assistant',
      stopReason: 'toolUse',
      content: [{ type: 'toolCall', id, name, arguments: args }],
    },
  };
}
function toolResult(toolCallId: string, toolName: string) {
  return { type: 'message', message: { role: 'toolResult', toolCallId, toolName, content: [] } };
}

function jsonl(records: object[]): string {
  return records.map((r) => `${JSON.stringify(r)}\n`).join('');
}

/** pi wraps the cwd-derived bucket directory name in `--…--` (leading separator stripped, `/\:` → `-`). */
function bucketDirName(cwd: string): string {
  return `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
}

function piSessionPath(id: string, cwd: string): string {
  return path.join(
    tmpHome,
    '.pi',
    'agent',
    'sessions',
    bucketDirName(cwd),
    `2024-12-03T14-00-00-000Z_${id}.jsonl`,
  );
}

/** Write a pi transcript into pi's session store under the test home, laid out as pi itself writes it: the
 *  `session` header is line 1 (no padded `title` slot, unlike omp's fork), then the records. */
function piSession(id: string, cwd: string, records: object[]): string {
  const file = piSessionPath(id, cwd);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const header = { type: 'session', version: 3, id, timestamp: '2024-12-03T14:00:00.000Z', cwd };
  fs.writeFileSync(file, jsonl([header, ...records]));
  return file;
}

/** A multiplexer whose snapshots the test publishes. */
function fakeMultiplexer(): {
  module: MultiplexerModule;
  publish(agents: MultiplexedAgent[]): void;
} {
  let onSnapshot: (agents: readonly MultiplexedAgent[]) => void = () => {};
  return {
    module: {
      kind: 'multiplexer',
      id: 'herdr',
      displayName: 'Fake herdr',
      connect(callback) {
        onSnapshot = callback;
        return { connected: Promise.resolve(true), stop: () => {} };
      },
    },
    publish: (agents) => onSnapshot(agents),
  };
}

function pane(overrides: Partial<MultiplexedAgent> = {}): MultiplexedAgent {
  return {
    paneId: 'p1',
    agentKind: 'pi',
    status: 'working',
    cwd: path.join(os.tmpdir(), 'pxl-untracked-pi-pane'),
    name: 'alpha',
    task: 'Ship the release',
    ...overrides,
  };
}

describe('pi provider module', () => {
  let store: AgentStateStore;
  let runtime: AgentRuntime | undefined;
  let messages: Message[];
  let originalPlatform: NodeJS.Platform;

  const ofType = (type: string) => messages.filter((m) => m.type === type);
  const onlyAgentId = (): number => {
    expect(store.size).toBe(1);
    return [...store.keys()][0];
  };

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-pi-'));
    originalPlatform = process.platform;
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    store = new AgentStateStore();
    messages = [];
    store.on('broadcast', (m) => messages.push(m as Message));
  });

  afterEach(() => {
    runtime?.dispose();
    runtime = undefined;
    vi.useRealTimers();
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('a running pi session appears once with its cwd folder name, shows tool activity, and goes idle at turn end', () => {
    const file = piSession('0199', '/work/monopoly', [userPrompt]);
    runtime = new AgentRuntime(store, { agents: [piModule], multiplexers: [] });
    runtime.startModules();

    const id = onlyAgentId();
    expect(store.get(id)?.folderName).toBe('monopoly');

    fs.appendFileSync(
      file,
      jsonl([toolCall('call_1', 'read', { path: '/work/monopoly/PLAN.md' })]),
    );
    vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
    expect(ofType('agentToolStart')).toContainEqual(
      expect.objectContaining({ id, status: 'Reading PLAN.md', toolName: 'read' }),
    );

    fs.appendFileSync(file, jsonl([toolResult('call_1', 'read'), turnEnded]));
    vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
    expect(ofType('agentStatus').at(-1)).toMatchObject({ id, status: 'waiting' });
  });

  it('a herdr pane bound by the transcript path (kind path) is one character with pi tool activity', () => {
    const mux = fakeMultiplexer();
    const file = piSession('0200', '/work/alpha', [userPrompt]);
    runtime = new AgentRuntime(store, { agents: [piModule], multiplexers: [mux.module] });
    runtime.startModules();
    expect(store.size).toBe(1); // pi's own discovery already found it

    mux.publish([pane({ sessionRef: file })]);
    expect(store.size).toBe(1); // the pane joins the same character, not a second one
    const id = onlyAgentId();
    expect(ofType('agentInfo').at(-1)).toMatchObject({ id, name: 'alpha' });

    fs.appendFileSync(file, jsonl([toolCall('call_2', 'bash', { command: 'ls -la' })]));
    vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
    expect(ofType('agentToolStart')).toContainEqual(
      expect.objectContaining({ id, status: 'Running: ls -la' }),
    );
  });

  it('a herdr pane reported before pi writes its first message still binds once the transcript appears', () => {
    const mux = fakeMultiplexer();
    runtime = new AgentRuntime(store, { agents: [piModule], multiplexers: [mux.module] });
    runtime.startModules();
    expect(store.size).toBe(0);

    const file = piSessionPath('0201', '/work/gamma');
    mux.publish([pane({ paneId: 'p9', name: 'gamma', cwd: '/work/gamma', sessionRef: file })]);
    expect(store.size).toBe(1); // the pane's character exists even before pi has written anything

    piSession('0201', '/work/gamma', [userPrompt]);
    vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS * 3); // several polls find the now-written file

    const id = onlyAgentId();
    expect(store.get(id)?.folderName).toBe('gamma');
  });

  it('on Windows, a herdr pane reporting pi by session id (no path reported) is still one character', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const mux = fakeMultiplexer();
    runtime = new AgentRuntime(store, { agents: [piModule], multiplexers: [mux.module] });
    runtime.startModules();

    const file = piSession('0202-session-id', '/work/beta', [userPrompt]);
    mux.publish([
      pane({ paneId: 'p9', name: 'beta', cwd: '/work/beta', sessionRef: '0202-session-id' }),
    ]);
    vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);

    const id = onlyAgentId(); // not two: discovery and the herdr hand-over agree on the session id as the key
    expect(store.get(id)?.folderName).toBe('beta');

    fs.appendFileSync(file, jsonl([toolCall('call_3', 'write', { path: '/work/beta/out.txt' })]));
    vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
    expect(ofType('agentToolStart')).toContainEqual(
      expect.objectContaining({ id, status: 'Writing out.txt' }),
    );
  });
});
