/** Kilo-specific constants (each module keeps its own, so one CLI's numbers never drift into another's). */

/** Kilo's session database file, inside its data directory. */
export const KILO_DB_FILENAME = 'kilo.db';

/** Kilo's data directory name, under XDG data home (or `~/.local/share` when unset). */
export const KILO_DATA_DIR_NAME = 'kilo';

/** Overrides the database file: an absolute path used as-is, a relative path resolved under the data directory,
 *  or the literal `:memory:`. */
export const KILO_DB_ENV_VAR = 'KILO_DB';

/** Moves Kilo's data directory, like every XDG-aware CLI. */
export const XDG_DATA_HOME_ENV_VAR = 'XDG_DATA_HOME';
