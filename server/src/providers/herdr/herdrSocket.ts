import * as path from 'node:path';

import {
  HERDR_CONFIG_DIR_SEGMENTS,
  HERDR_SESSION_ENV,
  HERDR_SESSIONS_DIR,
  HERDR_SOCKET_FILE,
  HERDR_SOCKET_PATH_ENV,
} from './constants.js';

export interface HerdrSocketLookup {
  /** Explicit session name, the equivalent of `herdr --session <name>`. */
  readonly session?: string;
  /** Home directory of the machine herdr runs on. */
  readonly home: string;
  /** Environment of that machine, for herdr's own overrides. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Path flavour of that machine. A remote herdr is always on a POSIX host. */
  readonly paths: Pick<typeof path, 'join'>;
}

/** The socket a herdr client would use, resolved in herdr's order: an explicit session, `HERDR_SOCKET_PATH`,
 *  `HERDR_SESSION`, then the default session. */
export function herdrSocketPath({ session, home, env, paths }: HerdrSocketLookup): string {
  const configDir = paths.join(home, ...HERDR_CONFIG_DIR_SEGMENTS);
  const sessionSocket = (name: string): string =>
    paths.join(configDir, HERDR_SESSIONS_DIR, name, HERDR_SOCKET_FILE);
  if (session) return sessionSocket(session);
  const socketOverride = env[HERDR_SOCKET_PATH_ENV];
  if (socketOverride) return socketOverride;
  const sessionOverride = env[HERDR_SESSION_ENV];
  if (sessionOverride) return sessionSocket(sessionOverride);
  return paths.join(configDir, HERDR_SOCKET_FILE);
}
