/** Qwen Code-specific constants (each module keeps its own, so one CLI's numbers never drift into another's). */

/** Env var overriding the runtime base directory outright (highest-priority override this module honors). */
export const QWEN_RUNTIME_DIR_ENV = 'QWEN_RUNTIME_DIR';

/** Env var overriding Qwen Code's home directory (`~/.qwen` by default). */
export const QWEN_HOME_ENV = 'QWEN_HOME';

/** Qwen Code's home directory, relative to the user's home, when neither env var above is set. */
export const QWEN_DEFAULT_HOME_DIR = '.qwen';

/** Transcripts live at `<runtimeBaseDir>/projects/<sanitized-cwd>/chats/<sessionId>.jsonl`: two directory levels
 *  (the sanitized-cwd directory, then `chats`) below the `projects` root. */
export const QWEN_PROJECTS_DIR_SEGMENT = 'projects';
export const QWEN_PROJECTS_DEPTH = 2;

export const QWEN_SESSION_FILE_SUFFIX = '.jsonl';

/** Longest tool label shown before truncation. */
export const QWEN_STATUS_MAX_LENGTH = 60;
/** Longest command or subtask description shown inside a tool label. */
export const QWEN_STATUS_DETAIL_MAX_LENGTH = 50;

/** `type: 'user'` subtypes that are not a real prompt (side-channel/system messages, not something the model is
 *  asked to act on): `isUserPromptRecord` only treats a subtype-less record with text as a real prompt. */
export const QWEN_NON_PROMPT_USER_SUBTYPES: Record<string, true> = {
  realtime_message: true,
  agent_mention: true,
  agent_message: true,
  notification: true,
  goal_runtime: true,
  cron: true,
  mid_turn_user_message: true,
};
