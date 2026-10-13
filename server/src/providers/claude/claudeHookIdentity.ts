import { HOOK_SCRIPTS_DIR } from '../../constants.js';
import {
  CLAUDE_HOOK_SCRIPT_NAME,
  LEGACY_HOOK_SCRIPT_NAME,
  LEGACY_HOOK_SCRIPTS_DIR,
} from './constants.js';

/** Legacy script name (before rename to claude-hook.js), as a path suffix. */
const LEGACY_HOOK_PATH_SUFFIX = `/${LEGACY_HOOK_SCRIPT_NAME}`;

/** The path suffix we own: `/.terrarium/hooks/claude-hook.js`. The leading
 *  separator is load-bearing — without it `/opt/evil.terrarium/hooks/...`
 *  and `my-pixel-agents-hook.js` match by substring. */
const HOOK_PATH_SUFFIX = `/${HOOK_SCRIPTS_DIR}/${CLAUDE_HOOK_SCRIPT_NAME}`;

/** The suffix we owned before the state directory was renamed to `.terrarium`. */
const LEGACY_DIR_HOOK_PATH_SUFFIX = `/${LEGACY_HOOK_SCRIPTS_DIR}/${CLAUDE_HOOK_SCRIPT_NAME}`;

/** Characters that end a path token in a shell command line. A path we own is
 *  either the whole token or ends at one of these; anything else after it
 *  (`.backup`, `.disabled`, more path segments) means the command names a
 *  DIFFERENT file that merely starts with our path. */
const PATH_TERMINATORS = new Set([' ', '\t', '"', "'", ';', '&', '|', '>', '<', ')']);

/**
 * Check if a single hook command is ours.
 *
 * Neither half of the path is identity on its own: `claude-hook.js` is a
 * generic name another Claude tool could plausibly use, and substring tests
 * claim unrelated commands. Empirically, plain `includes` classified all of
 * these as ours — and `uninstallHooks` then DELETED them:
 *   node /opt/.terrarium/hooks/claude-hook.js.backup   (a different file)
 *   true # /opt/.terrarium/hooks/claude-hook.js        (a comment)
 *   wrapper --note=".terrarium/hooks/claude-hook.js" x (an argument)
 *   node /opt/evil.terrarium/hooks/claude-hook.js      (no token boundary)
 *   node /opt/my-pixel-agents-hook.js.bak                 (legacy, no boundary)
 * Deleting a third-party hook is the same "we destroyed the user's config"
 * class of bug this whole module exists to fix, so identity is anchored at
 * BOTH ends: our path suffix must start at a path separator and must END the
 * command's script token.
 *
 * Deliberate scope choices:
 * - Casing is NOT significant: the token is normalized to lower case before the
 *   suffix compare. macOS and Windows — the two GUI platforms this ships on —
 *   have case-insensitive volumes, where `/home/x/.Terrarium/Hooks/Claude-Hook.js`
 *   is the SAME INODE as our script and is genuinely firing. Reading it as
 *   foreign is what shipped: reinstall appended a duplicate (both fired), and
 *   uninstall left the cased entry behind as an orphan our own uninstall could
 *   no longer see — a running hook the user has no route to remove. The folding
 *   is UNCONDITIONAL (we do not probe the filesystem's case sensitivity), so the
 *   accepted residual is a Linux-only false positive that is NOT harmless: on a
 *   case-sensitive volume `~/.Terrarium/hooks/claude-hook.js` is a genuinely
 *   DIFFERENT file, we classify it as ours, and uninstall DELETES it — the same
 *   class of loss this module exists to prevent, traded knowingly against a
 *   guaranteed unremovable live hook on the two platforms that actually ship
 *   here (see the removal pinned in claudeHookInstaller.test.ts). Nothing we or
 *   Claude Code write ever creates that path. The blast radius is bounded by the
 *   rest of the anchoring: a third-party hook differing in more than case is
 *   still untouched.
 * - The FIRST token only. A command is `node <script>` or `<script>`; our path
 *   appearing later is an argument or a comment, not the thing being run.
 * - ABSOLUTE paths only. We always write one, and a RELATIVE
 *   `.terrarium/hooks/claude-hook.js` resolves against whatever directory
 *   Claude Code happens to run in — so it names a project-local file that is
 *   almost certainly not ours, and deleting it would be the same mistake as
 *   deleting a lookalike.
 * - Suffix, not the resolved homedir: an entry written under a previous or
 *   moved HOME is still ours to clean up.
 * - A symlink ALIAS pointing at our script is not recognized (we compare text,
 *   never resolve). That direction is safe — a later install appends the
 *   canonical command next to the alias, so the worst case is one duplicate
 *   execution for a user who hand-aliased us, versus deleting a stranger's
 *   hook for everyone if we resolved paths from a config file.
 */
export function isOurHookCommand(command: string): boolean {
  const token = firstCommandToken(command);
  if (token === null) return false;
  // Every suffix constant is lower-case, so folding the token is the whole
  // normalization.
  const normalized = token.toLowerCase();
  return (
    normalized.endsWith(HOOK_PATH_SUFFIX) ||
    normalized.endsWith(LEGACY_DIR_HOOK_PATH_SUFFIX) ||
    normalized.endsWith(LEGACY_HOOK_PATH_SUFFIX)
  );
}

/**
 * The ABSOLUTE path of the script a command runs, normalized to forward
 * slashes, or null when the command doesn't look like one of ours.
 *
 * `node "<path>"` and a bare `<path>` are the two shapes we write (and the two
 * a user plausibly hand-edits). A Windows drive prefix (`C:/…`) counts as
 * absolute; a relative path does not (see isOurHookCommand's contract).
 */
function firstCommandToken(command: string): string | null {
  const trimmed = command.trim();
  // `node <script>` / `node "<script>"` — take the argument. The interpreter
  // itself may be a path (quoted, and on Windows containing spaces).
  const nodeInvocation = /^"?(?:[^"]*[/\\])?node(?:\.exe)?"?\s+(.+)$/.exec(trimmed);
  const raw = nodeInvocation ? nodeInvocation[1] : trimmed;
  const token = readToken(raw.trim());
  if (token === null) return null;
  const normalized = token.replace(/\\/g, '/');
  const absolute = normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized);
  return absolute ? normalized : null;
}

/** Read one shell token: a quoted string, or characters up to the first
 *  terminator. Returns null when the token is empty or unterminated. */
function readToken(raw: string): string | null {
  const quote = raw[0];
  if (quote === '"' || quote === "'") {
    const end = raw.indexOf(quote, 1);
    return end > 1 ? raw.slice(1, end) : null;
  }
  let end = 0;
  while (end < raw.length && !PATH_TERMINATORS.has(raw[end])) end++;
  return end > 0 ? raw.slice(0, end) : null;
}
