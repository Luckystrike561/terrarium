import * as fs from 'fs';
import type * as OsModule from 'os';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MultiplexedAgent, MultiplexerModule } from '../../core/src/provider.js';
import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { makiModule } from '../src/providers/maki/maki.js';
import {
  SESSION_DISCOVERY_INTERVAL_MS,
  SESSION_POLL_INTERVAL_MS,
} from '../src/providers/sessionStore/constants.js';

// Maki's session store and the server's ~/.pixel-agents/ both resolve against the home directory.
let tmpHome: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof OsModule>('os');
  return { ...actual, homedir: () => tmpHome };
});

type Message = Record<string, unknown>;

const userPrompt = { t: 'msg', d: { role: 'user', content: [{ type: 'text', text: 'go' }] } };
const turnEnded = { t: 'msg', d: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } };

function toolUse(toolId: string, toolName: string, input: Record<string, unknown>) {
  return {
    t: 'msg',
    d: { role: 'assistant', content: [{ type: 'tool_use', id: toolId, name: toolName, input }] },
  };
}

function toolResult(toolId: string) {
  return {
    t: 'msg',
    d: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: toolId, is_error: false, content: 'ok' }],
    },
  };
}

function jsonl(records: object[]): string {
  return records.map((r) => `${JSON.stringify(r)}\n`).join('');
}

/** Write a Maki transcript into Maki's session store under the test home, laid out as Maki writes it: a `header`
 *  naming the session's cwd, then the records. Maki's store is a single flat directory: the file name is the
 *  session's own id, which herdr never echoes back (it reports maki panes by screen state only). */
function makiSession(id: string, cwd: string, records: object[]): string {
  const dir = path.join(tmpHome, '.local', 'state', 'maki', 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.jsonl`);
  fs.writeFileSync(
    file,
    jsonl([
      { t: 'header', v: 2, id, model: 'anthropic/claude-sonnet', cwd, created_at: 0 },
      ...records,
    ]),
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
    agentKind: 'maki',
    status: 'working',
    cwd: path.join(os.tmpdir(), 'pxl-untracked-pane'),
    name: 'alpha',
    task: 'Ship the release',
    ...overrides,
  };
}

describe('maki provider module', () => {
  let store: AgentStateStore;
  let runtime: AgentRuntime | undefined;
  let messages: Message[];

  const ofType = (type: string) => messages.filter((m) => m.type === type);
  const onlyAgentId = (): number => {
    expect(store.size).toBe(1);
    return [...store.keys()][0];
  };

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-maki-'));
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

  describe('agent only: maki, no multiplexer', () => {
    it('a running maki session appears with its tool activity, goes idle when its turn ends, and is gone once its file disappears', () => {
      const file = makiSession('01hqz3k9pxg7j8m2n4p6q8r0s2', '/work/monopoly', [userPrompt]);
      runtime = new AgentRuntime(store, { agents: [makiModule], multiplexers: [] });
      runtime.startModules();

      const id = onlyAgentId();
      expect(store.get(id)?.folderName).toBe('monopoly');

      fs.appendFileSync(file, jsonl([toolUse('t1', 'read', { path: '/work/monopoly/PLAN.md' })]));
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentToolStart')).toContainEqual(
        expect.objectContaining({ id, status: 'Reading PLAN.md', toolName: 'read' }),
      );

      fs.appendFileSync(file, jsonl([toolResult('t1'), turnEnded]));
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentStatus').at(-1)).toMatchObject({ id, status: 'waiting' });

      // Maki's format writes no exit record: a session going away is read off the store, not the transcript,
      // once the next discovery scan no longer lists the file.
      fs.rmSync(file);
      vi.advanceTimersByTime(SESSION_DISCOVERY_INTERVAL_MS);
      expect(store.size).toBe(0);
    });

    it('never replays history: a session whose turn already ended before discovery starts idle with no tool activity', () => {
      makiSession('idle-session-id', '/work/idle', [
        toolUse('old', 'bash', { command: 'ls' }),
        turnEnded,
      ]);
      runtime = new AgentRuntime(store, { agents: [makiModule], multiplexers: [] });
      runtime.startModules();
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS * 3);

      const id = onlyAgentId();
      expect(store.get(id)?.folderName).toBe('idle');
      expect(ofType('agentToolStart')).toEqual([]);
    });

    it('skips host-injected observation records and thinking-only replies', () => {
      const file = makiSession('quiet-session-id', '/work/quiet', [userPrompt]);
      runtime = new AgentRuntime(store, { agents: [makiModule], multiplexers: [] });
      runtime.startModules();
      const id = onlyAgentId();

      fs.appendFileSync(
        file,
        jsonl([
          {
            t: 'msg',
            d: { role: 'user', kind: 'observation', content: [{ type: 'text', text: 'reminder' }] },
          },
          { t: 'msg', d: { role: 'assistant', content: [{ type: 'thinking', thinking: 'hmm' }] } },
          turnEnded,
        ]),
      );
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentStatus').at(-1)).toMatchObject({ id, status: 'waiting' });
      expect(ofType('agentToolStart')).toEqual([]);
    });
  });

  describe('both: herdr and maki, no session reference', () => {
    it('a maki pane herdr reports with no session reference joins the session already running in its cwd, never a second character', () => {
      const mux = fakeMultiplexer();
      const file = makiSession('alpha-session-id', '/work/alpha', [userPrompt]);
      runtime = new AgentRuntime(store, { agents: [makiModule], multiplexers: [mux.module] });
      runtime.startModules();
      const discoveredId = onlyAgentId();

      // herdr's maki integration is state-only: the pane carries no sessionRef at all.
      mux.publish([pane({ cwd: '/work/alpha' })]);
      const id = onlyAgentId();
      expect(id).toBe(discoveredId);
      expect(ofType('agentInfo').at(-1)).toMatchObject({
        id,
        name: 'alpha',
        task: 'Ship the release',
      });

      fs.appendFileSync(file, jsonl([toolUse('t1', 'edit', { path: 'src/app.ts' })]));
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentToolStart')).toContainEqual(
        expect.objectContaining({ id, status: 'Editing app.ts' }),
      );

      mux.publish([pane({ cwd: '/work/alpha', status: 'blocked' })]);
      expect(ofType('agentToolPermission')).toContainEqual({ type: 'agentToolPermission', id });

      mux.publish([]);
      // The pane left, but the session file is still growing: the character stays, owned by discovery.
      expect(store.size).toBe(1);
    });

    it('a pane without a session reference does not guess which character it is when two maki sessions share its cwd', () => {
      const mux = fakeMultiplexer();
      makiSession('first-session-id', '/work/shared', [userPrompt]);
      makiSession('second-session-id', '/work/shared', [userPrompt]);
      runtime = new AgentRuntime(store, { agents: [makiModule], multiplexers: [mux.module] });
      runtime.startModules();
      expect(store.size).toBe(2);

      // sessionInDirectory finds two matches and refuses to guess: the pane renders as its own character
      // rather than silently merging into either session.
      mux.publish([pane({ cwd: '/work/shared' })]);
      expect(store.size).toBe(3);
    });
  });
});
