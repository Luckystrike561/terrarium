/** omp-specific constants (each module keeps its own, so one CLI's numbers never drift into another's). */

/** omp's session store, relative to the home directory: one sub-directory per working directory, one `.jsonl`
 *  transcript per session inside it. */
export const OMP_SESSIONS_DIR_SEGMENTS = ['.omp', 'agent', 'sessions'] as const;

export const OMP_SESSION_FILE_SUFFIX = '.jsonl';

/** omp's assistant `stopReason` while a turn continues into tool calls. Any other reason ends the turn. */
export const OMP_STOP_REASON_TOOL_USE = 'toolUse';

/** Longest tool label shown before truncation. */
export const OMP_STATUS_MAX_LENGTH = 60;
/** Longest command or subtask description shown inside a tool label. */
export const OMP_STATUS_DETAIL_MAX_LENGTH = 50;
