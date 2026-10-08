/** herdr-specific constants, kept separate per module so one module's tuning never touches another's. */

/** herdr's JSON-RPC socket, relative to the home directory. */
export const HERDR_SOCKET_PATH_SEGMENTS = ['.config', 'herdr', 'herdr.sock'] as const;

/** Delay before reconnecting the event socket after herdr closed it or was not running. */
export const HERDR_EVENT_RECONNECT_MS = 5000;

/** How often the agent list is re-read. Status transitions are only visible this way: herdr cannot push them
 *  without one subscription per pane. */
export const HERDR_SNAPSHOT_INTERVAL_MS = 2500;

/** A one-shot RPC that has not answered by then is treated as failed. */
export const HERDR_RPC_TIMEOUT_MS = 6000;

/** `agent_session.kind` for a session herdr names by its transcript path. Any other kind is the CLI's own id. */
export const HERDR_SESSION_KIND_PATH = 'path';
