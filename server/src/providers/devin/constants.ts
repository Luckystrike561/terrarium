/** Devin-specific constants (each module keeps its own, so one CLI's numbers never drift into another's). */

/** Devin's product directory name under the OS data root (`~/.local/share/devin`, `%APPDATA%\devin`). */
export const DEVIN_PRODUCT_DIR = 'devin';

/** Devin's central session store, relative to its product directory: a single SQLite file holding every session. */
export const DEVIN_DB_PATH_SEGMENTS = ['cli', 'sessions.db'] as const;

/** Fallback root under the home directory when `$XDG_DATA_HOME` is unset (the XDG default). */
export const DEVIN_XDG_DATA_FALLBACK_SEGMENTS = ['.local', 'share'] as const;

/** Fallback root under the home directory on Windows when `%APPDATA%` is unset. */
export const DEVIN_APPDATA_FALLBACK_SEGMENTS = ['AppData', 'Roaming'] as const;

/** Longest tool label shown before truncation. */
export const DEVIN_STATUS_MAX_LENGTH = 60;
/** Longest command shown inside a tool label. */
export const DEVIN_STATUS_DETAIL_MAX_LENGTH = 50;
