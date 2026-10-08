import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentEvent, ModuleHost } from '../../core/src/provider.js';
import { DEFAULT_SESSION_STORE_TIMING } from '../src/providers/sessionStore/constants.js';
import type {
  ListedSession,
  SessionCursor,
  SessionState,
  SessionStore,
} from '../src/providers/sessionStore/sessionStoreTracker.js';
import { SessionStoreTracker } from '../src/providers/sessionStore/sessionStoreTracker.js';

interface FakeSessionData {
  cwd: string;
  stateAtOpen: SessionState;
  events: AgentEvent[];
}

/** An in-memory `SessionStore` the test drives directly: `listed` controls what `listSessions()` reports, `data`
 *  controls what `open()` returns. `open()` snapshots `events.length` at call time, so events already present
 *  before a session is opened are history and never surface through `read()` -- only later pushes do, matching how
 *  a real cursor opens at the file's current end. */
function fakeStore() {
  const listed = new Map<string, { mtimeMs: number; size: number }>();
  const data = new Map<string, FakeSessionData>();
  const open = vi.fn((key: string): SessionCursor | null => {
    const session = data.get(key);
    if (!session) return null;
    let readIndex = session.events.length;
    return {
      cwd: session.cwd,
      state: session.stateAtOpen,
      get size() {
        return session.events.length;
      },
      read() {
        const fresh = session.events.slice(readIndex);
        readIndex = session.events.length;
        return fresh;
      },
    };
  });
  const store: SessionStore = {
    listSessions: (): ListedSession[] => [...listed].map(([key, v]) => ({ key, ...v })),
    open,
    canonicalKey: (sessionRef) => sessionRef,
  };
  return {
    store,
    open,
    setListed(key: string, mtimeMs: number, size: number) {
      listed.set(key, { mtimeMs, size });
    },
    removeListed(key: string) {
      listed.delete(key);
    },
    setData(key: string, cwd: string, stateAtOpen: SessionState, events: AgentEvent[] = []) {
      data.set(key, { cwd, stateAtOpen, events });
    },
    pushEvent(key: string, event: AgentEvent) {
      data.get(key)!.events.push(event);
    },
  };
}

function recordingHost(): ModuleHost & { emitted: { sessionId: string; event: AgentEvent }[] } {
  const emitted: { sessionId: string; event: AgentEvent }[] = [];
  return {
    emitted,
    emit: (sessionId, event) => emitted.push({ sessionId, event }),
    log: () => {},
  };
}

const { discoveryMs, pollMs, activeWindowMs } = DEFAULT_SESSION_STORE_TIMING;

let tracker: SessionStoreTracker | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  tracker?.stop();
  tracker = undefined;
  vi.useRealTimers();
});

