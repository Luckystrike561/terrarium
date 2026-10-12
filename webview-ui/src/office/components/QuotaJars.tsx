import { useEffect, useState } from 'react';

import type { QuotaMeter } from '../../../../core/src/messages.js';
import {
  QUOTA_BEAN_COLOR,
  QUOTA_BEAN_EPSILON,
  QUOTA_BEAN_LOW_COLOR,
  QUOTA_BEAN_SEAM_COLOR,
  QUOTA_BEANS_PER_JAR,
  QUOTA_JAR_EMPTY_BORDER_COLOR,
  QUOTA_JAR_GLASS_COLOR,
  QUOTA_JARS_FALLBACK_OFFSET_PX,
  QUOTA_JARS_RISE_PX,
  QUOTA_LOW_BEANS,
} from '../../constants.js';
import type { OfficeState } from '../engine/officeState.js';
import { overlayProjection } from '../projection.js';
import { TILE_SIZE } from '../types.js';

const COFFEE_MACHINE_TYPE_PREFIX = 'COFFEE_MACHINE';
const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const PERCENT = 100;
const BEAN_COLUMNS = 2;

interface QuotaJarsProps {
  officeState: OfficeState;
  meters: QuotaMeter[];
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  panRef: React.RefObject<{ x: number; y: number }>;
}

/** Beans left in a jar: every started tenth of the quota still unused is a bean, so 70% used is 3 beans and 100% or
 *  more is none. */
function beansLeft(usedFraction: number): number {
  const beans = Math.ceil(QUOTA_BEANS_PER_JAR * (1 - usedFraction) - QUOTA_BEAN_EPSILON);
  return Math.min(QUOTA_BEANS_PER_JAR, Math.max(0, beans));
}

/** `2d 3h`, `3h 12m`, `12m`, for the time until a reset. */
function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / MS_PER_MINUTE));
  const days = Math.floor(totalMinutes / (MINUTES_PER_HOUR * HOURS_PER_DAY));
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR) % HOURS_PER_DAY;
  const minutes = totalMinutes % MINUTES_PER_HOUR;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function usageText(meter: QuotaMeter): string {
  if (meter.usedFraction === undefined) return 'Unavailable';
  const roundedPercent = Math.round(meter.usedFraction * PERCENT);
  const percent = `${meter.usedFraction < 1 ? Math.min(roundedPercent, PERCENT - 1) : roundedPercent}% used`;
  if (meter.usedAmount === undefined || meter.limitAmount === undefined) return percent;
  const amount = (value: number): string =>
    meter.unit === 'usd'
      ? `$${value.toFixed(2)}`
      : `${Math.round(value)} ${meter.unit ?? ''}`.trim();
  return `${amount(meter.usedAmount)} of ${amount(meter.limitAmount)} (${percent})`;
}

function resetText(meter: QuotaMeter, now: number): string {
  if (meter.resetsAt === undefined) return 'Reset time unknown';
  if (meter.resetsAt <= now) return 'Reset since this reading';
  return `Resets in ${formatDuration(meter.resetsAt - now)}`;
}

function freshnessText(meter: QuotaMeter, now: number): string {
  const age = formatDuration(now - meter.observedAt);
  return meter.stale ? `Stale: last reading ${age} ago` : `Updated ${age} ago`;
}

