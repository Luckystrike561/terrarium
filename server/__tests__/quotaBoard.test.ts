import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { QuotaUpdate } from '../../core/src/messages.js';
import type { QuotaHost, QuotaReading, QuotaSourceModule } from '../../core/src/provider.js';
import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { readClaudeQuota } from '../src/providers/claude/claudeQuota.js';
import { CLAUDE_QUOTA_STALE_AFTER_MS } from '../src/providers/claude/constants.js';
import { normalizeQuotaReading, QuotaBoard } from '../src/quotaBoard.js';

const NOW = 1_800_000_000_000;
const MINUTE_MS = 60_000;

function reading(overrides: Partial<QuotaReading> = {}): QuotaReading {
  return {
    meterId: 'five_hour',
    label: 'Claude · 5h',
    usage: { kind: 'fraction', usedFraction: 0.7 },
    observedAt: NOW,
    staleAfterMs: 15 * MINUTE_MS,
    ...overrides,
  };
}

describe('normalizeQuotaReading', () => {
  it('passes a share through as usedFraction', () => {
    expect(
      normalizeQuotaReading('claude', reading({ resetsAt: NOW + 60 * MINUTE_MS }), NOW),
    ).toEqual({
      id: 'claude:five_hour',
      providerId: 'claude',
      label: 'Claude · 5h',
      usedFraction: 0.7,
      resetsAt: NOW + 60 * MINUTE_MS,
      observedAt: NOW,
      stale: false,
    });
  });

  it('turns an amount against a limit into a share and keeps the amounts', () => {
    const meter = normalizeQuotaReading(
      'ollama',
      reading({
        meterId: 'month',
        usage: { kind: 'amount', usedAmount: 45, limitAmount: 60, unit: 'usd' },
      }),
      NOW,
    );
    expect(meter).toMatchObject({
      usedFraction: 0.75,
      usedAmount: 45,
      limitAmount: 60,
      unit: 'usd',
    });
  });

  it('keeps a share above 1 when the quota is overrun', () => {
    const meter = normalizeQuotaReading(
      'ollama',
      reading({ usage: { kind: 'amount', usedAmount: 66, limitAmount: 60, unit: 'usd' } }),
      NOW,
    );
    expect(meter.usedFraction).toBeCloseTo(1.1);
  });

  it.each([
    ['a source that cannot read the meter', null],
    [
      'an amount against a zero limit',
      { kind: 'amount', usedAmount: 0, limitAmount: 0, unit: 'usd' } as const,
    ],
  ])('has no usedFraction for %s, never 0 or 1', (_label, usage) => {
    expect(normalizeQuotaReading('ollama', reading({ usage }), NOW).usedFraction).toBeUndefined();
  });

  it('is stale once the source interval passed', () => {
    const fresh = reading({ observedAt: NOW - 14 * MINUTE_MS });
    const old = reading({ observedAt: NOW - 15 * MINUTE_MS });
    expect(normalizeQuotaReading('claude', fresh, NOW).stale).toBe(false);
    expect(normalizeQuotaReading('claude', old, NOW).stale).toBe(true);
  });

  it('is stale once the window it was read in has reset, however recent the reading', () => {
    const meter = normalizeQuotaReading('claude', reading({ resetsAt: NOW - 1 }), NOW);
    expect(meter.stale).toBe(true);
  });
});