describe('SessionStoreTracker discovery', () => {
  it('ignores a session last touched outside the active window', () => {
    const fake = fakeStore();
    fake.setListed('stale', 0, 10);
    fake.setData('stale', '', 'idle');
    vi.setSystemTime(activeWindowMs + 1);

    const host = recordingHost();
    tracker = new SessionStoreTracker(host, fake.store, DEFAULT_SESSION_STORE_TIMING);

    expect(host.emitted).toEqual([]);
  });

  it('picks up a session once it falls back inside the active window', () => {
    const fake = fakeStore();
    fake.setListed('late', 0, 10);
    fake.setData('late', '', 'idle');
    vi.setSystemTime(activeWindowMs + 1);

    const host = recordingHost();
    tracker = new SessionStoreTracker(host, fake.store, DEFAULT_SESSION_STORE_TIMING);
    expect(host.emitted).toEqual([]);

    fake.setListed('late', activeWindowMs + 1, 10);
    vi.advanceTimersByTime(discoveryMs);

    expect(host.emitted.map((e) => e.event.kind)).toEqual(['sessionStart', 'turnEnd']);
  });

  it('drops a tracked session once it goes untouched past the active window, emitting sessionEnd', () => {
    const fake = fakeStore();
    fake.setListed('going-stale', 0, 10);
    fake.setData('going-stale', '', 'idle');

    const host = recordingHost();
    tracker = new SessionStoreTracker(host, fake.store, DEFAULT_SESSION_STORE_TIMING);
    expect(host.emitted.map((e) => e.event.kind)).toEqual(['sessionStart', 'turnEnd']);

    vi.setSystemTime(activeWindowMs + 1);
    vi.advanceTimersByTime(discoveryMs);

    expect(host.emitted.map((e) => e.event.kind)).toEqual([
      'sessionStart',
      'turnEnd',
      'sessionEnd',
    ]);
    expect(host.emitted.at(-1)!.event).toEqual({ kind: 'sessionEnd', reason: 'exit' });
  });

  it('keeps a session exited on its last discovery off, with no events emitted for it', () => {
    const fake = fakeStore();
    fake.setListed('crashed', 0, 50);
    fake.setData('crashed', '', 'exited');

    const host = recordingHost();
    tracker = new SessionStoreTracker(host, fake.store, DEFAULT_SESSION_STORE_TIMING);
    expect(host.emitted).toEqual([]);

    vi.advanceTimersByTime(discoveryMs * 3);
    expect(host.emitted).toEqual([]);
  });

  it('resurrects an exited session once it grows past the size it exited at', () => {
    const fake = fakeStore();
    fake.setListed('resumed', 0, 50);
    fake.setData('resumed', '', 'exited');

    const host = recordingHost();
    tracker = new SessionStoreTracker(host, fake.store, DEFAULT_SESSION_STORE_TIMING);
    expect(host.emitted).toEqual([]);

    fake.setData('resumed', '', 'idle');
    fake.setListed('resumed', discoveryMs, 51);
    vi.advanceTimersByTime(discoveryMs);

    expect(host.emitted.map((e) => e.event.kind)).toEqual(['sessionStart', 'turnEnd']);
  });

  it('exited sessions untouched at the same size stay off across repeated discovery ticks', () => {
    const fake = fakeStore();
    fake.setListed('flatlined', 0, 50);
    fake.setData('flatlined', '', 'exited');

    const host = recordingHost();
    tracker = new SessionStoreTracker(host, fake.store, DEFAULT_SESSION_STORE_TIMING);

    vi.advanceTimersByTime(discoveryMs * 5);
    expect(host.emitted).toEqual([]);
  });
});

describe('SessionStoreTracker history replay', () => {
  it('never replays records that existed before a session was opened', () => {
    const fake = fakeStore();
    fake.setListed('with-history', 0, 10);
    fake.setData('with-history', '', 'idle', [
      { kind: 'toolStart', toolId: 'old-1', toolName: 'Bash' },
      { kind: 'turnEnd' },
    ]);

    const host = recordingHost();
    tracker = new SessionStoreTracker(host, fake.store, DEFAULT_SESSION_STORE_TIMING);

    expect(host.emitted.map((e) => e.event.kind)).toEqual(['sessionStart', 'turnEnd']);
    expect(host.emitted.some((e) => e.event.kind === 'toolStart')).toBe(false);

    fake.pushEvent('with-history', { kind: 'toolStart', toolId: 'new-1', toolName: 'Read' });
    fake.setListed('with-history', pollMs, 11);
    vi.advanceTimersByTime(pollMs);

    const toolStarts = host.emitted.filter((e) => e.event.kind === 'toolStart');
    expect(toolStarts).toEqual([
      {
        sessionId: 'with-history',
        event: { kind: 'toolStart', toolId: 'new-1', toolName: 'Read' },
      },
    ]);
  });
});

