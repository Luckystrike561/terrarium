/** agy (Antigravity CLI)-specific constants (each module keeps its own, so one CLI's numbers never drift into
 *  another's). */

/** Antigravity's session store, relative to the home directory: one sub-directory per conversation inside
 *  `brain/`, with the transcript three directory levels further in (`<uuid>/.system_generated/logs/`). No
 *  documented env var overrides this root (herdr's `ANTIGRAVITY_CLI_CONFIG_DIR` points at a separate config
 *  directory, not the session store). */
export const AGY_BRAIN_DIR_SEGMENTS = ['.gemini', 'antigravity-cli', 'brain'] as const;

export const AGY_SESSION_DEPTH = 3;

/** Antigravity keeps two transcripts per conversation: a rolling `transcript.jsonl` and a nominally complete
 *  `transcript_full.jsonl`. Both are truncated on CHECKPOINT compaction, so neither is a guaranteed-complete
 *  history, but this module only ever reads forward from wherever a session was opened and never replays, so
 *  completeness of the backlog does not matter here. Tracking the `_full` file keeps one conversation = one
 *  tracked file (the `.jsonl` twin would otherwise register as a second session for the same conversation id). */
export const AGY_TRANSCRIPT_FILE_NAME = 'transcript_full.jsonl';

/** `history.jsonl`, sibling of `brain/`: the only local store that maps a conversation id back to the workspace
 *  it ran in. Antigravity's transcript records never carry a working directory. */
export const AGY_HISTORY_FILE_SEGMENTS = ['.gemini', 'antigravity-cli', 'history.jsonl'];

export const AGY_SOURCE_USER_EXPLICIT = 'USER_EXPLICIT';
export const AGY_TYPE_USER_INPUT = 'USER_INPUT';
export const AGY_TYPE_PLANNER_RESPONSE = 'PLANNER_RESPONSE';

/** Longest tool label shown before truncation. */
export const AGY_STATUS_MAX_LENGTH = 60;
/** Longest command or tool-name shown inside a tool label. */
export const AGY_STATUS_DETAIL_MAX_LENGTH = 50;
