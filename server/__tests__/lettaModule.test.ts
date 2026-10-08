import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MultiplexedAgent, MultiplexerModule } from '../../core/src/provider.js';
import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { lettaModule } from '../src/providers/letta/letta.js';
import { SESSION_POLL_INTERVAL_MS } from '../src/providers/sessionStore/constants.js';

// Letta Code's local-backend store and the server's ~/.pixel-agents/ both resolve against the home directory.
let tmpHome: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof os>('os');
  return { ...actual, homedir: () => tmpHome };
});

type Message = Record<string, unknown>;

const userPrompt = { type: 'message', message: { role: 'user' } };
const turnEnded = { type: 'message', message: { role: 'assistant', stopReason: 'stop' } };
function toolCall(toolCallId: string, toolName: string, args: Record<string, unknown>) {
  return {
    type: 'message',
    message: {
      role: 'assistant',
      stopReason: 'toolUse',
      content: [{ type: 'toolCall', id: toolCallId, name: toolName, arguments: args }],
    },
  };
}
function toolResult(toolCallId: string) {
  return {
    type: 'message',
    message: {
      role: 'toolResult',
      toolCallId,
      content: [{ type: 'text', text: 'ok' }],
      isError: false,
    },
  };
}

function jsonl(records: object[]): string {
  return records.map((r) => `${JSON.stringify(r)}\n`).join('');
}

/** Write a Letta Code local-backend transcript under the test home, laid out the way the local backend writes
 *  it: `conversations/<base64url(conversationKey)>/messages.jsonl`, starting with the session header. Returns
 *  both the transcript file and the identity herdr reports for the same conversation (its value drops the
 *  `conversation:` prefix the directory key carries; a default conversation's key already has none). */
function lettaSession(
  conversationKey: string,
  cwd: string,
  records: object[],
): { file: string; herdrRef: string } {
  const encoded = Buffer.from(conversationKey, 'utf8').toString('base64url');
  const dir = path.join(tmpHome, '.letta', 'lc-local-backend', 'conversations', encoded);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'messages.jsonl');
  const header = {
    type: 'session',
    version: 3,
    id: 'c-1',
    timestamp: new Date().toISOString(),
    cwd,
  };
  fs.writeFileSync(file, jsonl([header, ...records]));
  const herdrRef = conversationKey.startsWith('conversation:')
    ? conversationKey.slice('conversation:'.length)
    : conversationKey;
  return { file, herdrRef };
}

/** Mark the conversation a `messages.jsonl` path belongs to as Letta Code marks a `Task`-spawned sub-agent's:
 *  a sibling `conversation.json` with `is_subagent: true`. */
function markAsSubagent(file: string): void {
  fs.writeFileSync(
    path.join(path.dirname(file), 'conversation.json'),
    JSON.stringify({ is_subagent: true }),
  );
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
    agentKind: 'letta',
    status: 'working',
    cwd: path.join(os.tmpdir(), 'pxl-untracked-pane'),
    name: 'alpha',
    task: 'Ship the release',
    ...overrides,
  };
}

