/** qodercli-specific constants (each module keeps its own, so one CLI's numbers never drift into another's). */

/** Overrides Qoder's config directory. Default is `~/.qoder`. */
export const QODER_CONFIG_DIR_ENV = 'QODER_CONFIG_DIR';

/** Qoder's config directory, relative to the home directory, when `QODER_CONFIG_DIR_ENV` is unset. */
export const QODER_DEFAULT_CONFIG_DIR_SEGMENTS = ['.qoder'] as const;

/** Qoder's session store, relative to its config directory: one sub-directory per project (cwd-derived slug), one
 *  `.jsonl` transcript per session inside it. Sub-agent transcripts live one level deeper, under
 *  `<session-id>/subagents/`, so the store's depth of 1 never reaches them. */
export const QODER_PROJECTS_DIR_SEGMENT = 'projects';

export const QODER_SESSION_FILE_SUFFIX = '.jsonl';

/** Qoder's assistant `message.stop_reason` once a turn is fully answered. Any other reason (e.g. `tool_use`, or
 *  `null` mid-response) means the turn continues. */
export const QODER_STOP_REASON_END_TURN = 'end_turn';

/** Longest tool label shown before truncation. */
export const QODER_STATUS_MAX_LENGTH = 60;
/** Longest command or description shown inside a tool label. */
export const QODER_STATUS_DETAIL_MAX_LENGTH = 50;
