import * as os from 'node:os';

import { LOCAL_MACHINE_ID } from '../../core/src/constants.js';
import type { ConnectionKind, Floor } from '../../core/src/messages.js';

const SSH_URI_PREFIX = 'ssh://';

/** What a floor needs from a connection: where it leads, and what the user called it. */
interface FloorSource {
  readonly kind: ConnectionKind;
  readonly target?: string;
  readonly label: string;
}

/**
 * The floor id of the machine a connection reaches. A machine is the host part of the SSH destination, compared
 * case-insensitively: `pi`, `luc@pi` and `ssh://pi:2222` reach one machine. Nothing is resolved, so an SSH config
 * alias and the address it stands for are two machines.
 */
export function machineIdOf(connection: Pick<FloorSource, 'kind' | 'target'>): string {
  if (connection.kind === 'local' || !connection.target) return LOCAL_MACHINE_ID;
  return `ssh:${sshHostOf(connection.target)}`;
}

/** The host of a destination `connectionSettings` accepted: `[user@]host`, or `ssh://[user@]host[:port]` with a
 *  bracketed IPv6 address. The user may itself hold an `@`: ssh splits on the last one. */
function sshHostOf(target: string): string {
  const isUri = target.startsWith(SSH_URI_PREFIX);
  const destination = isUri ? target.slice(SSH_URI_PREFIX.length) : target;
  const host = destination.slice(destination.lastIndexOf('@') + 1);
  if (!isUri) return host.toLowerCase();
  if (host.startsWith('[')) return host.slice(1, host.indexOf(']')).toLowerCase();
  const portSeparator = host.lastIndexOf(':');
  return (portSeparator === -1 ? host : host.slice(0, portSeparator)).toLowerCase();
}

/**
 * The office's floors, bottom to top: the machine the server runs on, then every other machine in the order its
 * first connection was added, named after that connection. A machine keeps its floor as long as one of its
 * connections exists, turned on or not.
 */
export function listFloors(
  connections: readonly FloorSource[],
  localName: string = os.hostname(),
): Floor[] {
  const floors: Floor[] = [{ id: LOCAL_MACHINE_ID, name: localName }];
  for (const connection of connections) {
    const id = machineIdOf(connection);
    if (!floors.some((floor) => floor.id === id)) floors.push({ id, name: connection.label });
  }
  return floors;
}
