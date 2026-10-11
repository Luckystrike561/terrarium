import type { ConnectionKind } from '../../core/src/messages.js';
import {
  CONNECTION_LABEL_MAX_CHARS,
  DEFAULT_CONNECTION_ID,
  DEFAULT_CONNECTION_LABEL,
  HERDR_SESSION_NAME_MAX_CHARS,
  SSH_TARGET_MAX_CHARS,
} from './constants.js';

/** A herdr server the office listens to, as persisted in config.json. */
export interface ConnectionSettings {
  readonly id: string;
  readonly label: string;
  readonly kind: ConnectionKind;
  /** SSH destination, `ssh` connections only. */
  readonly target?: string;
  /** herdr session name. Absent means herdr's default session. */
  readonly session?: string;
  readonly enabled: boolean;
}

/** What a client asks to add: everything but the id the server assigns. New connections start enabled. */
export type NewConnection = Omit<ConnectionSettings, 'id' | 'enabled'>;

/** Listened to when config.json names no connections: today's behaviour, herdr's default local session. */
export const DEFAULT_CONNECTIONS: readonly ConnectionSettings[] = [
  { id: DEFAULT_CONNECTION_ID, label: DEFAULT_CONNECTION_LABEL, kind: 'local', enabled: true },
];

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const WHITESPACE = /\s/;
/** Connection ids name a forwarded socket file, so nothing that could leave its directory. */
const CONNECTION_ID = /^[A-Za-z0-9_-]+$/;
/** herdr session names become a directory under `~/.config/herdr/sessions/`, so nothing that could leave it. */
const SESSION_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** OpenSSH substitutes the user and host into ssh_config `%r`/`%h` (ProxyCommand, Match exec) unquoted, and filters
 *  shell metacharacters out of them only since 9.6, so a target is held to destination syntax. The user may contain
 *  `@`: ssh splits on the last one, which bastion gateways rely on. A port or a bracketed IPv6 address only parses in
 *  the URI form. */
const SSH_DESTINATION =
  /^(?:[A-Za-z0-9_][A-Za-z0-9._@-]*@)?(?:[A-Za-z0-9][A-Za-z0-9._-]*|[0-9A-Fa-f]*:[0-9A-Fa-f:.]*)$/;
const SSH_URI =
  /^ssh:\/\/(?:[A-Za-z0-9_][A-Za-z0-9._-]*@)?(?:[A-Za-z0-9][A-Za-z0-9._-]*|\[[0-9A-Fa-f:.]+\])(?::[0-9]{1,5})?$/;

export function connectionLabelError(label: string): string | undefined {
  if (!label) return 'Give the connection a label';
  if (label.length > CONNECTION_LABEL_MAX_CHARS) {
    return `Labels are at most ${CONNECTION_LABEL_MAX_CHARS} characters`;
  }
  if (CONTROL_CHARS.test(label)) return 'Labels cannot contain control characters';
  return undefined;
}

/** The target becomes an `ssh` argument: a leading `-` would be read as an option, whitespace would split it, and
 *  anything else outside destination syntax would reach ssh_config's `%h`/`%r`. */
function sshTargetError(target: string): string | undefined {
  if (!target) return 'Enter an SSH target (host, user@host or an SSH config alias)';
  if (target.length > SSH_TARGET_MAX_CHARS) {
    return `SSH targets are at most ${SSH_TARGET_MAX_CHARS} characters`;
  }
  if (target.startsWith('-')) return 'SSH targets cannot start with "-"';
  if (WHITESPACE.test(target) || CONTROL_CHARS.test(target)) {
    return 'SSH targets cannot contain spaces or control characters';
  }
  if (!SSH_DESTINATION.test(target) && !SSH_URI.test(target)) {
    return `"${target}" is not an SSH target: use host, user@host, ssh://user@host:port or an SSH config alias`;
  }
  return undefined;
}

function sessionNameError(session: string): string | undefined {
  if (session.length > HERDR_SESSION_NAME_MAX_CHARS) {
    return `herdr session names are at most ${HERDR_SESSION_NAME_MAX_CHARS} characters`;
  }
  if (!SESSION_NAME.test(session)) {
    return 'herdr session names use letters, digits, ".", "_" and "-", starting with a letter or digit';
  }
  return undefined;
}

function optionalTrimmed(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** Validate a client's addConnection fields. Returns the connection to add, or why it cannot be. */
export function parseNewConnection(
  raw: Record<string, unknown>,
): NewConnection | { error: string } {
  const label = typeof raw.label === 'string' ? raw.label.trim() : '';
  const labelError = connectionLabelError(label);
  if (labelError) return { error: labelError };
  const kind = raw.kind;
  if (kind !== 'local' && kind !== 'ssh') return { error: 'Pick SSH or a local herdr session' };
  const session = optionalTrimmed(raw.session);
  const sessionError = session === undefined ? undefined : sessionNameError(session);
  if (sessionError) return { error: sessionError };
  if (kind === 'local') return { label, kind, session };
  const target = typeof raw.target === 'string' ? raw.target.trim() : '';
  const targetError = sshTargetError(target);
  if (targetError) return { error: targetError };
  return { label, kind, target, session };
}

/** A persisted connection, or undefined when the entry is malformed (hand-edited, or written by another build). */
export function parseStoredConnection(raw: unknown): ConnectionSettings | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const entry = raw as Record<string, unknown>;
  if (typeof entry.id !== 'string' || !CONNECTION_ID.test(entry.id)) return undefined;
  if (typeof entry.enabled !== 'boolean') return undefined;
  const parsed = parseNewConnection(entry);
  if ('error' in parsed) return undefined;
  return { ...parsed, id: entry.id, enabled: entry.enabled };
}

/** Whether two connections reach the same herdr server. */
export function isSameServer(a: NewConnection, b: NewConnection): boolean {
  return a.kind === b.kind && a.target === b.target && a.session === b.session;
}
