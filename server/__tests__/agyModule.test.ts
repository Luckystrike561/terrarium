import * as fs from 'fs';
import type * as OsModule from 'os';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MultiplexedAgent, MultiplexerModule } from '../../core/src/provider.js';
import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { agyModule } from '../src/providers/agy/agy.js';
import { SESSION_POLL_INTERVAL_MS } from '../src/providers/sessionStore/constants.js';

// agy's session store and the server's ~/.pixel-agents/ both resolve against the home directory.
let tmpHome: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof OsModule>('os');
  return { ...actual, homedir: () => tmpHome };
});

type Message = Record<string, unknown>;

const userPrompt = {
  source: 'USER_EXPLICIT',
  type: 'USER_INPUT',
  status: 'DONE',
  content: '<USER_REQUEST>go</USER_REQUEST>',
};

function plannerToolCall(stepIndex: number, name: string, args: Record<string, unknown>) {
  return {
    step_index: stepIndex,
    source: 'MODEL',
    type: 'PLANNER_RESPONSE',
    status: 'DONE',
    tool_calls: [{ name, args }],
  };
}

function jsonl(records: object[]): string {
  return records.map((r) => `${JSON.stringify(r)}\n`).join('');
}

/** Write an agy conversation into Antigravity's session store under the test home, laid out as the CLI writes
 *  it: `brain/<uuid>/.system_generated/logs/transcript_full.jsonl`, with a matching `history.jsonl` entry since
 *  the transcript itself never records a working directory. */
function agySession(uuid: string, cwd: string, records: object[]): string {
  const dir = path.join(
    tmpHome,
    '.gemini',
    'antigravity-cli',
    'brain',
    uuid,
    '.system_generated',
    'logs',
  );
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'transcript_full.jsonl');
  fs.writeFileSync(file, jsonl(records));
  const historyFile = path.join(tmpHome, '.gemini', 'antigravity-cli', 'history.jsonl');
  fs.appendFileSync(
    historyFile,
    jsonl([{ display: uuid, timestamp: Date.now(), workspace: cwd, conversationId: uuid }]),
  );
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
    agentKind: 'agy',
    status: 'working',
    cwd: path.join(os.tmpdir(), 'pxl-untracked-pane'),
    name: 'alpha',
    task: 'Ship the release',
    ...overrides,
  };
}

describe('agy module', () => {
  let store: AgentStateStore;
  let runtime: AgentRuntime | undefined;
  let messages: Message[];

  const ofType = (type: string) => messages.filter((m) => m.type === type);
  const onlyAgentId = (): number => {
    expect(store.size).toBe(1);
    return [...store.keys()][0];
  };

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-agy-'));
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

  describe('agent only: agy, no multiplexer', () => {
    it('a running agy session appears with its tool activity and goes idle when its turn ends', () => {
      const file = agySession('11111111-1111-1111-1111-111111111111', '/work/monopoly', [
        userPrompt,
      ]);
      runtime = new AgentRuntime(store, { agents: [agyModule], multiplexers: [] });
      runtime.startModules();

      const id = onlyAgentId();
      expect(store.get(id)?.folderName).toBe('monopoly');

      fs.appendFileSync(
        file,
        jsonl([
          plannerToolCall(1, 'view_file', {
            AbsolutePath: '/work/monopoly/PLAN.md',
            toolSummary: 'Reading the plan',
          }),
        ]),
      );
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentToolStart')).toContainEqual(
        expect.objectContaining({ id, status: 'Reading the plan', toolName: 'view_file' }),
      );

      // No toolSummary/toolAction this time: formatToolStatus falls back to the tool's own argument.
      fs.appendFileSync(
        file,
        jsonl([plannerToolCall(2, 'write_to_file', { TargetFile: '/work/monopoly/out.md' })]),
      );
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentToolStart')).toContainEqual(
        expect.objectContaining({ id, status: 'Writing out.md', toolName: 'write_to_file' }),
      );

      fs.appendFileSync(
        file,
        jsonl([
          {
            step_index: 3,
            source: 'MODEL',
            type: 'PLANNER_RESPONSE',
            status: 'DONE',
            content: 'All done.',
          },
        ]),
      );
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentStatus').at(-1)).toMatchObject({ id, status: 'waiting' });
      // turnEnd clears every open tool it never got an explicit toolEnd for.
      expect(ofType('agentToolsClear')).toContainEqual(expect.objectContaining({ id }));
    });

    it('never replays history', () => {
      agySession('22222222-2222-2222-2222-222222222222', '/work/idle', [
        plannerToolCall(0, 'run_command', { CommandLine: 'ls' }),
        {
          step_index: 1,
          source: 'MODEL',
          type: 'PLANNER_RESPONSE',
          status: 'DONE',
          content: 'All done.',
        },
      ]);
      runtime = new AgentRuntime(store, { agents: [agyModule], multiplexers: [] });
      runtime.startModules();
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS * 3);

      const id = onlyAgentId();
      expect(store.get(id)?.folderName).toBe('idle');
      expect(ofType('agentToolStart')).toEqual([]);
    });
  });

  describe('both: herdr and agy', () => {
    it("a herdr pane naming agy by its conversation id joins the module's own session as one character", () => {
      const mux = fakeMultiplexer();
      const uuid = '33333333-3333-3333-3333-333333333333';
      agySession(uuid, '/work/alpha', [userPrompt]);
      runtime = new AgentRuntime(store, { agents: [agyModule], multiplexers: [mux.module] });
      runtime.startModules();
      expect(store.size).toBe(1);

      mux.publish([pane({ sessionRef: uuid })]);
      expect(store.size).toBe(1);
      const id = onlyAgentId();
      expect(ofType('agentInfo').at(-1)).toMatchObject({ id, name: 'alpha' });

      mux.publish([pane({ sessionRef: uuid, status: 'blocked' })]);
      expect(ofType('agentToolPermission')).toContainEqual(
        expect.objectContaining({ type: 'agentToolPermission', id }),
      );
    });
  });
});
