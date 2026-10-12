/**
 * Claude-specific constants. Kept separate from `server/src/constants.ts` so a
 * future single-provider `server/` build doesn't accidentally depend on Claude
 * unless Claude is the active provider.
 *
 * Adding another module? Create its own `providers/<id>/constants.ts`.
 */

/** Output filename after esbuild compiles claude-hook.ts to CJS (source is .ts, output is .js) */
export const CLAUDE_HOOK_SCRIPT_NAME = 'claude-hook.js';

/** The script name we shipped before the rename to claude-hook.js. Still
 *  recognized as ours so a very old install can be migrated or removed. */
export const LEGACY_HOOK_SCRIPT_NAME = 'pixel-agents-hook.js';

/** Where the hook script was staged before the state directory was renamed to
 *  `.terrarium`. Entries pointing here are still ours, so the next install
 *  replaces them and uninstall removes them. */
export const LEGACY_HOOK_SCRIPTS_DIR = '.pixel-agents/hooks';

/** Hook events to install in ~/.claude/settings.json. This list is the whole
 *  data-collection surface: Claude Code POSTs each of these payloads to the
 *  local server, so an event we do not act on is scope we should not ask for.
 *  SessionStart/SessionEnd handle session lifecycle (start, /clear, resume, exit).
 *  Stop/PermissionRequest/Notification handle turn completion and permission UI.
 *  SubagentStart/SubagentStop/TeammateIdle/TaskCompleted power Agent Teams.
 *
 *  Deliberately NOT installed: UserPromptSubmit and TaskCreated. Both normalize
 *  to null (nothing in the runtime consumes them), so installing them only
 *  forwarded the user's prompt text and task payloads to the server to be
 *  dropped. A legacy install that still carries them is migrated on the next
 *  install (see installEntries' unlisted-event sweep). */
export const CLAUDE_HOOK_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'Stop',
  'PermissionRequest',
  'Notification',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'SubagentStart',
  'SubagentStop',
  'TeammateIdle',
  'TaskCompleted',
] as const;

/** The hook script's argument that makes it Claude Code's status line command instead of a hook. Our status line
 *  runs `node "<hook script>" --status-line [<the user's status line, base64url JSON>]`. */
export const STATUS_LINE_FLAG = '--status-line';

/** `hook_event_name` of what the status line POSTs. Not a Claude Code hook event: the prefix keeps a future one of
 *  the same name from being mistaken for ours. */
export const STATUS_LINE_EVENT = 'TerrariumStatusLine';

/** How long a status-line quota reading counts as fresh. Claude Code runs the status line after every assistant
 *  message, so a quiet quarter hour means no Claude session is working and the reading may be behind. */
export const CLAUDE_QUOTA_STALE_AFTER_MS = 15 * 60_000;

/** Suffix of the one-time pre-modification backup of settings.json. Brand-named
 *  rather than a generic `.backup`, which collides with other tools' backup
 *  convention: a foreign `.backup` sitting next to settings.json must not make
 *  us believe we already saved the user's original. */
export const SETTINGS_BACKUP_SUFFIX = '.terrarium.backup';

/** The backup suffix before the rename to Terrarium. A backup under this name
 *  already holds the user's pre-install settings, so no new backup is taken. */
export const LEGACY_SETTINGS_BACKUP_SUFFIX = '.pixel-agents.backup';

/** Suffix of the temp file used for the atomic tmp-write + rename. */
export const SETTINGS_TMP_SUFFIX = '.terrarium-tmp';

/** Mode for a settings.json we create ourselves. An existing file's mode is
 *  preserved instead. This is only the fresh-file default, and it is the
 *  restrictive one because the file holds the user's permission rules. */
export const SETTINGS_FRESH_FILE_MODE = 0o600;

/** Attempts for the settings.json read-modify-write cycle. Claude Code writes
 *  the same file and does not coordinate with us, so the cycle re-reads the
 *  file immediately before committing and retries when it changed. The verify
 *  sits after mkdir/backup/tmp-write, so the residual lost-update window is one
 *  read plus one rename: narrowed, NOT eliminated. A Claude Code write landing
 *  inside that gap is still overwritten by our rename. A lockfile would not
 *  help (Claude Code would not honor it, and stale locks add failure modes
 *  worse than the race). */
