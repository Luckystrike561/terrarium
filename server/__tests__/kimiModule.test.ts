import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MultiplexedAgent, MultiplexerModule } from '../../core/src/provider.js';
import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { kimiModule } from '../src/providers/kimi/kimi.js';
import { SESSION_POLL_INTERVAL_MS } from '../src/providers/sessionStore/constants.js';

// Kimi Code's session store and the server's ~/.pixel-agents/ both resolve against the home directory.
let tmpHome: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof os>('os');
  return { ...actual, homedir: () => tmpHome };
});

type Message = Record<string, unknown>;

const turnPrompt = { type: 'turn.prompt', input: [{ type: 'text', text: 'go' }] };
const turnEnded = { type: 'turn.ended', reason: 'completed', turnId: 0 };
function toolCall(toolCallId: string, name: string, args: Record<string, unknown>) {
  return {
    type: 'context.append_loop_event',
    event: { type: 'tool.call', toolCallId, name, args },
  };
}
function toolResult(toolCallId: string) {
  return {
    type: 'context.append_loop_event',
    event: { type: 'tool.result', toolCallId, result: { output: '', isError: false } },
  };
}

function jsonl(records: object[]): string {
  return records.map((r) => `${JSON.stringify(r)}\n`).join('');
}

/** Write a Kimi Code session into its store under the test home: `sessions/<workDirKey>/<sessionId>/` with
 *  `state.json` (cwd) and `agents/main/wire.jsonl` (the records). Returns the main transcript's path. */
function kimiSession(sessionId: string, cwd: string, records: object[]): string {
  const sessionDir = path.join(
    tmpHome,
    '.kimi-code',
    'sessions',
    `wd_${path.basename(cwd)}`,
    sessionId,
  );
  const mainDir = path.join(sessionDir, 'agents', 'main');
  fs.mkdirSync(mainDir, { recursive: true });
  fs.writeFileSync(path.join(sessionDir, 'state.json'), JSON.stringify({ id: sessionId, cwd }));
  const file = path.join(mainDir, 'wire.jsonl');
  fs.writeFileSync(file, jsonl([{ type: 'metadata', protocol_version: '1.5' }, ...records]));
  return file;
}

/** A subagent wire log beside a session's main one. Session discovery must never treat it as its own session. */
function kimiSubagentWire(sessionDir: string, subagentId: string, records: object[]): void {
  const dir = path.join(sessionDir, 'agents', subagentId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'wire.jsonl'), jsonl(records));
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
    agentKind: 'kimi',
    status: 'working',
    cwd: path.join(os.tmpdir(), 'pxl-untracked-pane'),
    name: 'alpha',
    task: 'Ship the release',
    ...overrides,
  };
}

