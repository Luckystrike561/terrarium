/** Maki-specific constants (each module keeps its own, so one CLI's numbers never drift into another's). */

/** Maki's session store, relative to the home directory: a flat directory of one `.jsonl` transcript per session,
 *  named by the session's own id. Default XDG state path; Maki names no CLI-specific override env var. */
export const MAKI_SESSIONS_SUBDIR = 'sessions';
export const MAKI_STATE_DIR_SEGMENTS = ['.local', 'state', 'maki', MAKI_SESSIONS_SUBDIR] as const;

/** When this directory exists under the home directory, every Maki directory (config/data/state/logs) lives under
 *  it instead of the XDG locations, so sessions are at `<home>/.maki/sessions`. */
export const MAKI_LEGACY_HOME_DIR = '.maki';

export const MAKI_SESSION_FILE_SUFFIX = '.jsonl';

/** Longest tool label shown before truncation. */
export const MAKI_STATUS_MAX_LENGTH = 60;
/** Longest command or subtask description shown inside a tool label. */
export const MAKI_STATUS_DETAIL_MAX_LENGTH = 50;
