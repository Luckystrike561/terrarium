/** Cursor-specific constants (each module keeps its own, so one CLI's numbers never drift into another's). */

/** Cursor's session store, relative to its config dir (`~/.cursor`, or `CURSOR_CONFIG_DIR` when set): one
 *  sub-directory per project, `agent-transcripts/<uuid>/<uuid>.jsonl` per session inside it. */
export const CURSOR_PROJECTS_DIR_SEGMENTS = ['projects'] as const;

/** Directory levels below the projects root to a transcript file: project slug, `agent-transcripts`, session uuid. */
export const CURSOR_PROJECT_DEPTH = 3;

export const CURSOR_SESSION_FILE_SUFFIX = '.jsonl';

/** Longest tool label shown before truncation. */
export const CURSOR_STATUS_MAX_LENGTH = 60;
/** Longest command, pattern or subtask description shown inside a tool label. */
export const CURSOR_STATUS_DETAIL_MAX_LENGTH = 50;