function Bean({ isLow }: { isLow: boolean }) {
  return (
    <div
      data-testid="quota-bean"
      style={{
        width: 8,
        height: 6,
        background: isLow ? QUOTA_BEAN_LOW_COLOR : QUOTA_BEAN_COLOR,
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      <div style={{ width: 1, height: '100%', background: QUOTA_BEAN_SEAM_COLOR }} />
    </div>
  );
}

function Jar({ meter, now }: { meter: QuotaMeter; now: number }) {
  const [isHovered, setIsHovered] = useState(false);
  const isUnavailable = meter.usedFraction === undefined;
  const beans = isUnavailable ? 0 : beansLeft(meter.usedFraction ?? 0);
  const isEmpty = !isUnavailable && (meter.usedFraction ?? 0) >= 1;
  const isLow = beans <= QUOTA_LOW_BEANS;

  return (
    <div
      className="relative flex flex-col items-center"
      style={{ pointerEvents: 'auto' }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      data-testid="quota-jar"
      data-meter-id={meter.id}
      data-beans={beans}
      data-stale={meter.stale}
      data-empty={isEmpty}
      data-unavailable={isUnavailable}
      aria-label={`${meter.label}: ${usageText(meter)}`}
    >
      {isHovered && (
        <div
          className="absolute bottom-full mb-4 px-8 py-4 paper-tag whitespace-nowrap flex flex-col gap-2 text-xs leading-none"
          style={{ zIndex: 43 }}
          data-testid="quota-tooltip"
        >
          <span className="text-sm">{meter.label}</span>
          <span>{usageText(meter)}</span>
          <span>{resetText(meter, now)}</span>
          <span>{freshnessText(meter, now)}</span>
        </div>
      )}
      <div className="bg-ink" style={{ width: 18, height: 4, opacity: meter.stale ? 0.5 : 1 }} />
      <div
        className="grid content-end justify-center gap-1 p-2 border-2 border-ink"
        style={{
          gridTemplateColumns: `repeat(${BEAN_COLUMNS}, auto)`,
          width: 26,
          height: 40,
          background: QUOTA_JAR_GLASS_COLOR,
          borderColor: isEmpty ? QUOTA_JAR_EMPTY_BORDER_COLOR : undefined,
          borderStyle: isUnavailable ? 'dashed' : 'solid',
          opacity: meter.stale ? 0.5 : 1,
          filter: meter.stale ? 'grayscale(1)' : undefined,
        }}
      >
        {Array.from({ length: beans }, (_, i) => (
          <Bean key={i} isLow={isLow} />
        ))}
      </div>
      {(isEmpty || isUnavailable) && (
        <span
          className="absolute top-8 text-sm leading-none"
          style={{ color: isEmpty ? QUOTA_JAR_EMPTY_BORDER_COLOR : undefined }}
        >
          {isEmpty ? '!' : '?'}
        </span>
      )}
    </div>
  );
}

/** The office's account quotas as coffee-bean jars on the break-room coffee machine: one jar per meter, one bean per
 *  tenth of the quota left. Hovering a jar shows the exact numbers. Nothing is drawn while no source reports. */
export function QuotaJars({ officeState, meters, containerRef, zoom, panRef }: QuotaJarsProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (meters.length === 0) return;
    let rafId = 0;
    const tick = () => {
      setNow(Date.now());
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [meters.length]);

  const el = containerRef.current;
  if (meters.length === 0 || !el) return null;

  const layout = officeState.getLayout();
  const machine = layout.furniture.find((f) => f.type.startsWith(COFFEE_MACHINE_TYPE_PREFIX));
  const anchor = machine
    ? overlayProjection(
        layout,
        el.getBoundingClientRect(),
        zoom,
        panRef.current,
        window.devicePixelRatio || 1,
      ).project(
        (machine.col + 0.5) * TILE_SIZE,
        (machine.row + 0.5) * TILE_SIZE,
        QUOTA_JARS_RISE_PX,
      )
    : undefined;

  return (
    <div
      className="absolute flex items-end gap-4"
      style={{
        pointerEvents: 'none',
        zIndex: 40,
        ...(anchor
          ? { left: anchor.x, top: anchor.y, transform: 'translate(-50%, -100%)' }
          : { left: QUOTA_JARS_FALLBACK_OFFSET_PX, top: QUOTA_JARS_FALLBACK_OFFSET_PX }),
      }}
      data-testid="quota-jars"
    >
      {meters.map((meter) => (
        <Jar key={meter.id} meter={meter} now={now} />
      ))}
    </div>
  );
}
