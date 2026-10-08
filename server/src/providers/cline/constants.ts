/** Cline-specific constants (each module keeps its own, so one CLI's numbers never drift into another's). */

/** Env override for Cline's session data directory. Highest precedence; already the `sessions` directory itself. */
export const CLINE_SESSION_DATA_DIR_ENV = 'CLINE_SESSION_DATA_DIR';
/** Env override for Cline's data directory. `sessions` is appended. Defaults to `~/.cline/data`. */
export const CLINE_DATA_DIR_ENV = 'CLINE_DATA_DIR';
/** Env override for Cline's home directory. `data/sessions` is appended. Defaults to `~/.cline`. */
export const CLINE_DIR_ENV = 'CLINE_DIR';

export const CLINE_HOME_SEGMENT = '.cline';
export const CLINE_DATA_SEGMENT = 'data';
export const CLINE_SESSIONS_SEGMENT = 'sessions';

/** Cline writes one session directory named by the session id, holding `<id>.messages.json` (the transcript,
 *  rewritten whole on every change) and `<id>.json` (the manifest: cwd, status, pid, timestamps). */
export const CLINE_MESSAGES_FILE_SUFFIX = '.messages.json';
export const CLINE_MANIFEST_FILE_SUFFIX = '.json';

/** Manifest `status` values that mean the session will never run again. The non-terminal values are
 *  `idle`, `running`, `pending`. */
export const CLINE_TERMINAL_STATUSES: Record<string, true> = {
  completed: true,
  failed: true,
  cancelled: true,
};

/** Longest tool label shown before truncation. */
export const CLINE_STATUS_MAX_LENGTH = 60;
/** Longest command, question or subtask description shown inside a tool label. */
export const CLINE_STATUS_DETAIL_MAX_LENGTH = 50;