describe('QuotaBoard', () => {
  let sent: QuotaUpdate[];
  let board: QuotaBoard;

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
    sent = [];
    board = new QuotaBoard((message) => sent.push(message));
  });

  afterEach(() => {
    board.dispose();
    vi.useRealTimers();
  });

  it('lists nothing until a source reports', () => {
    expect(board.message()).toEqual({ type: 'quotaUpdate', meters: [] });
  });

  it('keeps only the latest reading of each meter, per provider', () => {
    board.report('claude', reading({ usage: { kind: 'fraction', usedFraction: 0.2 } }));
    board.report('claude', reading({ usage: { kind: 'fraction', usedFraction: 0.4 } }));
    board.report('other', reading({ usage: { kind: 'fraction', usedFraction: 0.9 } }));

    expect(board.message().meters.map((m) => [m.id, m.usedFraction])).toEqual([
      ['claude:five_hour', 0.4],
      ['other:five_hour', 0.9],
    ]);
    expect(sent).toHaveLength(3);
  });

  it('broadcasts again when a reading goes stale, with nothing new reported', () => {
    board.report('claude', reading());
    expect(sent.at(-1)?.meters[0].stale).toBe(false);

    vi.advanceTimersByTime(15 * MINUTE_MS);

    expect(sent).toHaveLength(2);
    expect(sent.at(-1)?.meters[0].stale).toBe(true);
  });

  it('goes stale at the reset when that comes before the interval ends', () => {
    board.report('claude', reading({ resetsAt: NOW + 5 * MINUTE_MS }));

    vi.advanceTimersByTime(5 * MINUTE_MS);

    expect(sent.at(-1)?.meters[0].stale).toBe(true);
  });

  it('a fresh reading replaces the stale timer of the one before it', () => {
    board.report('claude', reading());
    vi.advanceTimersByTime(10 * MINUTE_MS);
    board.report('claude', reading({ observedAt: NOW + 10 * MINUTE_MS }));

    vi.advanceTimersByTime(10 * MINUTE_MS);

    expect(sent).toHaveLength(2);
    expect(sent.at(-1)?.meters[0].stale).toBe(false);
  });

  it('waits again when the timer fires before the clock reaches the stale time', () => {
    let clockLagMs = 0;
    board.dispose();
    board = new QuotaBoard(
      (message) => sent.push(message),
      () => Date.now() - clockLagMs,
    );
    board.report('claude', reading());
    clockLagMs = 50;

    vi.advanceTimersByTime(15 * MINUTE_MS);
    expect(sent).toHaveLength(1);

    vi.advanceTimersByTime(50);
    expect(sent).toHaveLength(2);
    expect(sent.at(-1)?.meters[0].stale).toBe(true);
  });

  it('goes stale on time when the stale time is further away than a timer can wait', () => {
    const DAY_MS = 24 * 60 * MINUTE_MS;
    board.report('claude', reading({ staleAfterMs: 40 * DAY_MS }));

    vi.advanceTimersByTime(39 * DAY_MS);
    expect(sent).toHaveLength(1);

    vi.advanceTimersByTime(DAY_MS);
    expect(sent).toHaveLength(2);
    expect(sent.at(-1)?.meters[0].stale).toBe(true);
  });

  it.each([
    ['a NaN share', { usage: { kind: 'fraction', usedFraction: Number.NaN } }],
    [
      'a negative amount',
      { usage: { kind: 'amount', usedAmount: -1, limitAmount: 60, unit: 'usd' } },
    ],
    ['no stale interval', { staleAfterMs: 0 }],
    ['an endless stale interval', { staleAfterMs: Number.POSITIVE_INFINITY }],
  ] as const)('drops %s and keeps the reading before it', (_label, overrides) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    board.report('claude', reading());
    board.report('claude', reading(overrides as Partial<QuotaReading>));

    expect(sent).toHaveLength(1);
    expect(board.message().meters[0].usedFraction).toBe(0.7);
  });
});

describe('readClaudeQuota', () => {
  it("reads the 5-hour and 7-day windows exactly as Claude Code's status line reports them", () => {
    const readings = readClaudeQuota(
      {
        five_hour: { used_percentage: 70, resets_at: 1_999_999_999 },
        seven_day: { used_percentage: 25, resets_at: 2_000_500_000 },
      },
      NOW,
    );

    expect(readings).toEqual([
      {
        meterId: 'five_hour',
        label: 'Claude · 5h',
        usage: { kind: 'fraction', usedFraction: 0.7 },
        resetsAt: 1_999_999_999_000,
        observedAt: NOW,
        staleAfterMs: CLAUDE_QUOTA_STALE_AFTER_MS,
      },
      {
        meterId: 'seven_day',
        label: 'Claude · week',
        usage: { kind: 'fraction', usedFraction: 0.25 },
        resetsAt: 2_000_500_000_000,
        observedAt: NOW,
        staleAfterMs: CLAUDE_QUOTA_STALE_AFTER_MS,
      },
    ]);
  });

  it('reads a gateway spend limit in dollars when both amounts are present', () => {
    const [spend] = readClaudeQuota(
      { spend_limit: { used_percentage: 41, used_usd: 20.5, limit_usd: 50, period: 'month' } },
      NOW,
    );
    expect(spend.usage).toEqual({ kind: 'amount', usedAmount: 20.5, limitAmount: 50, unit: 'usd' });
  });

  it.each([
    ['no rate_limits', undefined],
    ['a window without a usage figure', { five_hour: { resets_at: 1_999_999_999 } }],
    ['a non-numeric percentage', { five_hour: { used_percentage: '70' } }],
  ])('reports nothing for %s, never a 0%% reading', (_label, rateLimits) => {
    expect(readClaudeQuota(rateLimits, NOW)).toEqual([]);
  });
});

describe('AgentRuntime -- quota sources', () => {
  let runtime: AgentRuntime | undefined;

  afterEach(() => {
    runtime?.dispose();
    runtime = undefined;
  });

  it('broadcasts what a registered quota source module reports, with no runtime change', () => {
    let host: QuotaHost | undefined;
    const source: QuotaSourceModule = {
      kind: 'quota',
      id: 'fake-cloud',
      displayName: 'Fake Cloud',
      start(quotaHost) {
        host = quotaHost;
        return { stop: () => {} };
      },
    };
    const store = new AgentStateStore();
    const broadcasts: Record<string, unknown>[] = [];
    store.on('broadcast', (message) => broadcasts.push(message));
    runtime = new AgentRuntime(store, { agents: [], multiplexers: [], quotaSources: [source] });

    runtime.startModules();
    host?.reportQuota(
      reading({
        meterId: 'month',
        label: 'Fake Cloud · month',
        usage: { kind: 'amount', usedAmount: 30, limitAmount: 60, unit: 'usd' },
        observedAt: Date.now(),
      }),
    );

    expect(broadcasts).toEqual([
      {
        type: 'quotaUpdate',
        meters: [
          expect.objectContaining({ id: 'fake-cloud:month', usedFraction: 0.5, stale: false }),
        ],
      },
    ]);
    expect(runtime.quota.message().meters).toHaveLength(1);
  });
});