describe('letta provider module', () => {
  let store: AgentStateStore;
  let runtime: AgentRuntime | undefined;
  let messages: Message[];

  const ofType = (type: string) => messages.filter((m) => m.type === type);
  const onlyAgentId = (): number => {
    expect(store.size).toBe(1);
    return [...store.keys()][0];
  };

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-letta-'));
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

  describe('agent only: letta, no multiplexer', () => {
    it('a running session appears with its folder name, tool activity, and goes idle when its turn ends', () => {
      const { file } = lettaSession('default:agent-123', '/work/monopoly', [userPrompt]);
      runtime = new AgentRuntime(store, { agents: [lettaModule], multiplexers: [] });
      runtime.startModules();

      const id = onlyAgentId();
      expect(store.get(id)?.folderName).toBe('monopoly');

      fs.appendFileSync(
        file,
        jsonl([toolCall('t1', 'Read', { file_path: '/work/monopoly/PLAN.md' })]),
      );
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentToolStart')).toContainEqual(
        expect.objectContaining({ id, status: 'Reading PLAN.md', toolName: 'Read' }),
      );

      fs.appendFileSync(file, jsonl([toolResult('t1'), turnEnded]));
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentStatus').at(-1)).toMatchObject({ id, status: 'waiting' });
    });

    it('never replays history: a session that already idled before discovery starts idle with no tool events', () => {
      lettaSession('default:agent-7', '/work/idle', [
        toolCall('old', 'Bash', { command: 'ls' }),
        toolResult('old'),
        turnEnded,
      ]);
      runtime = new AgentRuntime(store, { agents: [lettaModule], multiplexers: [] });
      runtime.startModules();
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS * 3);

      const id = onlyAgentId();
      expect(store.get(id)?.folderName).toBe('idle');
      expect(ofType('agentToolStart')).toEqual([]);
    });

    it("excludes a Task-spawned sub-agent's own conversation from discovery", () => {
      lettaSession('default:agent-1', '/work/lead', [userPrompt]);
      const { file: subFile } = lettaSession('conversation:sub-1', '/work/lead', [userPrompt]);
      markAsSubagent(subFile);
      runtime = new AgentRuntime(store, { agents: [lettaModule], multiplexers: [] });
      runtime.startModules();

      const id = onlyAgentId(); // only the lead renders; the sub-agent conversation stays hidden
      expect(store.get(id)?.folderName).toBe('lead');
    });
  });

  describe('both: herdr and letta', () => {
    it('a pane naming the conversation id joins the module-discovered session into one character, not two', () => {
      const mux = fakeMultiplexer();
      const { file, herdrRef } = lettaSession(
        'conversation:9c4e1b2a-0000-0000-0000-000000000001',
        '/work/alpha',
        [userPrompt],
      );
      runtime = new AgentRuntime(store, { agents: [lettaModule], multiplexers: [mux.module] });
      runtime.startModules();
      expect(store.size).toBe(1); // the module's own discovery already found it

      mux.publish([pane({ sessionRef: herdrRef, cwd: '/work/alpha' })]);
      const id = onlyAgentId();
      expect(ofType('agentInfo').at(-1)).toMatchObject({ id, name: 'alpha' });

      fs.appendFileSync(file, jsonl([toolCall('t2', 'Edit', { file_path: 'src/app.ts' })]));
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentToolStart')).toEqual([
        expect.objectContaining({ id, status: 'Editing app.ts' }),
      ]);

      mux.publish([pane({ sessionRef: herdrRef, status: 'blocked' })]);
      expect(ofType('agentToolPermission')).toEqual([{ type: 'agentToolPermission', id }]);
      // Disconnecting the pane alone does not end the character: the module's own discovery still
      // tracks the same transcript, exactly as it would with no multiplexer running at all.
      mux.publish([]);
      expect(store.size).toBe(1);
    });

    it('a pane naming the default conversation (default:<agentId>) joins the same way', () => {
      const mux = fakeMultiplexer();
      const { herdrRef } = lettaSession('default:agent-42', '/work/beta', [userPrompt]);
      expect(herdrRef).toBe('default:agent-42');
      runtime = new AgentRuntime(store, { agents: [lettaModule], multiplexers: [mux.module] });
      runtime.startModules();
      expect(store.size).toBe(1);

      mux.publish([pane({ sessionRef: herdrRef, cwd: '/work/beta', name: 'beta' })]);
      expect(store.size).toBe(1); // still one character: the ref and the discovered key are the same string
      const id = onlyAgentId();
      expect(ofType('agentInfo').at(-1)).toMatchObject({ id, name: 'beta' });
    });

    it('a pane reported before letta discovers its session still renders once', () => {
      const mux = fakeMultiplexer();
      runtime = new AgentRuntime(store, { agents: [lettaModule], multiplexers: [mux.module] });
      runtime.startModules();
      expect(store.size).toBe(0);

      const { herdrRef } = lettaSession('default:agent-9', '/work/gamma', [userPrompt]);
      mux.publish([pane({ paneId: 'p9', name: 'gamma', sessionRef: herdrRef })]);
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS * 5); // several discovery scans find the same file

      const id = onlyAgentId();
      expect(store.get(id)?.folderName).toBe('gamma');
    });
  });
});
