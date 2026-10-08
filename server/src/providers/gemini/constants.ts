/** Gemini CLI-specific constants (each module keeps its own, so one CLI's numbers never drift into another's). */

/** Env var that replaces the home directory Gemini CLI resolves all of its state under (`homedir()`). */
export const GEMINI_HOME_ENV_VAR = 'GEMINI_CLI_HOME';

/** Under macOS Seatbelt sandboxing the CLI redirects its runtime state (including sessions) to a cache
 *  subdirectory instead of the home `.gemini`, because the seatbelt profile blocks writes there
 *  (`Storage.getGlobalRuntimeDir`). */
export const GEMINI_SANDBOX_ENV_VAR = 'SANDBOX';
export const GEMINI_SANDBOX_EXEC_VALUE = 'sandbox-exec';

export const GEMINI_DIR_NAME = '.gemini';
export const GEMINI_CACHE_DIR_SEGMENTS = ['.cache', GEMINI_DIR_NAME] as const;

/** Sessions live two directory levels below `<gemini runtime dir>/tmp`: one project-slug directory
 *  (registered in `projects.json`, not derivable from cwd), then a `chats` directory holding one
 *  `.jsonl` transcript per session. Sub-agent transcripts nest one level deeper and are excluded by
 *  this depth, same as the sessions a `task`-like tool starts for omp. */
export const GEMINI_SESSIONS_ROOT_SEGMENTS = ['tmp'] as const;
export const GEMINI_SESSIONS_DEPTH = 2;

/** Marker file dropped beside each project-slug session directory, holding the absolute project path
 *  that slug belongs to (`ProjectRegistry`'s `PROJECT_ROOT_FILE`). The transcript itself never records cwd. */
export const GEMINI_PROJECT_ROOT_MARKER = '.project_root';

export const GEMINI_SESSION_FILE_PREFIX = 'session-';
export const GEMINI_SESSION_FILE_SUFFIX = '.jsonl';

/** Longest tool label shown before truncation. */
export const GEMINI_STATUS_MAX_LENGTH = 60;
/** Longest command, skill name or subtask description shown inside a tool label. */
export const GEMINI_STATUS_DETAIL_MAX_LENGTH = 50;
