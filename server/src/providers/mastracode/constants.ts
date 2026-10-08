/** mastracode-specific constants (each module keeps its own, so one CLI's numbers never drift into another's). */

/** mastracode's app-data directory name, under the platform default or MASTRA_APP_DATA_DIR
 *  (the project module's getAppDataDir()). */
export const MASTRACODE_APP_NAME = 'mastracode';

/** The session database file inside the app-data directory (the project module's getDatabasePath()). */
export const MASTRACODE_DB_FILE_NAME = 'mastra.db';

/** Overrides the database file path directly, highest priority (the project module's getStorageConfig()). */
export const MASTRACODE_DB_PATH_ENV = 'MASTRA_DB_PATH';
/** Overrides the whole app-data directory the database lives under. */
export const MASTRACODE_APP_DATA_DIR_ENV = 'MASTRA_APP_DATA_DIR';
/** Linux: relocates the default `~/.local/share` the app-data directory nests under. */
export const MASTRACODE_XDG_DATA_HOME_ENV = 'XDG_DATA_HOME';
/** Windows: the default app-data root, `%APPDATA%\mastracode`. */
export const MASTRACODE_APPDATA_ENV = 'APPDATA';

export const TABLE_THREADS = 'mastra_threads';
export const TABLE_MESSAGES = 'mastra_messages';

/** Thread metadata key the CLI tags a thread's working directory under (set by the harness's createThread).
 *  Threads created before that change carry no path. */
export const MASTRACODE_PROJECT_PATH_KEY = 'projectPath';

/** Tool invocation states that mean the call has settled (the MastraToolInvocation state machine).
 *  Anything else (call, partial-call, approval-responded) is still open. */
export const MASTRACODE_TOOL_TERMINAL_STATES: Record<string, true> = {
  result: true,
  'output-error': true,
  'output-denied': true,
};
/** State meaning the call is waiting on a human approval. */
export const MASTRACODE_TOOL_APPROVAL_STATE = 'approval-requested';

/** Longest tool label shown before truncation. */
export const MASTRACODE_STATUS_MAX_LENGTH = 60;
/** Longest command, query or subtask description shown inside a tool label. */
export const MASTRACODE_STATUS_DETAIL_MAX_LENGTH = 50;
