/** Hermes-specific constants (each module keeps its own, so one CLI's numbers never drift into another's). */

/** Hermes' whole home directory is itself overridable, unlike a fixed `~/.hermes` subdir layout: this env var
 *  wins over the platform default. */
export const HERMES_HOME_ENV_VAR = 'HERMES_HOME';

/** Default home directory name under the user's home, when `$HERMES_HOME` is unset. */
export const HERMES_HOME_DIR_UNIX = '.hermes';
/** Windows default lives under `%LOCALAPPDATA%`, with no leading dot. */
export const HERMES_HOME_DIR_WINDOWS = 'hermes';

/** Hermes' single SQLite session store, relative to its home directory. */
export const HERMES_STATE_DB_FILENAME = 'state.db';

/** `finish_reason` values `hermes_state_sessions.classify_session_status` treats as a turn that ended in error,
 *  the same lifecycle outcome as a clean completion for our purposes: idle, not mid-turn. */
export const HERMES_ERROR_FINISH_REASONS: Record<string, true> = {
  error: true,
  agent_error: true,
  content_filter: true,
};

/** Longest tool label shown before truncation. */
export const HERMES_STATUS_MAX_LENGTH = 60;
/** Longest command or subtask description shown inside a tool label. */
export const HERMES_STATUS_DETAIL_MAX_LENGTH = 50;
