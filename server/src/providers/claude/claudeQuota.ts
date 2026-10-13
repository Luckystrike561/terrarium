/**
 * Claude's account quotas, from the `rate_limits` Claude Code gives its status line (and our status line forwards):
 * the rolling 5-hour and 7-day windows of a Pro or Max plan, and the spend limit behind a Claude apps gateway.
 */

import type { QuotaReading, QuotaUsage } from '../../../../core/src/provider.js';
import { CLAUDE_QUOTA_STALE_AFTER_MS } from './constants.js';

const MILLISECONDS_PER_SECOND = 1000;
const PERCENT = 100;

/** The windows Claude Code reports, by their `rate_limits` key. */
const CLAUDE_QUOTA_LABELS: Record<string, string> = {
  five_hour: 'Claude · 5h',
  seven_day: 'Claude · week',
  spend_limit: 'Claude · spend',
};

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** A window's usage: its percentage, with dollars against the limit beside it when the gateway reports both. The
 *  share comes from the percentage whenever there is one, since Claude Code refreshes the dollars only about every
 *  five minutes. */
function windowUsage(window: Record<string, unknown>): QuotaUsage | undefined {
  const usedPercentage = finiteNumber(window.used_percentage);
  const usedFraction = usedPercentage === undefined ? undefined : usedPercentage / PERCENT;
  const usedUsd = finiteNumber(window.used_usd);
  const limitUsd = finiteNumber(window.limit_usd);
  if (usedUsd !== undefined && limitUsd !== undefined) {
    return {
      kind: 'amount',
      usedAmount: usedUsd,
      limitAmount: limitUsd,
      unit: 'usd',
      usedFraction,
    };
  }
  return usedFraction === undefined ? undefined : { kind: 'fraction', usedFraction };
}

/** One reading per window `rateLimits` carries. A window missing or without a usage figure is skipped, never read as
 *  zero: the meter keeps its last reading instead. */
export function readClaudeQuota(rateLimits: unknown, observedAt: number): QuotaReading[] {
  if (rateLimits === null || typeof rateLimits !== 'object') return [];
  const windows = rateLimits as Record<string, unknown>;
  const readings: QuotaReading[] = [];
  for (const [meterId, label] of Object.entries(CLAUDE_QUOTA_LABELS)) {
    const window = windows[meterId];
    if (window === null || typeof window !== 'object') continue;
    const fields = window as Record<string, unknown>;
    const usage = windowUsage(fields);
    if (usage === undefined) continue;
    const resetsAtSeconds = finiteNumber(fields.resets_at);
    readings.push({
      meterId,
      label,
      usage,
      resetsAt:
        resetsAtSeconds === undefined ? undefined : resetsAtSeconds * MILLISECONDS_PER_SECOND,
      observedAt,
      staleAfterMs: CLAUDE_QUOTA_STALE_AFTER_MS,
    });
  }
  return readings;
}
