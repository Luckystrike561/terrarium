import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionRouter } from '../src/sessionRouter.js';

describe('SessionRouter', () => {
  let router: SessionRouter;

  beforeEach(() => {
    vi.useFakeTimers();
    router = new SessionRouter();
  });

  afterEach(() => {
    router.dispose();
    vi.useRealTimers();
  });

  // ── Session → Agent mapping ────────────────────────────────────────

  describe('session mapping', () => {
    it('register + resolve returns the agentId', () => {
      router.register('sess-1', 42);
      expect(router.resolve('sess-1')).toBe(42);
    });

    it('unregister removes the mapping', () => {
      router.register('sess-1', 42);
      router.unregister('sess-1');
      expect(router.resolve('sess-1')).toBeUndefined();
    });

    it('resolve returns undefined for unknown sessions', () => {
      expect(router.resolve('unknown')).toBeUndefined();
    });

    it('hasSession checks existence', () => {
      router.register('sess-1', 1);
      expect(router.hasSession('sess-1')).toBe(true);
      expect(router.hasSession('sess-2')).toBe(false);
    });
  });

  // ── Pending external sessions ──────────────────────────────────────

  describe('pending external sessions', () => {
    const pending = {
      sessionId: 'sess-ext',
      transcriptPath: '/a/b.jsonl',
      cwd: '/a',
      sourceIds: ['claude'],
    };

    it('storePending + confirmPending returns the info and removes it', () => {
      router.storePending('sess-ext', pending);
      expect(router.hasPending('sess-ext')).toBe(true);

      const confirmed = router.confirmPending('sess-ext');
      expect(confirmed).toEqual(pending);
      expect(router.hasPending('sess-ext')).toBe(false);
    });

    it('confirmPending returns undefined for unknown sessions', () => {
      expect(router.confirmPending('unknown')).toBeUndefined();
    });

    it('discardPending removes without returning', () => {
      router.storePending('sess-ext', pending);
      router.discardPending('sess-ext');
      expect(router.hasPending('sess-ext')).toBe(false);
    });

    it('a second announcement of the same session keeps both sources and fills missing fields', () => {
      router.storePending('sess-ext', {
        sessionId: 'sess-ext',
        transcriptPath: undefined,
        sessionRef: '/s/one.jsonl',
        cwd: '/work',
        sourceIds: ['herdr'],
      });
      router.storePending('sess-ext', {
        sessionId: 'sess-ext',
        transcriptPath: undefined,
        cwd: '',
        sourceIds: ['omp'],
      });

      expect(router.confirmPending('sess-ext')).toEqual({
        sessionId: 'sess-ext',
        transcriptPath: undefined,
        sessionRef: '/s/one.jsonl',
        cwd: '/work',
        sourceIds: ['herdr', 'omp'],
      });
    });
  });

  // ── Event buffering ────────────────────────────────────────────────

  describe('event buffering', () => {
    const routed = (sessionId: string, kind: 'turnEnd' | 'permissionRequest' = 'turnEnd') => ({
      sourceId: 'claude',
      sessionId,
      event: { kind },
      raw: { session_id: sessionId, hook_event_name: kind },
    });

    it('bufferEvent stores events for later', () => {
      router.bufferEvent(routed('sess-1'));
      expect(router.hasBuffered('sess-1')).toBe(true);
      expect(router.hasBuffered('sess-2')).toBe(false);
    });

    it('register flushes buffered events for that session', () => {
      router.bufferEvent(routed('sess-1', 'turnEnd'));
      router.bufferEvent(routed('sess-1', 'permissionRequest'));

      const flushed = router.register('sess-1', 1);

      expect(flushed.map((r) => r.event.kind)).toEqual(['turnEnd', 'permissionRequest']);
      expect(router.hasBuffered('sess-1')).toBe(false);
    });

    it('register does not flush events for other sessions', () => {
      router.bufferEvent(routed('sess-1'));
      router.bufferEvent(routed('sess-2'));

      const flushed = router.register('sess-1', 1);

      expect(flushed).toHaveLength(1);
      expect(router.hasBuffered('sess-2')).toBe(true);
    });

    it('pruneExpired removes old events', () => {
      router.bufferEvent(routed('sess-old'));
      vi.advanceTimersByTime(6_000); // > HOOK_EVENT_BUFFER_MS (5s)
      router.pruneExpired();
      expect(router.hasBuffered('sess-old')).toBe(false);
    });

    it('preserves recent events during prune', () => {
      router.bufferEvent(routed('sess-new'));
      vi.advanceTimersByTime(1_000); // < HOOK_EVENT_BUFFER_MS
      router.pruneExpired();
      expect(router.hasBuffered('sess-new')).toBe(true);
    });
  });

  // ── Lifecycle ──────────────────────────────────────────────────────

  describe('dispose', () => {
    it('clears all state', () => {
      router.register('sess-1', 1);
      router.storePending('sess-ext', {
        sessionId: 'sess-ext',
        transcriptPath: undefined,
        cwd: '/',
        sourceIds: ['claude'],
      });
      router.bufferEvent({
        sourceId: 'claude',
        sessionId: 'sess-2',
        event: { kind: 'turnEnd' },
        raw: { session_id: 'sess-2', hook_event_name: 'Stop' },
      });

      router.dispose();

      expect(router.resolve('sess-1')).toBeUndefined();
      expect(router.hasPending('sess-ext')).toBe(false);
      expect(router.hasBuffered('sess-2')).toBe(false);
    });
  });
});
