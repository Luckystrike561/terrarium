/** pi-specific constants (each module keeps its own, so one CLI's numbers never drift into another's). */

/** pi's default session store, relative to the home directory: one sub-directory per working directory
 *  (`--<cwd>--`), one `.jsonl` transcript per session inside it. */
export const PI_SESSIONS_DIR_SEGMENTS = ['.pi', 'agent', 'sessions'] as const;

export const PI_SESSION_FILE_SUFFIX = '.jsonl';

/** pi's assistant `stopReason` while a turn continues into tool calls. Any other reason ends the turn. */
export const PI_STOP_REASON_TOOL_USE = 'toolUse';

/** Longest tool label shown before truncation. */
export const PI_STATUS_MAX_LENGTH = 60;
/** Longest command shown inside a tool label. */
export const PI_STATUS_DETAIL_MAX_LENGTH = 50;

/** pi's own env var overrides for where its session store lives (read by pi's own config module). Setting
 *  the session dir drops the per-cwd `--<cwd>--` bucketing: sessions then sit directly in it. */
export const PI_ENV_AGENT_DIR = 'PI_CODING_AGENT_DIR';
export const PI_ENV_SESSION_DIR = 'PI_CODING_AGENT_SESSION_DIR';
