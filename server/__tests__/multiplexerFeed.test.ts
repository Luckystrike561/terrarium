import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AgentEvent,
  ModuleHost,
  MultiplexedAgent,
  MultiplexerModule,
  RunningAgentModule,
} from '../../core/src/provider.js';
import { MultiplexerFeed } from '../src/multiplexerFeed.js';

/** A multiplexer whose snapshots the test publishes directly, bypassing any real connection. */
function fakeMultiplexer(id = 'herdr'): {
  module: MultiplexerModule;
  publish: (agents: MultiplexedAgent[]) => void;
} {
  let onSnapshot: (agents: readonly MultiplexedAgent[]) => void = () => {};
  return {
    module: {
      kind: 'multiplexer',
      id,
      displayName: 'Fake multiplexer',
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
    agentKind: 'omp',
    status: 'working',
    cwd: '/work/alpha',
    name: 'alpha',
    task: 'Ship the release',
    ...overrides,
  };
}

/** Records what the feed emits, standing in for the host the real runtime wires through hookEventHandler. */
function fakeHost(): { host: ModuleHost; emitted: { sessionId: string; event: AgentEvent }[] } {
  const emitted: { sessionId: string; event: AgentEvent }[] = [];
  return {
    host: {
      emit: (sessionId, event) => emitted.push({ sessionId, event }),
      log: () => {},
    },
    emitted,
  };
}

/** An agent module whose session discovery is already running, standing in for omp/claude's RunningAgentModule. */
function fakeRunningAgentModule(sessionInDirectory?: (cwd: string) => string | undefined): {
  module: RunningAgentModule;
  follows: { sessionRef: string; stopped: boolean }[];
} {
  const follows: { sessionRef: string; stopped: boolean }[] = [];
  return {
    module: {
      stop: () => {},
      sessionInDirectory,
      followSession: (sessionRef) => {
        const entry = { sessionRef, stopped: false };
        follows.push(entry);
        return { stop: () => (entry.stopped = true) };
      },
    },
    follows,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('MultiplexerFeed snapshot diffing', () => {
  it('announces a new pane as a sessionStart under <multiplexer>-<pane>', () => {
    const mux = fakeMultiplexer('herdr');
    const { host, emitted } = fakeHost();
    const feed = new MultiplexerFeed(mux.module, host, new Map());
    void feed.start();

    mux.publish([pane({ paneId: 'p7', cwd: '/work/alpha' })]);

    expect(emitted[0]).toMatchObject({
      sessionId: 'herdr-p7',
      event: { kind: 'sessionStart', cwd: '/work/alpha' },
    });
  });

  it('ends the session when a pane drops out of the snapshot', () => {
    const mux = fakeMultiplexer();
    const { host, emitted } = fakeHost();
    const feed = new MultiplexerFeed(mux.module, host, new Map());
    void feed.start();

    mux.publish([pane({ paneId: 'p1' })]);
    mux.publish([]);

    expect(emitted.at(-1)).toMatchObject({
      sessionId: 'herdr-p1',
      event: { kind: 'sessionEnd', reason: 'exit' },
    });
  });

  it('emits nothing further for a snapshot unchanged from the last one', () => {
    const mux = fakeMultiplexer();
    const { host, emitted } = fakeHost();
    const feed = new MultiplexerFeed(mux.module, host, new Map());
    void feed.start();

    mux.publish([pane()]);
    const countAfterFirst = emitted.length;
    mux.publish([pane()]);

    expect(emitted).toHaveLength(countAfterFirst);
  });
});

describe('MultiplexerFeed status transitions with no agent module running', () => {
  it('reports working, blocked and idle as working, permissionRequest and turnEnd', () => {
    const mux = fakeMultiplexer();
    const { host, emitted } = fakeHost();
    const feed = new MultiplexerFeed(mux.module, host, new Map());
    void feed.start();

    mux.publish([pane({ status: 'working' })]);
    mux.publish([pane({ status: 'blocked' })]);
    mux.publish([pane({ status: 'idle' })]);

    const kinds = emitted.filter((e) => e.sessionId === 'herdr-p1').map((e) => e.event.kind);
    expect(kinds).toEqual([
      'sessionStart',
      'sessionInfo',
      'working',
      'permissionRequest',
      'turnEnd',
    ]);
  });

  it('emits a repeated status at the same level only once', () => {
    const mux = fakeMultiplexer();
    const { host, emitted } = fakeHost();
    const feed = new MultiplexerFeed(mux.module, host, new Map());
    void feed.start();

    mux.publish([pane({ status: 'working' })]);
    mux.publish([pane({ status: 'working' })]);

    expect(emitted.filter((e) => e.event.kind === 'working')).toHaveLength(1);
  });

  it('emits sessionInfo only when the pane name or task actually changes', () => {
    const mux = fakeMultiplexer();
    const { host, emitted } = fakeHost();
    const feed = new MultiplexerFeed(mux.module, host, new Map());
    void feed.start();

    mux.publish([pane({ name: 'alpha', task: 'Ship the release' })]);
    mux.publish([pane({ name: 'alpha', task: 'Write release notes' })]);
    mux.publish([pane({ name: 'alpha', task: 'Write release notes' })]);

    const infos = emitted.filter((e) => e.event.kind === 'sessionInfo').map((e) => e.event);
    expect(infos).toEqual([
      { kind: 'sessionInfo', name: 'alpha', task: 'Ship the release' },
      { kind: 'sessionInfo', name: 'alpha', task: 'Write release notes' },
    ]);
  });
});

describe('MultiplexerFeed hand-over to a running agent module', () => {
  it('follows the session a pane reports once the module for its kind is running', () => {
    const mux = fakeMultiplexer();
    const { host, emitted } = fakeHost();
    const omp = fakeRunningAgentModule();
    const feed = new MultiplexerFeed(mux.module, host, new Map([['omp', omp.module]]));
    void feed.start();

    mux.publish([pane({ sessionRef: '/work/alpha/session.jsonl' })]);

    expect(omp.follows).toEqual([{ sessionRef: '/work/alpha/session.jsonl', stopped: false }]);
    expect(emitted.find((e) => e.event.kind === 'sessionStart')?.event).toMatchObject({
      sessionRef: '/work/alpha/session.jsonl',
    });
  });

  it("binds a pane with no reported session to the module's one live session in its directory", () => {
    const mux = fakeMultiplexer();
    const { host, emitted } = fakeHost();
    const omp = fakeRunningAgentModule((cwd) =>
      cwd === '/work/alpha' ? '/work/alpha/session.jsonl' : undefined,
    );
    const feed = new MultiplexerFeed(mux.module, host, new Map([['omp', omp.module]]));
    void feed.start();

    mux.publish([pane({ cwd: '/work/alpha' })]);

    expect(omp.follows).toEqual([{ sessionRef: '/work/alpha/session.jsonl', stopped: false }]);
    expect(emitted.find((e) => e.event.kind === 'sessionStart')?.event).toMatchObject({
      sessionRef: '/work/alpha/session.jsonl',
    });
  });

  it("never guesses a session when several live in the pane's directory", () => {
    const mux = fakeMultiplexer();
    const { host, emitted } = fakeHost();
    const omp = fakeRunningAgentModule(() => undefined);
    const feed = new MultiplexerFeed(mux.module, host, new Map([['omp', omp.module]]));
    void feed.start();

    mux.publish([pane({ cwd: '/work/alpha' })]);
    expect(omp.follows).toEqual([]);
    expect(emitted.find((e) => e.event.kind === 'sessionStart')?.event).toMatchObject({
      sessionRef: undefined,
    });

    // With no followed session, the pane's status is reported in full, exactly as with no agent module at all.
    mux.publish([pane({ cwd: '/work/alpha', status: 'idle' })]);
    expect(emitted.some((e) => e.event.kind === 'turnEnd')).toBe(true);
  });

  it('once handed over, only a blocked status reaches the office; working and idle stay with the transcript', () => {
    const mux = fakeMultiplexer();
    const { host, emitted } = fakeHost();
    const omp = fakeRunningAgentModule();
    const feed = new MultiplexerFeed(mux.module, host, new Map([['omp', omp.module]]));
    void feed.start();

    mux.publish([pane({ sessionRef: '/work/alpha/session.jsonl', status: 'working' })]);
    mux.publish([pane({ sessionRef: '/work/alpha/session.jsonl', status: 'idle' })]);
    expect(emitted.some((e) => e.event.kind === 'working' || e.event.kind === 'turnEnd')).toBe(
      false,
    );

    mux.publish([pane({ sessionRef: '/work/alpha/session.jsonl', status: 'blocked' })]);
    expect(emitted.filter((e) => e.event.kind === 'permissionRequest')).toHaveLength(1);
  });

  it('releases the follow instead of emitting sessionEnd when a followed pane disappears', () => {
    const mux = fakeMultiplexer();
    const { host, emitted } = fakeHost();
    const omp = fakeRunningAgentModule();
    const feed = new MultiplexerFeed(mux.module, host, new Map([['omp', omp.module]]));
    void feed.start();

    mux.publish([pane({ sessionRef: '/work/alpha/session.jsonl' })]);
    mux.publish([]);

    expect(omp.follows).toEqual([{ sessionRef: '/work/alpha/session.jsonl', stopped: true }]);
    expect(emitted.some((e) => e.event.kind === 'sessionEnd')).toBe(false);
  });
});
