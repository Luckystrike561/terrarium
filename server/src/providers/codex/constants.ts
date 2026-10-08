/** Codex-specific constants (each module keeps its own, so one CLI's numbers never drift into another's). */

/** Override for Codex's home directory; unset or empty falls back to `~/.codex`
 *  (Codex treats an empty value the same as unset). */
export const CODEX_HOME_ENV_VAR = 'CODEX_HOME';

/** Codex's session store, relative to its home directory: date-partitioned (YYYY/MM/DD), one `.jsonl` rollout per
 *  session inside the day directory. */
export const CODEX_SESSIONS_DIR_SEGMENTS = ['sessions'] as const;

/** Directory levels (YYYY/MM/DD) between the sessions root and a rollout file. */
export const CODEX_SESSIONS_DIR_DEPTH = 3;

export const CODEX_SESSION_FILE_SUFFIX = '.jsonl';

/** Codex's `event_msg` tags that frame a turn. Always persisted regardless of history mode: Codex never filters
 *  these two event types out. */
export const CODEX_EVENT_TASK_STARTED = 'task_started';
export const CODEX_EVENT_TASK_COMPLETE = 'task_complete';

/** Codex's `response_item` tags for a user prompt, tool calls and their results, internally tagged by `type`. */
export const CODEX_ITEM_MESSAGE = 'message';
export const CODEX_ITEM_FUNCTION_CALL = 'function_call';
export const CODEX_ITEM_CUSTOM_TOOL_CALL = 'custom_tool_call';
export const CODEX_ITEM_FUNCTION_CALL_OUTPUT = 'function_call_output';
export const CODEX_ITEM_CUSTOM_TOOL_CALL_OUTPUT = 'custom_tool_call_output';

/** Codex's built-in tool names. `exec_command` and `apply_patch` take a function/freeform call each;
 *  `apply_patch` is freeform so its call carries raw patch text, not JSON. */
export const CODEX_TOOL_EXEC_COMMAND = 'exec_command';
export const CODEX_TOOL_APPLY_PATCH = 'apply_patch';
export const CODEX_TOOL_UPDATE_PLAN = 'update_plan';

/** Longest tool label shown before truncation. */
export const CODEX_STATUS_MAX_LENGTH = 60;
/** Longest command shown inside a tool label. */
export const CODEX_STATUS_DETAIL_MAX_LENGTH = 50;
