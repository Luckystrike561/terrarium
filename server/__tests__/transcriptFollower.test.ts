import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MultiplexedAgent, MultiplexerModule } from '../../core/src/provider.js';
import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import {
  EXTERNAL_SCAN_INTERVAL_MS,
  GLOBAL_SCAN_ACTIVE_MIN_SIZE,
  TRANSCRIPT_FOLLOW_RETRY_MS,
} from '../src/constants.js';
import { claudeModule } from '../src/providers/claude/claude.js';
import type { TranscriptAdoption } from '../src/transcriptFollower.js';
import { TranscriptFollower } from '../src/transcriptFollower.js';

// claudeModule's getAllSessionRoots and the server's ~/.pixel-agents/ both resolve against the home directory.
let tmpHome: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpHome };
});

function jsonl(records: object[]): string {
  return records.map((r) => `${JSON.stringify(r)}\n`).join('');
}

/** A TranscriptAdoption whose adopt() call is fully observable by the test, standing in for
 *  AgentRuntime's real adoptFollowedTranscript. */
function fakeAdoption(roots: string[]): {
  adoption: TranscriptAdoption;
  adopted: { file: string; sessionId: string; sessionRef: string }[];
  ended: number[];
} {
  const adopted: { file: string; sessionId: string; sessionRef: string }[] = [];
  const ended: number[] = [];
  let nextAgentId = 1;
  return {
    adoption: {
      sessionRoots: () => roots,
      adopt: (file, sessionId, sessionRef) => {
        adopted.push({ file, sessionId, sessionRef });
        return nextAgentId++;
      },
      end: (agentId) => ended.push(agentId),
    },
    adopted,
    ended,
  };
}

describe('TranscriptFollower resolving a session ref to a transcript file', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-transcript-'));
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('resolves a bare session id against the project directories under the session roots', () => {
    const projectDir = path.join(root, '-work-delta');
    fs.mkdirSync(projectDir, { recursive: true });
    const sessionId = '0b5e7c1e-4a2d-4c36-9f0e-1d2c3b4a5f60';
    const file = path.join(projectDir, `${sessionId}.jsonl`);
    fs.writeFileSync(file, '');
    const { adoption, adopted } = fakeAdoption([root]);
    const follower = new TranscriptFollower(adoption);

    follower.followSession(sessionId);

    expect(adopted).toEqual([{ file: fs.realpathSync(file), sessionId, sessionRef: sessionId }]);
  });

  it('retries every TRANSCRIPT_FOLLOW_RETRY_MS until the CLI creates the transcript file', () => {
    const projectDir = path.join(root, '-work-delta');
    fs.mkdirSync(projectDir, { recursive: true });
    const sessionId = '0b5e7c1e-4a2d-4c36-9f0e-1d2c3b4a5f60';
    const file = path.join(projectDir, `${sessionId}.jsonl`);
    const { adoption, adopted } = fakeAdoption([root]);
    const follower = new TranscriptFollower(adoption);

    follower.followSession(sessionId);
    expect(adopted).toEqual([]);

    vi.advanceTimersByTime(TRANSCRIPT_FOLLOW_RETRY_MS);
    expect(adopted).toEqual([]);

    fs.writeFileSync(file, '');
    vi.advanceTimersByTime(TRANSCRIPT_FOLLOW_RETRY_MS);
    expect(adopted).toEqual([{ file: fs.realpathSync(file), sessionId, sessionRef: sessionId }]);

    vi.advanceTimersByTime(TRANSCRIPT_FOLLOW_RETRY_MS * 3);
    expect(adopted).toHaveLength(1);
  });

  it('stops retrying once the pane ends before the transcript ever appears', () => {
    const sessionId = 'never-appears';
    const { adoption, adopted } = fakeAdoption([root]);
    const follower = new TranscriptFollower(adoption);

    const handle = follower.followSession(sessionId);
    handle.stop();

    vi.advanceTimersByTime(TRANSCRIPT_FOLLOW_RETRY_MS * 5);
    expect(adopted).toEqual([]);
  });

  it('keeps a session shared by several panes alive until every follower releases it', () => {
    const projectDir = path.join(root, '-work-delta');
    fs.mkdirSync(projectDir, { recursive: true });
    const sessionId = '0b5e7c1e-4a2d-4c36-9f0e-1d2c3b4a5f60';
    fs.writeFileSync(path.join(projectDir, `${sessionId}.jsonl`), '');
    const { adoption, adopted, ended } = fakeAdoption([root]);
    const follower = new TranscriptFollower(adoption);

    const first = follower.followSession(sessionId);
    const second = follower.followSession(sessionId);
    expect(adopted).toHaveLength(1);

    first.stop();
    expect(ended).toEqual([]);
    second.stop();
    expect(ended).toEqual([1]);
  });
});

