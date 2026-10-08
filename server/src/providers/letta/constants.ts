/** letta-specific constants (each module keeps its own, so one CLI's numbers never drift into another's). */

/** Overrides the local backend's root directory, read by Letta Code itself. */
export const LETTA_LOCAL_BACKEND_DIR_ENV = 'LETTA_LOCAL_BACKEND_DIR';

/** The local backend's root, relative to the home directory, when `LETTA_LOCAL_BACKEND_DIR` is unset. */
export const LETTA_LOCAL_BACKEND_DIR_SEGMENTS = ['.letta', 'lc-local-backend'] as const;

/** Every conversation's transcript directory sits directly under this one, keyed by its own
 *  base64url-encoded conversation key. */
export const LETTA_CONVERSATIONS_DIR_SEGMENT = 'conversations';

export const LETTA_SESSION_FILE_NAME = 'messages.jsonl';

/** Sibling file to `messages.jsonl` in each conversation directory: Letta Code's `StoredConversation` record. */
export const LETTA_CONVERSATION_RECORD_FILE_NAME = 'conversation.json';

/** Set `true` only on a conversation Letta Code created for a `Task`-spawned sub-agent
 *  (`createLocalConversationRecord` in Letta Code's local store). Absent on every ordinary conversation. */
export const LETTA_SUBAGENT_RECORD_FIELD = 'is_subagent';

/** Prefix on a non-default conversation's directory key (`conversationKey(conversationId, agentId)`
 *  in Letta Code's local store). A default conversation's key has no prefix: `default:<agentId>`. */
export const LETTA_CONVERSATION_KEY_PREFIX = 'conversation:';

/** Letta Code's assistant `stopReason` while a turn continues into tool calls. Any other reason ends the turn. */
export const LETTA_STOP_REASON_TOOL_USE = 'toolUse';

/** Longest tool label shown before truncation. */
export const LETTA_STATUS_MAX_LENGTH = 60;
/** Longest command or subtask description shown inside a tool label. */
export const LETTA_STATUS_DETAIL_MAX_LENGTH = 50;
