import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MultiplexedAgent, MultiplexerModule } from '../../core/src/provider.js';
import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { qodercliModule } from '../src/providers/qodercli/qodercli.js';
import { SESSION_POLL_INTERVAL_MS } from '../src/providers/sessionStore/constants.js';

// qodercli's session store resolves against the home directory (`~/.qoder/projects`).
let tmpHome: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpHome };
});

type Message = Record<string, unknown>;

const userPrompt = { type: 'user', message: { role: 'user', content: 'go' } };
const turnEnded = {
  type: 'assistant',
  message: {
    role: 'assistant',
    content: [{ type: 'text', text: 'done' }],
    stop_reason: 'end_turn',
  },
};
function toolUse(id: string, name: string, input: Record<string, unknown>) {
  return {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id, name, input }],
      stop_reason: 'tool_use',
    },
  };
}
function toolResult(toolUseId: string) {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'ok' }],
    },
  };
}

function jsonl(records: object[]): string {
  return records.map((r) => `${JSON.stringify(r)}\n`).join('');
}

/** Write a qodercli transcript under the test home, keyed by its own session UUID the way Qoder names the file. */
function qoderSession(sessionId: string, cwd: string, records: object[]): string {
  const slug = cwd.replace(/[^A-Za-z0-9]/g, '-');
  const dir = path.join(tmpHome, '.qoder', 'projects', slug);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${sessionId}.jsonl`);
  const withCwd = records.map((r) => ({ ...r, sessionId, cwd }));
  fs.writeFileSync(file, jsonl(withCwd));
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
    agentKind: 'qodercli',
    status: 'working',
    cwd: path.join(os.tmpdir(), 'pxl-untracked-pane'),
    name: 'alpha',
    task: 'Ship the release',
    ...overrides,
  };
}

describe('qodercli module', () => {
  let store: AgentStateStore;
  let runtime: AgentRuntime | undefined;
  let messages: Message[];

  const ofType = (type: string) => messages.filter((m) => m.type === type);
  const onlyAgentId = (): number => {
    expect(store.size).toBe(1);
    return [...store.keys()][0];
  };

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-qodercli-'));
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    store = new AgentStateStore();
    messages = [];
    store.on('broadcast', (m) => messages.push(m as Message));
  });

  afterEach(() => {
    runtime?.dispose();
    runtime = undefined;
    vi.useRealTimers();
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('a running qodercli session appears under its cwd folder, shows tool activity, and goes idle on end_turn', () => {
    const sessionId = '0b5e7c1e-4a2d-4c36-9f0e-1d2c3b4a5f60';
    const file = qoderSession(sessionId, '/work/monopoly', [userPrompt]);
    runtime = new AgentRuntime(store, { agents: [qodercliModule], multiplexers: [] });
    runtime.startModules();

    const id = onlyAgentId();
    expect(store.get(id)?.folderName).toBe('monopoly');

    fs.appendFileSync(
      file,
      jsonl([
        {
          ...toolUse('call-1', 'Read', { file_path: '/work/monopoly/PLAN.md' }),
          sessionId,
          cwd: '/work/monopoly',
        },
      ]),
    );
    vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
    expect(ofType('agentToolStart')).toContainEqual(
      expect.objectContaining({ id, status: 'Reading PLAN.md', toolName: 'Read' }),
    );

    fs.appendFileSync(
      file,
      jsonl([
        { ...toolResult('call-1'), sessionId, cwd: '/work/monopoly' },
        { ...turnEnded, sessionId, cwd: '/work/monopoly' },
      ]),
    );
    vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
    expect(ofType('agentStatus').at(-1)).toMatchObject({ id, status: 'waiting' });
  });

  it('never replays history, and starts an already-idle session without tool activity', () => {
    qoderSession('11111111-1111-1111-1111-111111111111', '/work/old', [
      toolUse('old', 'Bash', { command: 'ls' }),
      toolResult('old'),
      turnEnded,
    ]);
    runtime = new AgentRuntime(store, { agents: [qodercliModule], multiplexers: [] });
    runtime.startModules();
    vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS * 3);

    const id = onlyAgentId();
    expect(store.get(id)?.folderName).toBe('old');
    expect(ofType('agentToolStart')).toEqual([]);
  });

  it('a herdr pane joins the session the module discovers from the same session UUID, as one character', () => {
    const mux = fakeMultiplexer();
    const sessionId = '22222222-2222-2222-2222-222222222222';
    const file = qoderSession(sessionId, '/work/alpha', [userPrompt]);
    runtime = new AgentRuntime(store, { agents: [qodercliModule], multiplexers: [mux.module] });
    runtime.startModules();

    mux.publish([pane({ sessionRef: sessionId })]);
    const id = onlyAgentId();
    expect(ofType('agentInfo').at(-1)).toMatchObject({
      id,
      name: 'alpha',
      task: 'Ship the release',
    });

    fs.appendFileSync(
      file,
      jsonl([
        { ...toolUse('t1', 'Edit', { file_path: 'src/app.ts' }), sessionId, cwd: '/work/alpha' },
      ]),
    );
    vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
    expect(ofType('agentToolStart')).toContainEqual(
      expect.objectContaining({ id, status: 'Editing app.ts' }),
    );

    mux.publish([pane({ sessionRef: sessionId, status: 'blocked' })]);
    expect(ofType('agentToolPermission')).toContainEqual({ type: 'agentToolPermission', id });

    mux.publish([]);
    // qodercli adopts sessions outside the workspace, so the module's own discovery keeps the character even
    // once the pane that first reported it is gone.
    expect(onlyAgentId()).toBe(id);
  });
});
