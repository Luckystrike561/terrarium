/**
 * Disclosure text for Claude's two consent-gated subjects: the hook entries and the status line, asked and revised
 * independently. Both surfaces show the SAME in-app ask: the server ships these strings in the
 * `hooksConsentRequest` message and the webview's IntroBubble (the greeter character's speech bubble) renders them
 * verbatim on the Intro's consent step, so there is exactly one copy of each subject's terms and no client-side
 * duplicate to drift into asking for approval on weaker terms.
 *
 * Each subject carries three pieces: the HEADLINE is the title of its consent step, the DISCLOSURE is that step's
 * body, and the ACTION_LABEL is the Install button's text. The headline carries NO disclosure facts — every fact
 * lives in the shared disclosure block, so no fact depends on how a surface renders its title slot
 * (consentCopy.test.ts pins that split). A subject's disclosure states only what THAT subject writes and moves: the
 * hooks disclosure does not mention the status line, and vice versa — each is a separate, independently-consented
 * write, and overclaiming the other's scope would misdescribe what declining it actually leaves behind.
 *
 * The event count is interpolated from CLAUDE_HOOK_EVENTS, never written out:
 * a hardcoded number silently becomes a lie the next time the list changes.
 */

import { CLAUDE_HOOK_EVENTS, SETTINGS_BACKUP_SUFFIX } from './constants.js';

const SETTINGS_FILE = '~/.claude/settings.json';

// ── Hooks subject ──────────────────────────────────────────────

/** WHY we ask + WHAT we write. */
export const CONSENT_FACT_WHAT =
  `To bring your agents to life in real time, Terrarium adds hooks for ` +
  `${CLAUDE_HOOK_EVENTS.length} Claude Code events to ${SETTINGS_FILE}. ` +
  `Note that your existing settings are kept, and a one-time backup is saved as settings.json${SETTINGS_BACKUP_SUFFIX}.`;

/** WHAT data moves, and where it stops.
 *
 *  "Nothing leaves your machine" is not something this prompt can promise:
 *  `terrarium --host 0.0.0.0` binds the same server to every interface,
 *  and an accepted socket receives the store broadcasts
 *  (server/src/httpServer.ts). So it states the default and names the one
 *  thing that changes it, rather than making a promise the software can be
 *  asked to break. */
export const CONSENT_FACT_DATA =
  'Claude Code will send those events - including tool names and tool inputs - to a Terrarium server on this ' +
  'machine. Everything stays local - the server listens only on 127.0.0.1 - unless you explicitly start it with ' +
  '--host to expose it on your network.';

/** HOW to undo it. */
export const CONSENT_FACT_REVERSIBLE =
  'You can remove the hooks at any time by running terrarium --uninstall-hooks.';

/** Headline for the hooks subject's first-run gate — the only population that is asked. A user whose hooks a
 *  pre-consent version already installed is migrated silently (the migration only ever drops events), so there is
 *  no second headline. Title of the Intro's consent step ("Welcome to Terrarium!" is the Intro's own opening-step
 *  title, owned by the webview). Carries NO disclosure facts by design: the facts all live in CONSENT_DISCLOSURE. */
export const CONSENT_INSTALL_HEADLINE = 'One more thing: hooks!';

/** The hooks subject's Install button text. */
export const CONSENT_ACTION_LABEL = 'Install Hooks';

/** The three disclosure facts, in order, as one block.
 *
 *  This is the consent step's body. The IntroBubble splits it on the blank
 *  lines and renders every paragraph in full on the decision surface itself — no
 *  "Details" affordance, which would put the disclosure one click away from
 *  the decision it is there to inform. */
export const CONSENT_DISCLOSURE = [
  CONSENT_FACT_WHAT,
  CONSENT_FACT_DATA,
  CONSENT_FACT_REVERSIBLE,
].join('\n\n');

// ── Status line subject ────────────────────────────────────────

/** WHY we ask + WHAT we write. */
export const STATUS_LINE_FACT_WHAT =
  `Terrarium can also take the statusLine slot in ${SETTINGS_FILE} so it can read your plan's 5-hour and weekly ` +
  `usage limits and draw them as coffee beans in the office. A status line you already have keeps running and ` +
  `prints exactly what it printed. Note that your existing settings are kept, and a one-time backup is saved as ` +
  `settings.json${SETTINGS_BACKUP_SUFFIX}.`;

/** WHAT data moves, and where it stops. See CONSENT_FACT_DATA above for why this cannot promise nothing leaves the
 *  machine. */
export const STATUS_LINE_FACT_DATA =
  'Claude Code will send your 5-hour and weekly usage limits to a Terrarium server on this machine. Everything ' +
  'stays local - the server listens only on 127.0.0.1 - unless you explicitly start it with --host to expose it ' +
  'on your network.';

/** HOW to undo it. */
export const STATUS_LINE_FACT_REVERSIBLE =
  'You can put your own status line back at any time by running terrarium --uninstall-hooks.';

/** Headline for the status line subject's first-run gate. Carries NO disclosure facts, same rule as
 *  CONSENT_INSTALL_HEADLINE. */
export const STATUS_LINE_HEADLINE = 'One more thing: a status line!';

/** The status line subject's Install button text. */
export const STATUS_LINE_ACTION_LABEL = 'Install Status Line';

/** The status line subject's disclosure, same structure as CONSENT_DISCLOSURE. */
export const STATUS_LINE_DISCLOSURE = [
  STATUS_LINE_FACT_WHAT,
  STATUS_LINE_FACT_DATA,
  STATUS_LINE_FACT_REVERSIBLE,
].join('\n\n');
