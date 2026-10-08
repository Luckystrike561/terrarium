/** OpenCode-specific constants (each module keeps its own, so one CLI's numbers never drift into another's). */

/** Env var naming the data directory OpenCode keeps its SQLite store under (xdg-basedir's XDG_DATA_HOME). Overrides
 *  the default `~/.local/share` on every platform: OpenCode never follows the macOS Application Support convention. */
export const OPENCODE_XDG_DATA_HOME_ENV_VAR = 'XDG_DATA_HOME';

/** Env var naming the database file directly: an absolute path, `:memory:`, or a filename relative to the data
 *  directory. Takes precedence over the default filename. */
export const OPENCODE_DB_ENV_VAR = 'OPENCODE_DB';

/** OpenCode's data directory, relative to XDG_DATA_HOME (or its `~/.local/share` default). */
export const OPENCODE_DATA_DIR_NAME = 'opencode';

/** Default database filename for stable install channels (latest/beta/prod) or OPENCODE_DISABLE_CHANNEL_DB=1. Other
 *  channels suffix the filename with the channel name; that resolution needs the CLI's own installed-channel
 *  marker and isn't reproduced here. */
export const OPENCODE_DB_FILENAME = 'opencode.db';

/** Session table: the 2.0 release renames it to `session_v2`; every build observed so far still uses `session`. */
export const OPENCODE_SESSION_TABLE_V2 = 'session_v2';
export const OPENCODE_SESSION_TABLE_V1 = 'session';

/** Turn storage: 2.0-era builds append one row per turn here; 1.x builds split a turn across `message` + `part`. A
 *  store upgraded from 1.x keeps both table sets, so a session is read from whichever one actually has rows. */
export const OPENCODE_SESSION_MESSAGE_TABLE = 'session_message';
export const OPENCODE_MESSAGE_TABLE = 'message';
export const OPENCODE_PART_TABLE = 'part';

/** Longest tool label shown before truncation. */
export const OPENCODE_STATUS_MAX_LENGTH = 60;
/** Longest command or subtask description shown inside a tool label. */
export const OPENCODE_STATUS_DETAIL_MAX_LENGTH = 50;
