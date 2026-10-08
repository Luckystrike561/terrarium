import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MultiplexedAgent, MultiplexerModule } from '../../core/src/provider.js';
import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { cursorModule } from '../src/providers/cursor/cursor.js';
import { SESSION_POLL_INTERVAL_MS } from '../src/providers/sessionStore/constants.js';

// Cursor's session store resolves against the home directory (`~/.cursor`, no CURSOR_CONFIG_DIR override here).
let tmpHome: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpHome };
});

type Message = Record<string, unknown>;

const userPrompt = {
  role: 'user',
  message: { content: [{ type: 'text', text: '<user_query>go</user_query>' }] },
};
const turnEnded = { type: 'turn_ended', status: 'success' };
function toolUse(name: string, input: unknown) {
  return { role: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } };
}

function jsonl(records: object[]): string {
  return records.map((r) => `${JSON.stringify(r)}\n`).join('');
}

/** Write a Cursor transcript into Cursor's session store under the test home, laid out as Cursor writes it:
 *  `<projects>/<slug>/agent-transcripts/<uuid>/<uuid>.jsonl`. Returns the session uuid and the file path. */
function cursorSession(
  slug: string,
  uuid: string,
  records: object[],
): { uuid: string; file: string } {
  const dir = path.join(tmpHome, '.cursor', 'projects', slug, 'agent-transcripts', uuid);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${uuid}.jsonl`);
  fs.writeFileSync(file, jsonl(records));
  return { uuid, file };
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
    agentKind: 'cursor',
    status: 'working',
    cwd: path.join(os.tmpdir(), 'pxl-untracked-cursor-pane'),
    name: 'alpha',
    task: 'Ship the release',
    ...overrides,
  };
}

describe('cursor module', () => {
  let store: AgentStateStore;
  let runtime: AgentRuntime | undefined;
  let messages: Message[];

  const ofType = (type: string) => messages.filter((m) => m.type === type);
  const onlyAgentId = (): number => {
    expect(store.size).toBe(1);
    return [...store.keys()][0];
  };

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-cursor-'));
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

  describe('agent only: cursor, no multiplexer', () => {
    it('a running cursor session appears with its tool activity and goes idle when its turn ends', () => {
      const { file } = cursorSession('-work-monopoly', 'aaaaaaaa-0000-0000-0000-000000000001', [
        userPrompt,
      ]);
      runtime = new AgentRuntime(store, { agents: [cursorModule], multiplexers: [] });
      runtime.startModules();

      const id = onlyAgentId();

      fs.appendFileSync(file, jsonl([toolUse('Read', { path: '/work/monopoly/PLAN.md' })]));
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentToolStart')).toContainEqual(
        expect.objectContaining({ id, status: 'Reading PLAN.md', toolName: 'Read' }),
      );

      fs.appendFileSync(file, jsonl([turnEnded]));
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentStatus').at(-1)).toMatchObject({ id, status: 'waiting' });
    });

    it('never replays history, and leaves cwd empty since Cursor records none', () => {
      cursorSession('-work-idle', 'aaaaaaaa-0000-0000-0000-000000000002', [
        toolUse('Shell', { command: 'ls' }),
        turnEnded,
      ]);
      runtime = new AgentRuntime(store, { agents: [cursorModule], multiplexers: [] });
      runtime.startModules();
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS * 3);

      const id = onlyAgentId();
      expect(ofType('agentToolStart')).toEqual([]);
      expect(store.get(id)?.folderName).toBeFalsy();
    });
  });

  describe('both: herdr and cursor', () => {
    it('a herdr pane naming the conversation uuid is one character with transcript tool activity and pane approval', () => {
      const mux = fakeMultiplexer();
      const { uuid, file } = cursorSession('-work-alpha', 'bbbbbbbb-0000-0000-0000-000000000001', [
        userPrompt,
      ]);
      runtime = new AgentRuntime(store, { agents: [cursorModule], multiplexers: [mux.module] });
      runtime.startModules();

      mux.publish([pane({ sessionRef: uuid })]);
      const id = onlyAgentId();
      expect(ofType('agentInfo').at(-1)).toMatchObject({ id, name: 'alpha' });

      fs.appendFileSync(file, jsonl([toolUse('StrReplace', { path: 'src/app.ts' })]));
      vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
      expect(ofType('agentToolStart')).toContainEqual(
        expect.objectContaining({ id, status: 'Editing app.ts', toolName: 'StrReplace' }),
      );

      mux.publish([pane({ sessionRef: uuid, status: 'blocked' })]);
      expect(ofType('agentToolPermission')).toContainEqual({ type: 'agentToolPermission', id });

      // The session stays: cursor's own discovery still tracks it even once the pane is gone.
      mux.publish([]);
      expect(store.size).toBe(1);
    });
  });
});
