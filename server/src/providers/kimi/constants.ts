/** Kimi Code CLI constants (each module keeps its own, so one CLI's numbers never drift into another's). */

/** Overrides the CLI's data directory, moving config, sessions, logs and credentials with it. */
export const KIMI_CODE_HOME_ENV = 'KIMI_CODE_HOME';

/** Default data directory, relative to the home directory, when `KIMI_CODE_HOME_ENV` is unset. */
export const KIMI_DEFAULT_HOME_DIR_NAME = '.kimi-code';

/** Sessions live under `<home>/sessions/<workDirKey>/<sessionId>/agents/<agentId>/wire.jsonl`: one subdirectory per
 *  working directory, one per session inside it, one per agent inside that (`main` for the session itself, a
 *  sub-agent id for everything else). Sibling `imported_sessions/` is deliberately not scanned: those are copies
 *  of sessions started elsewhere, not live ones. */
export const KIMI_SESSIONS_DIR_NAME = 'sessions';

/** Directory levels below `sessions/` a transcript sits at: workDirKey / sessionId / agents / <agentId>. */
export const KIMI_SESSIONS_DEPTH = 4;

/** Per-session metadata document, holding `cwd` among other fields. The transcript itself never records it. */
export const KIMI_STATE_FILE_NAME = 'state.json';

/** The session's own transcript file name. */
export const KIMI_WIRE_FILE_NAME = 'wire.jsonl';

/** The agent id, inside a session's `agents/` directory, that is the session itself. Every other id is a
 *  sub-agent's own log and is never read. */
export const KIMI_MAIN_AGENT_DIR_NAME = 'main';

/** `step.end.finishReason` while a turn continues into another step. Any other reason ends the turn. */
export const KIMI_STOP_REASON_TOOL_USE = 'tool_use';

/** Longest tool label shown before truncation. */
export const KIMI_STATUS_MAX_LENGTH = 60;
/** Longest command or subtask description shown inside a tool label. */
export const KIMI_STATUS_DETAIL_MAX_LENGTH = 50;
