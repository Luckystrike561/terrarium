/**
 * The `statusLine` slot of ~/.claude/settings.json, where Claude Code hands `rate_limits` to a command. Ours runs the
 * hook script with STATUS_LINE_FLAG. A status line the user already had is never replaced: ours carries it, encoded
 * in its own command, runs it first and prints its output unchanged, and uninstall writes it back exactly.
 */

import { isDeepStrictEqual } from 'util';

import { isOurHookCommand } from './claudeHookIdentity.js';
import { STATUS_LINE_FLAG } from './constants.js';

/** A `statusLine` that runs a command, the only kind Claude Code documents. Other fields (`padding`,
 *  `refreshInterval`, ...) belong to the user and ride along. */
export interface CommandStatusLine {
  readonly type: 'command';
  readonly command: string;
  readonly [field: string]: unknown;
}

const OUR_STATUS_LINE_ARGUMENTS = new RegExp(`\\s${STATUS_LINE_FLAG}(?:\\s+(\\S+))?\\s*$`);

/** Surfaced when our status line carries an original that does not decode. Writing over it would lose the user's
 *  status line for good, so install and uninstall refuse instead. */
export const STATUS_LINE_UNREADABLE_MESSAGE =
  "statusLine in ~/.claude/settings.json runs Terrarium's hook script but its chained status line cannot be read — fix or remove it";

export function isCommandStatusLine(value: unknown): value is CommandStatusLine {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const fields = value as Record<string, unknown>;
  return fields.type === 'command' && typeof fields.command === 'string';
}

/** Whether `value` is our status line. Identity is the hook script's anchored path (isOurHookCommand) followed by
 *  STATUS_LINE_FLAG, the shape only our installer writes. */
export function isOurStatusLine(value: unknown): value is CommandStatusLine {
  return (
    isCommandStatusLine(value) &&
    isOurHookCommand(value.command) &&
    OUR_STATUS_LINE_ARGUMENTS.test(value.command)
  );
}

/** The user's status line our status line chains, or undefined when it chains none. Throws on one that does not
 *  decode to a command status line. */
export function chainedStatusLine(ours: CommandStatusLine): CommandStatusLine | undefined {
  const encoded = OUR_STATUS_LINE_ARGUMENTS.exec(ours.command)?.[1];
  if (encoded === undefined) return undefined;
  return decodeStatusLine(encoded);
}

/** The status line the hook script chains, from the argument following STATUS_LINE_FLAG. Throws on one that does not
 *  decode to a command status line. */
export function decodeStatusLine(encoded: string): CommandStatusLine {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw new Error(STATUS_LINE_UNREADABLE_MESSAGE);
  }
  if (!isCommandStatusLine(decoded)) throw new Error(STATUS_LINE_UNREADABLE_MESSAGE);
  return decoded;
}

/** Our status line for the hook script at `scriptPath`, chaining `original` when the user had one. */
export function makeStatusLine(
  scriptPath: string,
  original: CommandStatusLine | undefined,
): CommandStatusLine {
  const command = `node "${scriptPath}" ${STATUS_LINE_FLAG}`;
  if (original === undefined) return { type: 'command', command };
  const encoded = Buffer.from(JSON.stringify(original), 'utf8').toString('base64url');
  return { ...original, type: 'command', command: `${command} ${encoded}` };
}

/** Whether `value` is our status line exactly as a fresh install writes it into an empty slot, so it holds nothing a
 *  backup could preserve. Compared against makeStatusLine, the writer, with only the script path free. */
export function isBareStatusLine(value: unknown): boolean {
  return (
    isOurStatusLine(value) &&
    OUR_STATUS_LINE_ARGUMENTS.exec(value.command)?.[1] === undefined &&
    isDeepStrictEqual({ ...value, command: '' }, { ...makeStatusLine('', undefined), command: '' })
  );
}

/** Put our status line in `settings`, chaining the one already there. Returns whether anything changed. A status line
 *  we cannot chain (not a command) is the user's and is left alone: the office then shows no Claude quota. */
export function installStatusLine(settings: Record<string, unknown>, scriptPath: string): boolean {
  const current = settings.statusLine;
  let original: CommandStatusLine | undefined;
  if (isOurStatusLine(current)) {
    original = chainedStatusLine(current);
  } else if (isCommandStatusLine(current)) {
    original = current;
  } else if (current !== undefined) {
    return false;
  }
  const next = makeStatusLine(scriptPath, original);
  if (isDeepStrictEqual(next, current)) return false;
  settings.statusLine = next;
  return true;
}

/** Take our status line out of `settings`, writing back the one it chained, or removing the key when it chained
 *  none. Returns whether anything changed. */
export function uninstallStatusLine(settings: Record<string, unknown>): boolean {
  const current = settings.statusLine;
  if (!isOurStatusLine(current)) return false;
  const original = chainedStatusLine(current);
  if (original === undefined) {
    delete settings.statusLine;
  } else {
    settings.statusLine = original;
  }
  return true;
}
