/** Bytes read from the start of a transcript to find the working directory it records. */
export const SESSION_HEAD_MAX_BYTES = 64 * 1024;

/** Bytes read from the end of a transcript to infer whether its session is mid-turn, idle or exited. */
export const SESSION_STATE_TAIL_BYTES = 64 * 1024;

/** Cap on bytes read from a transcript in one poll. */
export const SESSION_MAX_READ_BYTES = 2_000_000;

/** How often a session store is rescanned for sessions that started or went quiet. */
export const SESSION_DISCOVERY_INTERVAL_MS = 3000;

/** How often a tracked session is read for new records. */
export const SESSION_POLL_INTERVAL_MS = 1000;

/** A session untouched for this long is no longer discovered as live. Stores that record a clean exit end sessions
 *  sooner. This bounds how long a crashed session lingers. Any new record brings it back. */
export const SESSION_ACTIVE_WINDOW_MS = 30 * 60 * 1000;

/** Default timing for a session store module. */
export const DEFAULT_SESSION_STORE_TIMING = {
  discoveryMs: SESSION_DISCOVERY_INTERVAL_MS,
  pollMs: SESSION_POLL_INTERVAL_MS,
  activeWindowMs: SESSION_ACTIVE_WINDOW_MS,
} as const;
