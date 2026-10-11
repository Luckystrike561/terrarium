import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AgentEvent,
  ModuleHost,
  MultiplexedAgent,
  MultiplexerEndpoint,
  MultiplexerLinkState,
  MultiplexerModule,
  MultiplexerWatcher,
  RunningAgentModule,
} from '../../core/src/provider.js';
import { MultiplexerFeed, type MultiplexerFeedOptions } from '../src/multiplexerFeed.js';

interface FakeMultiplexer {
  module: MultiplexerModule;
  publish: (agents: MultiplexedAgent[]) => void;
  setState: (state: MultiplexerLinkState, message?: string) => void;
  isConnected: () => boolean;
}

/** A multiplexer whose snapshots and link state the test publishes directly, bypassing any real connection. */
function fakeMultiplexer(id = 'herdr'): FakeMultiplexer {
  let watcher: MultiplexerWatcher | null = null;
  return {
    module: {
      kind: 'multiplexer',
      id,
      displayName: 'Fake multiplexer',
      connect: (_endpoint, connected) => {
        watcher = connected;
        connected.onState('connected');
        return { stop: () => (watcher = null) };
      },
      probe: () => Promise.resolve(undefined),
    },
    publish: (agents) => watcher?.onSnapshot(agents),
    setState: (state, message) => watcher?.onState(state, message),
    isConnected: () => watcher !== null,
  };
}

const LOCAL: MultiplexerEndpoint = { id: 'local', kind: 'local' };

function startFeed(
  mux: FakeMultiplexer,
  host: ModuleHost,
  agentModules: ReadonlyMap<string, RunningAgentModule>,
  overrides: Partial<MultiplexerFeedOptions> = {},
): { feed: MultiplexerFeed; states: { state: MultiplexerLinkState; message?: string }[] } {
  const states: { state: MultiplexerLinkState; message?: string }[] = [];
  const feed = new MultiplexerFeed({
    multiplexer: mux.module,
    endpoint: LOCAL,
    host,
    agentModules,
    onState: (state, message) => states.push({ state, message }),
    ...overrides,
  });
  feed.start();
  return { feed, states };
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
  it('announces a new pane as a sessionStart under <multiplexer>-<endpoint>-<pane>', () => {
    const mux = fakeMultiplexer('herdr');
    const { host, emitted } = fakeHost();
    startFeed(mux, host, new Map());

    mux.publish([pane({ paneId: 'p7', cwd: '/work/alpha' })]);

    expect(emitted[0]).toMatchObject({
      sessionId: 'herdr-local-p7',
      event: { kind: 'sessionStart', cwd: '/work/alpha' },
    });
  });

  it('ends the session when a pane drops out of the snapshot', () => {
    const mux = fakeMultiplexer();
    const { host, emitted } = fakeHost();
    startFeed(mux, host, new Map());

    mux.publish([pane({ paneId: 'p1' })]);
    mux.publish([]);

    expect(emitted.at(-1)).toMatchObject({
      sessionId: 'herdr-local-p1',
      event: { kind: 'sessionEnd', reason: 'exit' },
    });
  });

  it('emits nothing further for a snapshot unchanged from the last one', () => {
    const mux = fakeMultiplexer();
    const { host, emitted } = fakeHost();
    startFeed(mux, host, new Map());

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
    startFeed(mux, host, new Map());

    mux.publish([pane({ status: 'working' })]);
    mux.publish([pane({ status: 'blocked' })]);
    mux.publish([pane({ status: 'idle' })]);

    const kinds = emitted.filter((e) => e.sessionId === 'herdr-local-p1').map((e) => e.event.kind);
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
    startFeed(mux, host, new Map());

    mux.publish([pane({ status: 'working' })]);
    mux.publish([pane({ status: 'working' })]);

    expect(emitted.filter((e) => e.event.kind === 'working')).toHaveLength(1);
  });

  it('emits sessionInfo only when the pane name or task actually changes', () => {
    const mux = fakeMultiplexer();
    const { host, emitted } = fakeHost();
    startFeed(mux, host, new Map());

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
    startFeed(mux, host, new Map([['omp', omp.module]]));

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
    startFeed(mux, host, new Map([['omp', omp.module]]));

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
    startFeed(mux, host, new Map([['omp', omp.module]]));

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
    startFeed(mux, host, new Map([['omp', omp.module]]));

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
    startFeed(mux, host, new Map([['omp', omp.module]]));

    mux.publish([pane({ sessionRef: '/work/alpha/session.jsonl' })]);
    mux.publish([]);

    expect(omp.follows).toEqual([{ sessionRef: '/work/alpha/session.jsonl', stopped: true }]);
    expect(emitted.some((e) => e.event.kind === 'sessionEnd')).toBe(false);
  });
});

