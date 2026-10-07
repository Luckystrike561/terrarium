/** omp-specific constants (see `providers/claude/constants.ts` for why each module keeps its own). */

/** omp's session store, relative to the home directory: one sub-directory per working directory, one `.jsonl`
 *  transcript per session inside it. */
export const OMP_SESSIONS_DIR_SEGMENTS = ['.omp', 'agent', 'sessions'] as const;

export const OMP_SESSION_FILE_SUFFIX = '.jsonl';

/** How often the session store is rescanned for sessions that started or went quiet. */
export const OMP_DISCOVERY_INTERVAL_MS = 3000;

/** How often a tracked transcript is polled for appended records. */
export const OMP_TAIL_POLL_MS = 1000;

/** A transcript untouched for this long is no longer discovered as a live session. omp records `session_exit` on a
 *  clean shutdown; this bounds how long a crashed session lingers. Any new record brings it back. */
export const OMP_SESSION_ACTIVE_WINDOW_MS = 30 * 60 * 1000;

/** Bytes read from the end of a transcript to infer whether its session is mid-turn or has exited. */
export const OMP_STATE_TAIL_BYTES = 64 * 1024;

/** Bytes read from the start of a transcript to find its `session` header (the working directory). */
export const OMP_HEADER_MAX_BYTES = 64 * 1024;

/** Cap on bytes read from a transcript in one poll. */
export const OMP_MAX_READ_BYTES = 2_000_000;

/** omp's assistant `stopReason` while a turn continues into tool calls; any other reason ends the turn. */
export const OMP_STOP_REASON_TOOL_USE = 'toolUse';

/** Longest tool label shown before truncation. */
export const OMP_STATUS_MAX_LENGTH = 60;
/** Longest command or subtask description shown inside a tool label. */
export const OMP_STATUS_DETAIL_MAX_LENGTH = 50;