export const SETTINGS_MUTATE_ATTEMPTS = 3;
/** Delay between settings.json mutation attempts (lets a concurrent writer finish). */
export const SETTINGS_MUTATE_RETRY_DELAY_MS = 100;

// Transcripts report token usage but never the window it counts against, so
// these are the denominators behind every context gauge. Measured against
// real transcripts, where the largest context seen per model was: opus-4-8
// 957k, fable-5 788k, opus-5 459k, sonnet-5 233k: every current model runs
// the large window. Haiku is the small-window exception.
/** Current Claude models (Opus/Sonnet/Fable 5, Opus 4.8). */
export const CLAUDE_LARGE_CONTEXT_WINDOW = 1_000_000;
/** Haiku, and older models that never got the large window. */
export const CLAUDE_SMALL_CONTEXT_WINDOW = 200_000;
/** Model ids that run the small window. Everything else gets the large one:
 *  guessing small for a large model pins every gauge in the red, while the
 *  reverse is a quiet under-read that the runtime's widening still corrects. */
export const CLAUDE_SMALL_CONTEXT_MODEL_PATTERN = /haiku|claude-[123]|-4-[01]\b/i;

// ── JSONL file watching and scanning ──
export const FILE_WATCHER_POLL_INTERVAL_MS = 500;
export const PROJECT_SCAN_INTERVAL_MS = 1000;
/** How often a multiplexer pane's transcript is looked for until the CLI creates it. */
export const TRANSCRIPT_FOLLOW_RETRY_MS = 1000;

// ── Heuristic agent status detection (fallback when hooks are not active) ──
/** Delay before sending agentToolDone (prevents UI flicker on rapid tool transitions). */
export const TOOL_DONE_DELAY_MS = 300;
/** Heuristic: time after a non-exempt tool starts before showing permission bubble.
 *  Not used for teammates -- false positives on slow tools (WebFetch/WebSearch).
 *  Teammates rely on the lead's routed Notification(permission_prompt) hook. */
export const PERMISSION_TIMER_DELAY_MS = 7000;
/** Heuristic: silence duration before marking a text-only turn as complete. */
export const TEXT_IDLE_DELAY_MS = 5000;

// ── External session detection ──
export const EXTERNAL_SCAN_INTERVAL_MS = 3000;
/** Only adopt JSONL files modified within this window. */
export const EXTERNAL_ACTIVE_THRESHOLD_MS = 120_000; // 2 minutes
export const EXTERNAL_STALE_CHECK_INTERVAL_MS = 30_000;
/** Cooldown after the user closes an agent. Must be > EXTERNAL_ACTIVE_THRESHOLD_MS so the
 *  file's mtime becomes stale before the dismissal expires. */
export const DISMISSED_COOLDOWN_MS = 180_000; // 3 minutes
/** Grace period after SessionEnd(reason=clear/resume) before ending the session. /clear and
 *  /resume fire SessionEnd then SessionStart within ms; this is the safety net for when
 *  SessionStart never arrives. */
export const SESSION_END_GRACE_MS = 2000;

// ── Context window usage ──
/** Known window sizes, ascending. The smallest tier that fits the largest context observed so
 *  far wins; beyond the last tier the window rounds up to a whole multiple of it. */
export const CONTEXT_WINDOW_TIERS = [200_000, 1_000_000] as const;
/** How much of a transcript's tail to read when seeding an agent's context on adoption or
 *  restore. Comfortably more than one turn's worth of records. */
export const CONTEXT_SEED_TAIL_BYTES = 256 * 1024;

// ── Global session scanning ──
/** Only adopt global JSONL files larger than this (filters out empty/init-only sessions). */
export const GLOBAL_SCAN_ACTIVE_MIN_SIZE = 3_072; // 3KB
/** Only adopt global JSONL files modified within this window. */
export const GLOBAL_SCAN_ACTIVE_MAX_AGE_MS = 600_000; // 10 minutes
