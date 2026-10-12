// ── Context Window Usage ────────────────────────────────────
/** Window size assumed until a transcript proves otherwise. Transcripts never
 *  state the model's context limit, so this is the floor, not the truth. */
export const DEFAULT_MAX_CONTEXT_TOKENS = 200_000;

// ── Display Truncation + Terrarium Server paths ──────────
// Centralized in core/src/constants.ts; re-exported here for back-compat.
export {
  BASH_COMMAND_DISPLAY_MAX_LENGTH,
  HOOK_API_PREFIX,
  HOOK_SCRIPTS_DIR,
  SERVER_JSON_DIR,
  SERVER_JSON_NAME,
  TASK_DESCRIPTION_DISPLAY_MAX_LENGTH,
} from '../../core/src/constants.js';

// ── Multi-Server Discovery ──────────────────────────────────
/** Subdirectory (under SERVER_JSON_DIR) holding one registry entry per live
 *  server, so a hook event can fan out to every running instance instead of
 *  only the single legacy server.json pointer. See server/src/server.ts. */
export const SERVERS_DIR = 'servers';
/** Valid explicit TCP port range. Port 0 remains an internal-only signal for
 *  OS-assigned ephemeral binding and is never accepted from persisted records
 *  or the CLI's --port option. */
export const MIN_PORT = 1;
export const MAX_PORT = 65_535;
/** Format version stamped on every registry entry (both the per-server records
 * and the legacy server.json). Bump on breaking field changes; additive
 * fields don't require a bump -- readers already tolerate unknown/missing
 * fields (see ServerConfig.debugLog precedent). */
export const SERVER_REGISTRY_PROTOCOL_VERSION = 1;

// ── WebSocket close codes (application range 4000-4999) ────
/** The handshake's Origin is not this server's own origin.
 *  WebSocket connects bypass CORS, so this is the only thing standing between
 *  a drive-by web page and the privileged client-message channel. */
export const WS_CLOSE_FORBIDDEN_ORIGIN = 4003;

export const HOOK_EVENT_BUFFER_MS = 5_000;
export const MAX_HOOK_BODY_SIZE = 65_536; // 64KB

// ── Layout/Config Persistence ──────────────────────────────
export const LAYOUT_FILE_DIR = '.terrarium';
/** The state directory before the rename to Terrarium. Moved to LAYOUT_FILE_DIR on startup. */
export const LEGACY_STATE_DIR = '.pixel-agents';
export const LAYOUT_FILE_NAME = 'layout.json';
export const LAYOUT_REVISION_KEY = 'layoutRevision';
export const CONFIG_FILE_NAME = 'config.json';

// ── Avatar Customization ────────────────────────────────────
/** Inclusive upper bound for a valid agent hue shift, in degrees. Used by
 *  clientMessageHandler to guard saveAgentSeats payloads from a remote or
 *  hand-edited source corrupting the stored values with out-of-range values. */
export const HUE_SHIFT_MAX_DEG = 360;

// ── Multiplexer connections ─────────────────────────────────
/** Id of the connection to this machine's default herdr session, present until the user removes it. */
export const DEFAULT_CONNECTION_ID = 'local';
export const DEFAULT_CONNECTION_LABEL = 'This machine';
/** Random bytes in a generated connection id. Short: the id is part of a forwarded socket's path, which Unix caps
 *  near 104 bytes. */
export const CONNECTION_ID_BYTES = 4;
export const SSH_TARGET_MAX_CHARS = 255;
export const HERDR_SESSION_NAME_MAX_CHARS = 64;

/** The longest delay setTimeout honours: Node fires anything longer after 1 ms. */
export const MAX_TIMER_DELAY_MS = 2_147_483_647;
