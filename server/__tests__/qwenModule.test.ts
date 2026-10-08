import * as fs from 'fs';
import type * as OsModule from 'os';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MultiplexedAgent, MultiplexerModule } from '../../core/src/provider.js';
import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { qwenModule } from '../src/providers/qwen/qwen.js';
import { SESSION_POLL_INTERVAL_MS } from '../src/providers/sessionStore/constants.js';

// Qwen Code's session store and the server's ~/.pixel-agents/ both resolve against the home directory.
let tmpHome: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof OsModule>('os');
  return { ...actual, homedir: () => tmpHome };
});

type Message = Record<string, unknown>;

const userPrompt = (cwd: string) => ({
  type: 'user',
  cwd,
  message: { role: 'user', parts: [{ text: 'go' }] },
});
const toolStart = (cwd: string, id: string, name: string, args: Record<string, unknown>) => ({
  type: 'assistant',
  cwd,
  message: { role: 'model', parts: [{ functionCall: { id, name, args } }] },
});
const toolResult = (cwd: string, id: string, name: string) => ({
  type: 'tool_result',
  cwd,
  message: { parts: [{ functionResponse: { id, name, response: { output: 'ok' } } }] },
  toolCallResult: { callId: id, status: 'success' },
});
const turnEndText = (cwd: string) => ({
  type: 'assistant',
  cwd,
  message: { role: 'model', parts: [{ text: 'Done.' }] },
});

function jsonl(records: object[]): string {
  return records.map((r) => `${JSON.stringify(r)}\n`).join('');
}

/** Write a Qwen Code transcript into its session store under the test home, laid out as Qwen Code writes it:
 *  `<runtimeBaseDir>/projects/<sanitized-cwd>/chats/<sessionId>.jsonl`. `sessionId` is what herdr reports as the
 *  pane's `sessionRef` for this CLI (kind `id`), so it is also the key this module tracks the session under. */
function qwenSession(sessionId: string, cwd: string, records: object[]): string {
  const dir = path.join(tmpHome, '.qwen', 'projects', `-${path.basename(cwd)}`, 'chats');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${sessionId}.jsonl`);
  fs.writeFileSync(file, jsonl(records));
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
    agentKind: 'qwen',
    status: 'working',
    cwd: path.join(os.tmpdir(), 'pxl-untracked-pane'),
    name: 'alpha',
    task: 'Ship the release',
    ...overrides,
  };
}

describe('qwen provider module', () => {
  let store: AgentStateStore;
  let runtime: AgentRuntime | undefined;
  let messages: Message[];

  const ofType = (type: string) => messages.filter((m) => m.type === type);
  const onlyAgentId = (): number => {
    expect(store.size).toBe(1);
    return [...store.keys()][0];
  };

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-qwen-'));
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

  describe('agent only: qwen, no multiplexer', () => {
    it('a running qwen session appears with its tool activity and goes idle when its turn ends', () => {
      const cwd = '/work/monopoly';
      const file = qwenSession('s1', cwd, [userPrompt(cwd)]);
      runtime = new AgentRuntime(store, { agents: [qwenModule], multiplexers: [] });
      runtime.startModules();

      const id = onlyAgentId();
      expect(store.get(id)?.folderName).toBe('monopoly');

      fs.appendFileSync(
        file,
        jsonl([toolStart(cwd, 'call-1', 'read_file', { file_path: '/work/monopoly/PLAN.md' })]),
      );
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentToolStart')).toContainEqual(
        expect.objectContaining({ id, status: 'Reading PLAN.md', toolName: 'read_file' }),
      );

      fs.appendFileSync(file, jsonl([toolResult(cwd, 'call-1', 'read_file'), turnEndText(cwd)]));
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentStatus').at(-1)).toMatchObject({ id, status: 'waiting' });
    });

    it('never replays history: a session discovered mid-file starts from its last state, not the top', () => {
      const cwd = '/work/idle';
      qwenSession('s2', cwd, [
        toolStart(cwd, 'call-1', 'run_shell_command', { command: 'ls' }),
        toolResult(cwd, 'call-1', 'run_shell_command'),
        turnEndText(cwd),
      ]);
      runtime = new AgentRuntime(store, { agents: [qwenModule], multiplexers: [] });
      runtime.startModules();
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS * 3);

      const id = onlyAgentId();
      expect(store.get(id)?.folderName).toBe('idle');
      expect(ofType('agentToolStart')).toEqual([]);
    });
  });

  describe('both: herdr and qwen', () => {
    it('a qwen session in a pane is one character with qwen tool activity and the pane name, task and approval', () => {
      const mux = fakeMultiplexer();
      const cwd = '/work/alpha';
      const sessionId = '0b5e7c1e-4a2d-4c36-9f0e-1d2c3b4a5f60';
      const file = qwenSession(sessionId, cwd, [userPrompt(cwd)]);
      runtime = new AgentRuntime(store, { agents: [qwenModule], multiplexers: [mux.module] });
      runtime.startModules();

      mux.publish([pane({ sessionRef: sessionId })]);
      const id = onlyAgentId();
      expect(ofType('agentInfo').at(-1)).toMatchObject({ id, name: 'alpha' });

      fs.appendFileSync(
        file,
        jsonl([toolStart(cwd, 'call-2', 'edit', { file_path: 'src/app.ts' })]),
      );
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentToolStart')).toEqual([
        expect.objectContaining({ id, status: 'Editing app.ts' }),
      ]);

      mux.publish([pane({ sessionRef: sessionId, status: 'blocked' })]);
      expect(ofType('agentToolPermission')).toEqual([{ type: 'agentToolPermission', id }]);
    });

    it('a pane reported before qwen discovers its session, and a second pane for the same session, still render once', () => {
      const mux = fakeMultiplexer();
      const cwd = '/work/gamma';
      const sessionId = '1a2b3c4d-5e6f-4789-9abc-def012345678';
      runtime = new AgentRuntime(store, { agents: [qwenModule], multiplexers: [mux.module] });
      runtime.startModules();
      expect(store.size).toBe(0);

      qwenSession(sessionId, cwd, [userPrompt(cwd)]);
      mux.publish([pane({ paneId: 'p9', name: 'gamma', sessionRef: sessionId })]);
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS * 5); // several discovery scans find the same file

      const id = onlyAgentId();
      expect(store.get(id)?.folderName).toBe('gamma');

      // The same session id reported again (herdr re-snapshotting the pane) must not spawn a second character.
      mux.publish([pane({ paneId: 'p9', name: 'gamma', sessionRef: sessionId })]);
      expect(onlyAgentId()).toBe(id);
    });
  });
});