describe('kimi provider module', () => {
  let store: AgentStateStore;
  let runtime: AgentRuntime | undefined;
  let messages: Message[];

  const ofType = (type: string) => messages.filter((m) => m.type === type);
  const onlyAgentId = (): number => {
    expect(store.size).toBe(1);
    return [...store.keys()][0];
  };

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-kimi-'));
    delete process.env.KIMI_CODE_HOME;
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

  describe('agent only: kimi, no multiplexer', () => {
    it('a running session appears once under its cwd folder name, shows tool activity, and goes idle at turn end', () => {
      const sessionId = 'session_11111111-1111-1111-1111-111111111111';
      const file = kimiSession(sessionId, '/work/monopoly', [turnPrompt]);
      runtime = new AgentRuntime(store, { agents: [kimiModule], multiplexers: [] });
      runtime.startModules();

      const id = onlyAgentId();
      expect(store.get(id)?.folderName).toBe('monopoly');

      fs.appendFileSync(
        file,
        jsonl([toolCall('call_1', 'Read', { path: '/work/monopoly/PLAN.md' })]),
      );
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentToolStart')).toContainEqual(
        expect.objectContaining({ id, status: 'Reading PLAN.md', toolName: 'Read' }),
      );
      expect(onlyAgentId()).toBe(id);

      fs.appendFileSync(file, jsonl([toolResult('call_1'), turnEnded]));
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentStatus').at(-1)).toMatchObject({ id, status: 'waiting' });
    });

    it('never follows a sibling sub-agent wire log as its own session', () => {
      const sessionId = 'session_22222222-2222-2222-2222-222222222222';
      const file = kimiSession(sessionId, '/work/alpha', [turnPrompt]);
      const sessionDir = path.dirname(path.dirname(path.dirname(file)));
      kimiSubagentWire(sessionDir, 'sub-1', [toolCall('sub-call-1', 'Bash', { command: 'ls' })]);
      runtime = new AgentRuntime(store, { agents: [kimiModule], multiplexers: [] });
      runtime.startModules();

      expect(onlyAgentId()).toBeDefined();
      expect(ofType('agentToolStart')).toEqual([]);
    });
  });

  describe('multiplexer only: herdr, kimi module disabled', () => {
    it('every hosted agent appears with its status, name and task, and never with tool activity', () => {
      const mux = fakeMultiplexer();
      const sessionId = 'session_33333333-3333-3333-3333-333333333333';
      kimiSession(sessionId, '/work/alpha', [turnPrompt]);
      runtime = new AgentRuntime(store, { agents: [], multiplexers: [mux.module] });
      runtime.startModules();

      mux.publish([pane({ sessionRef: sessionId })]);
      const id = onlyAgentId();
      expect(ofType('agentInfo').at(-1)).toMatchObject({
        id,
        name: 'alpha',
        task: 'Ship the release',
      });
      expect(ofType('agentStatus').at(-1)).toMatchObject({ id, status: 'active' });

      mux.publish([pane({ sessionRef: sessionId, status: 'blocked' })]);
      expect(ofType('agentToolPermission')).toContainEqual({ type: 'agentToolPermission', id });

      mux.publish([]);
      expect(store.size).toBe(0);
    });
  });

  describe('both: herdr and kimi', () => {
    it('a herdr pane bound by the Kimi session id is one character with wire.jsonl tool activity and the pane name/task/approval', () => {
      const mux = fakeMultiplexer();
      const sessionId = 'session_44444444-4444-4444-4444-444444444444';
      const file = kimiSession(sessionId, '/work/alpha', [turnPrompt]);
      runtime = new AgentRuntime(store, { agents: [kimiModule], multiplexers: [mux.module] });
      runtime.startModules();

      mux.publish([pane({ sessionRef: sessionId })]);
      const id = onlyAgentId();
      expect(ofType('agentInfo').at(-1)).toMatchObject({ id, name: 'alpha' });

      fs.appendFileSync(file, jsonl([toolCall('call_1', 'Edit', { path: 'src/app.ts' })]));
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentToolStart')).toEqual([
        expect.objectContaining({ id, status: 'Editing app.ts' }),
      ]);
      expect(onlyAgentId()).toBe(id);

      mux.publish([pane({ sessionRef: sessionId, status: 'blocked' })]);
      expect(ofType('agentToolPermission')).toEqual([{ type: 'agentToolPermission', id }]);
    });

    it('a pane reported before Kimi discovers its session still renders once', () => {
      const mux = fakeMultiplexer();
      runtime = new AgentRuntime(store, { agents: [kimiModule], multiplexers: [mux.module] });
      runtime.startModules();
      expect(store.size).toBe(0);

      const sessionId = 'session_55555555-5555-5555-5555-555555555555';
      kimiSession(sessionId, '/work/gamma', [turnPrompt]);
      mux.publish([pane({ paneId: 'p9', name: 'gamma', sessionRef: sessionId })]);
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS * 5); // several discovery scans find the same session

      const id = onlyAgentId();
      expect(store.get(id)?.folderName).toBe('gamma');
    });
  });

  describe('KIMI_CODE_HOME override', () => {
    it('discovers sessions under a redirected home directory', () => {
      const customHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-kimi-home-'));
      process.env.KIMI_CODE_HOME = customHome;
      try {
        const sessionId = 'session_66666666-6666-6666-6666-666666666666';
        const sessionDir = path.join(customHome, 'sessions', 'wd_delta', sessionId);
        const mainDir = path.join(sessionDir, 'agents', 'main');
        fs.mkdirSync(mainDir, { recursive: true });
        fs.writeFileSync(
          path.join(sessionDir, 'state.json'),
          JSON.stringify({ id: sessionId, cwd: '/work/delta' }),
        );
        fs.writeFileSync(
          path.join(mainDir, 'wire.jsonl'),
          jsonl([{ type: 'metadata', protocol_version: '1.5' }, turnPrompt]),
        );

        runtime = new AgentRuntime(store, { agents: [kimiModule], multiplexers: [] });
        runtime.startModules();
        expect(store.get(onlyAgentId())?.folderName).toBe('delta');
      } finally {
        fs.rmSync(customHome, { recursive: true, force: true });
        delete process.env.KIMI_CODE_HOME;
      }
    });
  });
});
