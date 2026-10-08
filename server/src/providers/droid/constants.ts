/** Droid-specific constants (each module keeps its own, so one CLI's numbers never drift into another's). */

/** Droid's session store, relative to the home directory: one sub-directory per project (a flattened cwd), one
 *  `.jsonl` transcript per session inside it, named by the session's own id. */
export const DROID_SESSIONS_DIR_SEGMENTS = ['.factory', 'sessions'] as const;

export const DROID_SESSION_FILE_SUFFIX = '.jsonl';

/** Droid's own override for its home directory (replaces the home directory itself; `.factory` is still appended). */
export const DROID_HOME_OVERRIDE_ENV = 'FACTORY_HOME_OVERRIDE';

/** Longest tool label shown before truncation. */
export const DROID_STATUS_MAX_LENGTH = 60;
/** Longest command or subtask description shown inside a tool label. */
export const DROID_STATUS_DETAIL_MAX_LENGTH = 50;