describe('TranscriptFollower when adoption reports the session already belongs to someone', () => {
  it('settles without retrying once adoption reports the session is already held elsewhere', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-transcript-held-'));
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    try {
      const projectDir = path.join(root, '-work-delta');
      fs.mkdirSync(projectDir, { recursive: true });
      const sessionId = 'already-watched';
      fs.writeFileSync(path.join(projectDir, `${sessionId}.jsonl`), '');
      const adopted: { file: string; sessionId: string; sessionRef: string }[] = [];
      const ended: number[] = [];
      const follower = new TranscriptFollower({
        sessionRoots: () => [root],
        adopt: (file, sid, sessionRef) => {
          adopted.push({ file, sessionId: sid, sessionRef });
          return undefined; // an agent elsewhere already reports this file
        },
        end: (agentId) => ended.push(agentId),
      });

      const handle = follower.followSession(sessionId);
      expect(adopted).toHaveLength(1);

      vi.advanceTimersByTime(TRANSCRIPT_FOLLOW_RETRY_MS * 3);
      expect(adopted).toHaveLength(1);

      handle.stop();
      expect(ended).toEqual([]);
    } finally {
      vi.useRealTimers();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

/** A multiplexer whose snapshots the test publishes directly, bypassing any real connection. */
function fakeMultiplexer(): {
  module: MultiplexerModule;
  publish: (agents: MultiplexedAgent[]) => void;
} {
  let onSnapshot: (agents: readonly MultiplexedAgent[]) => void = () => {};
  return {
    module: {
      kind: 'multiplexer',
      id: 'herdr',
      displayName: 'Fake herdr',
      connect: (callback) => {
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
    agentKind: 'claude',
    status: 'working',
    cwd: '/work/echo',
    name: 'echo',
    task: 'Ship the release',
    ...overrides,
  };
}

describe('TranscriptFollower through the running agent runtime', () => {
  let store: AgentStateStore;
  let runtime: AgentRuntime | undefined;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-follower-runtime-'));
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    store = new AgentStateStore();
  });

  afterEach(() => {
    runtime?.dispose();
    runtime = undefined;
    vi.useRealTimers();
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("attaches a late-appearing transcript to the pane's own character, leaving hookDelivered off", () => {
    const mux = fakeMultiplexer();
    const sessionId = '0b5e7c1e-4a2d-4c36-9f0e-1d2c3b4a5f61';
    const dir = path.join(tmpHome, '.claude', 'projects', '-work-echo');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${sessionId}.jsonl`);
    runtime = new AgentRuntime(store, { agents: [claudeModule], multiplexers: [mux.module] });
    runtime.startModules();

    mux.publish([pane({ sessionRef: sessionId })]);
    expect(store.size).toBe(1);
    const paneId = [...store.keys()][0];
    expect(store.get(paneId)?.jsonlFile).toBe('');

    fs.writeFileSync(file, jsonl([{ type: 'user', message: { role: 'user', content: 'go' } }]));
    vi.advanceTimersByTime(TRANSCRIPT_FOLLOW_RETRY_MS);
    mux.publish([pane({ sessionRef: sessionId })]);

    expect(store.size).toBe(1);
    const id = [...store.keys()][0];
    expect(id).toBe(paneId);
    expect(store.get(id)?.jsonlFile).toBe(fs.realpathSync(file));
    expect(store.get(id)?.hookDelivered).toBe(false);

    // A multiplexer's own status reports are not hooks: they must not retroactively mark the
    // transcript-driven agent hook-delivered, which would silence its heuristic turn-end timers.
    mux.publish([pane({ sessionRef: sessionId, status: 'blocked' })]);
    expect(store.get(id)?.hookDelivered).toBe(false);
  });

  it('leaves a transcript the runtime already scanned with that agent when a pane reports the same session', () => {
    const mux = fakeMultiplexer();
    const sessionId = '0b5e7c1e-4a2d-4c36-9f0e-1d2c3b4a5f62';
    const dir = path.join(tmpHome, '.claude', 'projects', '-work-foxtrot');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${sessionId}.jsonl`);
    fs.writeFileSync(
      file,
      jsonl([
        {
          type: 'user',
          message: { role: 'user', content: 'go'.repeat(GLOBAL_SCAN_ACTIVE_MIN_SIZE) },
        },
      ]),
    );
    runtime = new AgentRuntime(store, { agents: [claudeModule], multiplexers: [mux.module] });
    runtime.startModules();
    runtime.startExternalScanning('/unused');
    vi.advanceTimersByTime(EXTERNAL_SCAN_INTERVAL_MS);

    expect(store.size).toBe(1);
    const scannedId = [...store.keys()][0];
    expect(store.get(scannedId)?.jsonlFile).toBe(fs.realpathSync(file));

    mux.publish([pane({ sessionRef: sessionId, cwd: '/work/foxtrot', name: 'foxtrot' })]);

    expect(store.size).toBe(1);
    expect([...store.keys()][0]).toBe(scannedId);
    expect(store.get(scannedId)?.sessionRef).toBe(sessionId);
  });
});