describe('SessionStoreTracker refcounted holders', () => {
  it('shares one reader between discovery and a follow, keeping the session alive until the last release', () => {
    const fake = fakeStore();
    fake.setListed('shared', 0, 10);
    fake.setData('shared', '', 'idle');

    const host = recordingHost();
    tracker = new SessionStoreTracker(host, fake.store, DEFAULT_SESSION_STORE_TIMING);
    expect(fake.open).toHaveBeenCalledTimes(1);

    const handle = tracker.followSession('shared');
    expect(fake.open).toHaveBeenCalledTimes(1); // already tracked: no second open

    handle.stop();
    expect(host.emitted.some((e) => e.event.kind === 'sessionEnd')).toBe(false); // discovery still holds it

    fake.removeListed('shared');
    vi.advanceTimersByTime(discoveryMs);

    expect(host.emitted.at(-1)!.event).toEqual({ kind: 'sessionEnd', reason: 'exit' });
  });

  it('keeps a session alive while any follower holds it, closing only once every follower releases', () => {
    const fake = fakeStore();
    fake.setData('followed-only', '', 'idle');

    const host = recordingHost();
    tracker = new SessionStoreTracker(host, fake.store, DEFAULT_SESSION_STORE_TIMING);

    const first = tracker.followSession('followed-only');
    const second = tracker.followSession('followed-only');
    expect(fake.open).toHaveBeenCalledTimes(1);

    first.stop();
    expect(host.emitted.some((e) => e.event.kind === 'sessionEnd')).toBe(false);

    second.stop();
    expect(host.emitted.at(-1)!.event).toEqual({ kind: 'sessionEnd', reason: 'exit' });
  });
});

describe('SessionStoreTracker.sessionInDirectory', () => {
  it('returns the single live session in a cwd, undefined with none or several', () => {
    const fake = fakeStore();
    fake.setListed('alone', 0, 1);
    fake.setData('alone', '/work/alone-project', 'idle');
    fake.setListed('shared-a', 0, 1);
    fake.setData('shared-a', '/work/shared-project', 'idle');
    fake.setListed('shared-b', 0, 1);
    fake.setData('shared-b', '/work/shared-project', 'idle');

    const host = recordingHost();
    tracker = new SessionStoreTracker(host, fake.store, DEFAULT_SESSION_STORE_TIMING);

    expect(tracker.sessionInDirectory('/work/alone-project')).toBe('alone');
    expect(tracker.sessionInDirectory('/work/shared-project')).toBeUndefined();
    expect(tracker.sessionInDirectory('/work/no-such-project')).toBeUndefined();
  });
});

describe('SessionStoreTracker session identity', () => {
  it("reports sessionStart's sessionRef in the store's own key form, not the raw ref a caller passed", () => {
    const fake = fakeStore();
    fake.setData('session-abc', '', 'idle');
    const store: SessionStore = {
      ...fake.store,
      canonicalKey: (ref) => ref.toLowerCase(),
    };

    const host = recordingHost();
    tracker = new SessionStoreTracker(host, store, DEFAULT_SESSION_STORE_TIMING);
    tracker.followSession('SESSION-ABC');

    expect(host.emitted[0]).toEqual({
      sessionId: 'session-abc',
      event: { kind: 'sessionStart', source: 'startup', sessionRef: 'session-abc', cwd: undefined },
    });
  });
});

describe('SessionStoreTracker.stop', () => {
  it('stops both discovery and per-session polling', () => {
    const fake = fakeStore();
    fake.setListed('polled', 0, 10);
    fake.setData('polled', '', 'idle');

    const host = recordingHost();
    tracker = new SessionStoreTracker(host, fake.store, DEFAULT_SESSION_STORE_TIMING);
    const emittedBeforeStop = host.emitted.length;

    tracker.stop();
    expect(vi.getTimerCount()).toBe(0);

    fake.pushEvent('polled', { kind: 'toolStart', toolId: 'late', toolName: 'Bash' });
    fake.setListed('polled', pollMs, 11);
    fake.setListed('new-after-stop', 0, 10);
    fake.setData('new-after-stop', '', 'idle');

    vi.advanceTimersByTime(discoveryMs * 10);
    expect(host.emitted).toHaveLength(emittedBeforeStop);
  });
});
