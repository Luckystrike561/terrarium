/** herdr-specific constants, kept separate per module so one module's tuning never touches another's. */

/** herdr's config directory, relative to the home directory. Its sockets live here. */
export const HERDR_CONFIG_DIR_SEGMENTS = ['.config', 'herdr'] as const;

/** Named sessions keep their socket at `<config dir>/sessions/<name>/herdr.sock`. */
export const HERDR_SESSIONS_DIR = 'sessions';

export const HERDR_SOCKET_FILE = 'herdr.sock';

/** herdr's own overrides, read in its resolution order after an explicit session name. */
export const HERDR_SOCKET_PATH_ENV = 'HERDR_SOCKET_PATH';
export const HERDR_SESSION_ENV = 'HERDR_SESSION';

/** Delay before reconnecting the event socket after herdr closed it or was not running. */
export const HERDR_EVENT_RECONNECT_MS = 5000;

/** How often the agent list is re-read. Status transitions are only visible this way: herdr cannot push them
 *  without one subscription per pane. */
export const HERDR_SNAPSHOT_INTERVAL_MS = 2500;

/** A one-shot RPC that has not answered by then is treated as failed. */
export const HERDR_RPC_TIMEOUT_MS = 6000;

/** `agent_session.kind` for a session herdr names by its transcript path. Any other kind is the CLI's own id. */
export const HERDR_SESSION_KIND_PATH = 'path';

/** How much of an unparseable herdr reply an error message quotes. */
export const HERDR_REPLY_EXCERPT_CHARS = 80;

/** The OpenSSH client the SSH transport runs, resolved through PATH. */
export const SSH_COMMAND = 'ssh';

/** How long the remote socket lookup (one SSH round-trip) may take, connection setup included. */
export const SSH_RESOLVE_TIMEOUT_MS = 20_000;

/** Options every SSH invocation carries. BatchMode: no TTY to answer a password or host-key prompt, so authentication
 *  is the SSH agent, keys and `~/.ssh/config`, and an unknown host key fails with OpenSSH's own message.
 *  ControlPath none: a shared master from ssh_config would own the forward and outlive the `ssh` we kill, and it skips
 *  a forward it already holds without binding it again, so the next set-up never sees its socket. ControlMaster no on
 *  its own still joins an existing master. No agent or X11 forwarding: the target comes from a browser, not from the
 *  user's shell. */
export const SSH_BASE_OPTIONS = [
  '-T',
  '-o',
  'BatchMode=yes',
  '-o',
  'ControlMaster=no',
  '-o',
  'ControlPath=none',
  '-o',
  'ForwardAgent=no',
  '-o',
  'ForwardX11=no',
  '-o',
  'ConnectTimeout=10',
  '-o',
  'ServerAliveInterval=15',
  '-o',
  'ServerAliveCountMax=3',
] as const;

/** How long a started forward may take to bind its local socket before it counts as failed. */
export const SSH_FORWARD_READY_TIMEOUT_MS = 15_000;

/** How often the local end of a starting forward is checked for. */
export const SSH_FORWARD_READY_POLL_MS = 100;

/** Delay before an SSH connection whose `ssh` exited is set up again. */
export const SSH_RESTART_DELAY_MS = 5000;

/** Forwarded sockets live here, relative to the home directory, one per connection. */
export const SSH_FORWARD_DIR_SEGMENTS = ['.pixel-agents', 'herdr'] as const;

/** Owner-only: a forwarded socket is the remote herdr's full control API. */
export const SSH_FORWARD_DIR_MODE = 0o700;

/** Lines of `ssh` stderr kept to explain a failure. */
export const SSH_STDERR_LINES_KEPT = 5;
