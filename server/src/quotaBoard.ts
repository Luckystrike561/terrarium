/**
 * QuotaBoard: the latest reading of every account quota meter, from whichever module reported it, broadcast to the
 * office as one `quotaUpdate`. It knows no provider: Claude's status line and any quota source module land here alike.
 */

import type { QuotaMeter, QuotaUpdate } from '../../core/src/messages.js';
import type { QuotaReading } from '../../core/src/provider.js';
import { MAX_TIMER_DELAY_MS } from './constants.js';

/** When a reading stops counting as fresh: after the source's expected interval, or when the provider resets the
 *  window it was taken in, whichever comes first. */
export function quotaStaleAt(reading: QuotaReading): number {
  const intervalEnd = reading.observedAt + reading.staleAfterMs;
  return reading.resetsAt === undefined ? intervalEnd : Math.min(intervalEnd, reading.resetsAt);
}

/** Why a reading cannot be shown, or undefined when it can. Sources are third-party parsers of third-party data, so
 *  a NaN or a negative amount is rejected here rather than drawn as a nonsense bean count. */
export function invalidQuotaReadingReason(reading: QuotaReading): string | undefined {
  if (!Number.isFinite(reading.observedAt)) return `observedAt ${reading.observedAt} is not a time`;
  if (!(reading.staleAfterMs > 0) || !Number.isFinite(reading.staleAfterMs)) {
    return `staleAfterMs ${reading.staleAfterMs} is not a positive duration`;
  }
  if (reading.resetsAt !== undefined && !Number.isFinite(reading.resetsAt)) {
    return `resetsAt ${reading.resetsAt} is not a time`;
  }
  const usage = reading.usage;
  if (usage === null) return undefined;
  const usedFraction = usage.usedFraction;
  if (usedFraction !== undefined && !(Number.isFinite(usedFraction) && usedFraction >= 0)) {
    return `usedFraction ${usedFraction} is not a share`;
  }
  if (usage.kind === 'fraction') return undefined;
  if (!Number.isFinite(usage.usedAmount) || usage.usedAmount < 0) {
    return `usedAmount ${usage.usedAmount} is not an amount`;
  }
  if (!Number.isFinite(usage.limitAmount) || usage.limitAmount < 0) {
    return `limitAmount ${usage.limitAmount} is not an amount`;
  }
  return undefined;
}

/** The meter the office shows for one valid reading at time `now`. An amount against a zero limit, with no share of
 *  the provider's own beside it, has no share, so it is shown as unavailable rather than as full. */
export function normalizeQuotaReading(
  providerId: string,
  reading: QuotaReading,
  now: number,
): QuotaMeter {
  const meter: QuotaMeter = {
    id: `${providerId}:${reading.meterId}`,
    providerId,
    label: reading.label,
    observedAt: reading.observedAt,
    stale: now >= quotaStaleAt(reading),
  };
  if (reading.resetsAt !== undefined) meter.resetsAt = reading.resetsAt;
  const usage = reading.usage;
  if (usage?.kind === 'fraction') {
    meter.usedFraction = usage.usedFraction;
  } else if (usage?.kind === 'amount') {
    meter.usedAmount = usage.usedAmount;
    meter.limitAmount = usage.limitAmount;
    meter.unit = usage.unit;
    if (usage.usedFraction !== undefined) {
      meter.usedFraction = usage.usedFraction;
    } else if (usage.limitAmount > 0) {
      meter.usedFraction = usage.usedAmount / usage.limitAmount;
    }
  }
  return meter;
}

export class QuotaBoard {
  private readonly readings = new Map<string, { providerId: string; reading: QuotaReading }>();
  private readonly staleTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly broadcast: (message: QuotaUpdate) => void,
    private readonly now: () => number = Date.now,
  ) {}

  /** Keep `reading` as the latest of its meter and broadcast the board. An invalid reading is logged and dropped,
   *  leaving the previous one in place. */
  report(providerId: string, reading: QuotaReading): void {
    const invalidReason = invalidQuotaReadingReason(reading);
    if (invalidReason !== undefined) {
      console.warn(
        `[Terrarium] Dropped quota reading ${providerId}:${reading.meterId}: ${invalidReason}`,
      );
      return;
    }
    const key = `${providerId}:${reading.meterId}`;
    this.readings.set(key, { providerId, reading });
    this.scheduleStale(key, reading);
    this.broadcast(this.message());
  }

  /** The whole board, as sent on connect and after every change. */
  message(): QuotaUpdate {
    const now = this.now();
    return {
      type: 'quotaUpdate',
      meters: [...this.readings.values()].map(({ providerId, reading }) =>
        normalizeQuotaReading(providerId, reading, now),
      ),
    };
  }

  dispose(): void {
    for (const timer of this.staleTimers.values()) clearTimeout(timer);
    this.staleTimers.clear();
  }

  /** Broadcast again the moment the reading goes stale, so the office greys it out without waiting for a source
   *  that may never report again. The timer can fire before `now()` reaches the stale time (timers run on the
   *  monotonic clock, `now()` on the wall clock, which can also step back), and a delay is capped at
   *  MAX_TIMER_DELAY_MS, so the callback checks the clock and waits again until the reading really is stale. */
  private scheduleStale(key: string, reading: QuotaReading): void {
    clearTimeout(this.staleTimers.get(key));
    this.staleTimers.delete(key);
    const delayMs = quotaStaleAt(reading) - this.now();
    if (delayMs <= 0) return;
    const timer = setTimeout(
      () => {
        this.staleTimers.delete(key);
        if (this.now() < quotaStaleAt(reading)) {
          this.scheduleStale(key, reading);
          return;
        }
        this.broadcast(this.message());
      },
      Math.min(delayMs, MAX_TIMER_DELAY_MS),
    );
    timer.unref();
    this.staleTimers.set(key, timer);
  }
}