describe('MultiplexerFeed endpoints', () => {
  it('keeps equal pane ids on two endpoints apart as two sessions', () => {
    const { host, emitted } = fakeHost();
    const local = fakeMultiplexer();
    const remote = fakeMultiplexer();
    startFeed(local, host, new Map());
    startFeed(remote, host, new Map(), {
      endpoint: { id: 'c0ffee', kind: 'ssh', target: 'buildbox' },
    });

    local.publish([pane({ paneId: 'w1:p1' })]);
    remote.publish([pane({ paneId: 'w1:p1' })]);

    const starts = emitted.filter((e) => e.event.kind === 'sessionStart').map((e) => e.sessionId);
    expect(starts).toEqual(['herdr-local-w1:p1', 'herdr-c0ffee-w1:p1']);
  });

  it('never hands a pane on another machine to a local agent module, nor claims its session ref', () => {
    const { host, emitted } = fakeHost();
    const mux = fakeMultiplexer();
    const omp = fakeRunningAgentModule(() => '/work/alpha/local-session.jsonl');
    startFeed(mux, host, new Map([['omp', omp.module]]), {
      endpoint: { id: 'c0ffee', kind: 'ssh', target: 'buildbox' },
    });

    mux.publish([pane({ sessionRef: '/home/remote/.omp/session.jsonl', status: 'idle' })]);

    expect(omp.follows).toEqual([]);
    expect(emitted.find((e) => e.event.kind === 'sessionStart')?.event).toMatchObject({
      sessionRef: undefined,
    });
    expect(emitted.some((e) => e.event.kind === 'turnEnd')).toBe(true);
  });

  it('names characters after the endpoint label, and renames them from the next snapshot on', () => {
    const { host, emitted } = fakeHost();
    const mux = fakeMultiplexer();
    const { feed } = startFeed(mux, host, new Map(), { label: 'buildbox' });

    mux.publish([pane({ name: 'alpha' })]);
    feed.relabel('ci');
    mux.publish([pane({ name: 'alpha' })]);

    const names = emitted
      .map((e) => e.event)
      .flatMap((event) => (event.kind === 'sessionInfo' ? [event.name] : []));
    expect(names).toEqual(['alpha @buildbox', 'alpha @ci']);
  });
});

describe('MultiplexerFeed link state', () => {
  it('ends every pane when the link is lost and announces them again once it answers', () => {
    const { host, emitted } = fakeHost();
    const mux = fakeMultiplexer();
    const { states } = startFeed(mux, host, new Map());
    mux.publish([pane({ paneId: 'p1' }), pane({ paneId: 'p2' })]);

    mux.setState('reconnecting', 'herdr closed the connection');
    const ends = emitted.filter((e) => e.event.kind === 'sessionEnd').map((e) => e.sessionId);
    expect(ends).toEqual(['herdr-local-p1', 'herdr-local-p2']);
    expect(states.at(-1)).toEqual({
      state: 'reconnecting',
      message: 'herdr closed the connection',
    });

    mux.setState('connected');
    mux.publish([pane({ paneId: 'p1' })]);
    const starts = emitted.filter((e) => e.event.kind === 'sessionStart').map((e) => e.sessionId);
    expect(starts).toEqual(['herdr-local-p1', 'herdr-local-p2', 'herdr-local-p1']);
  });

  it('ignores a snapshot that arrives after the link was lost', () => {
    const { host, emitted } = fakeHost();
    const mux = fakeMultiplexer();
    const { states } = startFeed(mux, host, new Map());
    mux.publish([pane({ paneId: 'p1' })]);

    mux.setState('reconnecting', 'herdr closed the connection');
    mux.publish([pane({ paneId: 'p1' }), pane({ paneId: 'p2' })]);

    const starts = emitted.filter((e) => e.event.kind === 'sessionStart').map((e) => e.sessionId);
    expect(starts).toEqual(['herdr-local-p1']);
    expect(states.at(-1)).toEqual({
      state: 'reconnecting',
      message: 'herdr closed the connection',
    });
  });

  it('stop disconnects and ends every pane it announced', () => {
    const { host, emitted } = fakeHost();
    const mux = fakeMultiplexer();
    const omp = fakeRunningAgentModule();
    const { feed } = startFeed(mux, host, new Map([['omp', omp.module]]));
    mux.publish([
      pane({ paneId: 'status-only', agentKind: 'codex' }),
      pane({ paneId: 'followed', sessionRef: '/work/alpha/session.jsonl' }),
    ]);

    feed.stop();

    expect(mux.isConnected()).toBe(false);
    expect(omp.follows).toEqual([{ sessionRef: '/work/alpha/session.jsonl', stopped: true }]);
    expect(emitted.filter((e) => e.event.kind === 'sessionEnd').map((e) => e.sessionId)).toEqual([
      'herdr-local-status-only',
    ]);
  });
});
