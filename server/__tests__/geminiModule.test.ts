import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MultiplexedAgent, MultiplexerModule } from '../../core/src/provider.js';
import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { geminiModule } from '../src/providers/gemini/gemini.js';
import { SESSION_POLL_INTERVAL_MS } from '../src/providers/sessionStore/constants.js';

// Gemini CLI's session store and the server's ~/.pixel-agents/ both resolve against the home directory.
let tmpHome: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof os>('os');
  return { ...actual, homedir: () => tmpHome };
});

type Message = Record<string, unknown>;

function jsonl(records: object[]): string {
  return records.map((r) => `${JSON.stringify(r)}\n`).join('');
}

const userMessage = (id: string, text: string) => ({
  id,
  timestamp: '2026-10-08T00:00:00.000Z',
  type: 'user',
  content: [{ text }],
});

const geminiAnswer = (id: string, text: string) => ({
  id,
  timestamp: '2026-10-08T00:00:01.000Z',
  type: 'gemini',
  content: text,
  thoughts: [],
  tokens: { input: 1, output: 1, cached: 0, total: 2 },
  model: 'gemini-2.5-pro',
});

// Gemini only ever records a tool call after it finishes: the `gemini` message record that announced the
// turn gets a SECOND line, same id, now carrying `toolCalls` with the result already attached.
const geminiToolCompleted = (
  messageId: string,
  toolId: string,
  toolName: string,
  args: Record<string, unknown>,
) => ({
  id: messageId,
  timestamp: '2026-10-08T00:00:02.000Z',
  type: 'gemini',
  content: '',
  thoughts: [],
  model: 'gemini-2.5-pro',
  toolCalls: [
    {
      id: toolId,
      name: toolName,
      args,
      result: [{ functionResponse: { id: toolId, name: toolName, response: { output: 'ok' } } }],
      status: 'success',
      timestamp: '2026-10-08T00:00:02.000Z',
    },
  ],
});

/** Write a Gemini CLI session into its session store under the test home, laid out as Gemini writes it: a
 *  project-slug directory holding the `.project_root` ownership marker (the only place cwd is recorded) and
 *  a `chats` directory holding the session's `.jsonl` transcript, with the metadata header as its first line. */
function geminiSession(slug: string, name: string, cwd: string, records: object[]): string {
  const projectDir = path.join(tmpHome, '.gemini', 'tmp', slug);
  const chatsDir = path.join(projectDir, 'chats');
  fs.mkdirSync(chatsDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, '.project_root'), cwd);
  const file = path.join(chatsDir, `session-${name}.jsonl`);
  const header = {
    sessionId: name,
    projectHash: 'deadbeef',
    startTime: '2026-10-08T00:00:00.000Z',
    lastUpdated: '2026-10-08T00:00:00.000Z',
    kind: 'main',
  };
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

// herdr reports no agent_session for Gemini (no official integration, status-only via screen manifest), so
// a Gemini pane never carries sessionRef: the default pane below matches what MultiplexerFeed actually sees.
function pane(overrides: Partial<MultiplexedAgent> = {}): MultiplexedAgent {
  return {
    paneId: 'p1',
    agentKind: 'gemini',
    status: 'working',
    cwd: path.join(os.tmpdir(), 'pxl-untracked-pane'),
    name: 'alpha',
    task: 'Ship the release',
    ...overrides,
  };
}

describe('gemini module', () => {
  let store: AgentStateStore;
  let runtime: AgentRuntime | undefined;
  let messages: Message[];

  const ofType = (type: string) => messages.filter((m) => m.type === type);
  const onlyAgentId = (): number => {
    expect(store.size).toBe(1);
    return [...store.keys()][0];
  };

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-gemini-'));
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

  it('a running Gemini session appears with its tool activity and goes idle when its turn ends', () => {
    const cwd = path.join(tmpHome, 'work', 'monopoly');
    const file = geminiSession('monopoly', 'live', cwd, [userMessage('m1', 'go read the plan')]);
    runtime = new AgentRuntime(store, { agents: [geminiModule], multiplexers: [] });
    runtime.startModules();

    const id = onlyAgentId();
    expect(store.get(id)?.folderName).toBe('monopoly');

    // Gemini writes a tool call only once it has already completed: toolStart and toolEnd fire together.
    fs.appendFileSync(
      file,
      jsonl([
        geminiToolCompleted('m2', 't1', 'read_file', { file_path: path.join(cwd, 'PLAN.md') }),
      ]),
    );
    vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
    expect(ofType('agentToolStart')).toContainEqual(
      expect.objectContaining({ id, status: 'Reading PLAN.md', toolName: 'read_file' }),
    );

    fs.appendFileSync(file, jsonl([geminiAnswer('m3', 'Here is the summary.')]));
    vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
    expect(ofType('agentStatus').at(-1)).toMatchObject({ id, status: 'waiting' });
  });

  it('never replays history: a tool call already on disk when the session is discovered is not re-announced', () => {
    // Gemini never records a clean session exit (SessionEnd is a best-effort hook, not written to the
    // JSONL), so unlike omp/claude there is nothing here to leave "off the floor" by replay-skipping a
    // dead file; this instead pins that discovery reads only the starting STATE from the tail.
    geminiSession('idle', 'idle', path.join(tmpHome, 'work', 'idle'), [
      geminiToolCompleted('m1', 'old', 'run_shell_command', { command: 'ls' }),
      geminiAnswer('m2', 'done'),
    ]);
    runtime = new AgentRuntime(store, { agents: [geminiModule], multiplexers: [] });
    runtime.startModules();
    vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS * 3);

    const id = onlyAgentId();
    expect(store.get(id)?.folderName).toBe('idle');
    expect(ofType('agentToolStart')).toEqual([]);
  });

  it('a pane herdr reports with no session ref joins the Gemini session running in its cwd', () => {
    const mux = fakeMultiplexer();
    const cwd = path.join(tmpHome, 'work', 'zeta');
    geminiSession('zeta', 'zeta-sess', cwd, [userMessage('m1', 'hi')]);
    runtime = new AgentRuntime(store, { agents: [geminiModule], multiplexers: [mux.module] });
    runtime.startModules(); // SessionStoreTracker discovers synchronously on start, before any pane exists
    const id = onlyAgentId();

    mux.publish([pane({ cwd, name: 'zeta' })]);
    expect(store.size).toBe(1);
    expect(onlyAgentId()).toBe(id);
    expect(ofType('agentInfo').at(-1)).toMatchObject({ id, name: 'zeta' });
  });
});
