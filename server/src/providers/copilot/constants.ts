/** Copilot-specific constants (each module keeps its own, so one CLI's numbers never drift into another's). */

/** Copilot's default configuration directory, relative to the home directory. */
export const COPILOT_CONFIG_DIR_SEGMENT = '.copilot';

/** Session store, relative to the configuration directory: one sub-directory per session, named with the
 *  session's own UUID, each holding one `events.jsonl` transcript. */
export const COPILOT_SESSION_STATE_DIR_NAME = 'session-state';

export const COPILOT_EVENTS_FILE_NAME = 'events.jsonl';

/** Overrides Copilot's default `~/.copilot` configuration directory (replaces it outright, not just `$HOME`),
 *  per GitHub's own CLI configuration directory reference. */
export const COPILOT_HOME_ENV_VAR = 'COPILOT_HOME';

/** Copilot's built-in tool for asking the user a question. Its own answer event (`user_input.requested`) is
 *  ephemeral and never reaches `events.jsonl`, so the tool call itself is read as a permission wait instead of
 *  ordinary tool activity. */
export const COPILOT_ASK_USER_TOOL = 'ask_user';

/** Longest tool label shown before truncation. */
export const COPILOT_STATUS_MAX_LENGTH = 60;
/** Longest command or subtask description shown inside a tool label. */
export const COPILOT_STATUS_DETAIL_MAX_LENGTH = 50;
