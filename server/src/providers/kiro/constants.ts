/** Kiro-specific constants (each module keeps its own, so one CLI's numbers never drift into another's). */

/** Replaces `~/.kiro` wholesale when set. */
export const KIRO_HOME_ENV_VAR = 'KIRO_HOME';

/** V2 (classic `kiro-cli chat`) transcripts: one flat directory of `<uuid>.jsonl` files, each beside a `.json`
 *  sidecar carrying the session's `cwd`. Relative to the Kiro home directory. */
export const KIRO_V2_SESSIONS_DIR_SEGMENTS = ['sessions', 'cli'] as const;
export const KIRO_V2_TRANSCRIPT_SUFFIX = '.jsonl';
export const KIRO_V2_SIDECAR_SUFFIX = '.json';

/** V3 (`kiro-cli --v3` and the Kiro IDE): one `sess_<uuid>` directory per session, nested under a workspace-hash
 *  directory, holding `messages.jsonl` and a `session.json` sidecar. Two directory levels below `sessions/`
 *  (workspace hash, then `sess_<uuid>`). Relative to the Kiro home directory. */
export const KIRO_V3_SESSIONS_DIR_SEGMENTS = ['sessions'] as const;
export const KIRO_V3_TRANSCRIPT_DEPTH = 2;
export const KIRO_V3_MESSAGES_FILE_NAME = 'messages.jsonl';
export const KIRO_V3_SESSION_SIDECAR_FILE_NAME = 'session.json';

/** Prefix of the id Kiro 3 (`--v3`) self-reports to herdr, and the name of the directory holding its transcript. */
export const KIRO_V3_SESSION_ID_PREFIX = 'sess_';

/** Longest tool label shown before truncation. */
export const KIRO_STATUS_MAX_LENGTH = 60;
/** Longest command or subtask description shown inside a tool label. */
export const KIRO_STATUS_DETAIL_MAX_LENGTH = 50;
