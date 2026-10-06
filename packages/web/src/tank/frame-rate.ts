/** Frames slower than this (about 45 fps) count as falling behind. */
const SLOW_FRAME_MS = 22;
/** Longer gaps are a hidden tab or a debugger pause, not load. */
const IGNORE_FRAME_MS = 250;
const SLOW_FOR_MS = 2_000;
const FIRST_RETRY_MS = 20_000;
const MAX_RETRY_MS = 5 * 60_000;
const SMOOTHING = 0.1;

export const FULL_FPS = 60;
export const FALLBACK_FPS = 30;

/**
 * Drops the ticker to 30 fps once the smoothed frame time stays above
 * `SLOW_FRAME_MS` for two seconds. While capped there is no headroom signal,
 * so it periodically retries full speed, backing off each time it falls
 * behind again.
 */
export class FrameGovernor {
	#average = 1000 / FULL_FPS;
	#slowSince: number | null = null;
	#capped = false;
	#retryAt = 0;
	#retryMs = FIRST_RETRY_MS;

	get capped(): boolean {
		return this.#capped;
	}

	/** Returns the fps limit to apply when it changes, otherwise null. */
	sample(frameMs: number, now: number): number | null {
		if (this.#capped) {
			if (now < this.#retryAt) return null;
			this.#capped = false;
			this.#average = 1000 / FULL_FPS;
			this.#slowSince = null;
			return FULL_FPS;
		}
		if (frameMs > IGNORE_FRAME_MS) return null;
		this.#average += (frameMs - this.#average) * SMOOTHING;
		if (this.#average <= SLOW_FRAME_MS) {
			this.#slowSince = null;
			return null;
		}
		this.#slowSince ??= now;
		if (now - this.#slowSince < SLOW_FOR_MS) return null;
		this.#capped = true;
		this.#retryAt = now + this.#retryMs;
		this.#retryMs = Math.min(this.#retryMs * 2, MAX_RETRY_MS);
		return FALLBACK_FPS;
	}
}
