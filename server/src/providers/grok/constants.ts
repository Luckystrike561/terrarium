/** Grok CLI-specific constants (each module keeps its own, so one CLI's numbers never drift into another's). */

/** Env var overriding grok's home directory. Defaults to `~/.grok` when unset. */
export const GROK_HOME_ENV_VAR = 'GROK_HOME';

/** grok's session store, relative to its home directory: one sub-directory per percent-encoded working directory,
 *  one sub-directory per session inside it, holding `updates.jsonl` as the append-only stream of record. */
export const GROK_SESSIONS_DIR_SEGMENTS = ['sessions'] as const;

export const GROK_TRANSCRIPT_FILE_NAME = 'updates.jsonl';
/** Sibling file holding session metadata, including the recorded cwd (`info.cwd`). The transcript itself never
 *  carries cwd. */
export const GROK_SUMMARY_FILE_NAME = 'summary.json';
/** Sidecar written beside a session's cwd bucket only when its percent-encoded name would exceed 255 bytes. Holds
 *  the real cwd as a fallback when `summary.json` is missing or unreadable. */
export const GROK_CWD_SIDECAR_FILE_NAME = '.cwd';

/** ACP `sessionUpdate` kinds that move a character. */
export const GROK_UPDATE_USER_MESSAGE_CHUNK = 'user_message_chunk';
export const GROK_UPDATE_TOOL_CALL = 'tool_call';
export const GROK_UPDATE_TOOL_CALL_UPDATE = 'tool_call_update';
export const GROK_UPDATE_TURN_COMPLETED = 'turn_completed';

/** Terminal `tool_call_update.status` values. A status-less `tool_call_update` is an enrichment, not a result. */
export const GROK_TOOL_STATUS_COMPLETED = 'completed';
export const GROK_TOOL_STATUS_FAILED = 'failed';

/** `_meta` key under a `tool_call` update's own `_meta` holding the model-facing tool name. */
export const GROK_TOOL_META_KEY = 'x.ai/tool';

/** Longest tool label shown before truncation. */
export const GROK_STATUS_MAX_LENGTH = 60;
/** Longest command or subtask description shown inside a tool label. */
export const GROK_STATUS_DETAIL_MAX_LENGTH = 50;
