# Hooks consent and the Claude hook installer

Terrarium writes outside `~/.terrarium/` in exactly one place: the Claude module's hook entries and status line in `~/.claude/settings.json`, and the two are separate **consent subjects**. Each has its own `HookInstaller`, its own disclosure, its own persisted answer, and its own revision: declining or reverting one never touches the other's entries in `settings.json` or its own key in `config.json`. This document covers when each is asked, what an answer does, and how the installer edits a file it does not own. The full rule and its rejected alternatives are in [ADR 0001](../adr/0001-consent-choices-send-immediately-and-revise-as-absolute-state.md); the split into two subjects is [ADR 0002](../adr/0002-separate-consent-subject-for-the-status-line.md).

## Where the logic lives

| File                                                 | Role                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/src/providers/consentGate.ts`                | Policy: when to ask (`hooksConsentRequest` per module, per subject) and what an answer means (`consentActionFor(choice, {installed, consent})`)                                                                                                                                   |
| `server/src/providers/consentExecutor.ts`            | Execution: `applyConsentChoice(providerId, subjectId, choice, ConsentEffects)` runs the six actions in one order and SERIALIZES answers per process across ALL providers and subjects                                                                                             |
| `server/src/providers/claude/claudeHookInstaller.ts` | Claude's two `HookInstaller`s: `installEntries`/`uninstallEntries` for the 12 hook entries and `areHooksInstalled()`, `installStatusLineEntry`/`uninstallStatusLineEntry` and `isStatusLineInstalled()` for the status line, each its own independent `mutateClaudeSettings` pass |
| `server/src/providers/claude/claude.ts`              | Wires the two subjects (`hooksSubject`, `statusLineSubject`, ids `'hooks'` and `'statusLine'`) into `claudeModule.hooks`, and the module-level `stageHookFiles` both share                                                                                                        |
| `server/src/providers/claude/claudeHookIdentity.ts`  | Anchored identity of our hook script in a command line (`isOurHookCommand`)                                                                                                                                                                                                       |
| `server/src/providers/claude/consentCopy.ts`         | Each subject's first-run disclosure text (scope, data, undo), served through its `consentDisclosure()`                                                                                                                                                                            |
| `server/src/providers/claude/hooks/claude-hook.ts`   | The hook script, bundled to `dist/hooks/claude-hook.js` and staged under `~/.terrarium/hooks/`, shared by both subjects                                                                                                                                                           |

The ask-or-not predicate, the choice→action rule and the execution live ONCE, in the two provider-agnostic files, keyed by `(providerId, subjectId)`. No module id and no subject id appears in `cli.ts` or `clientMessageHandler.ts`.

## Who is asked, and when

Consent is required before any FIRST settings-file write, per `(provider, subject)` pair. `config.json` holds `hooksConsent: {providerId: {subjectId: 'granted' | 'declined'}}` (a pair absent from the map is unanswered) and, beside it, the per-`(provider, subject)`, machine-global `hooksEnabled` preference. A config written before the split used a flat `hooksConsent: {providerId: 'granted' | 'declined'}`, migrated on read by attributing that one value to the `hooks` subject (the one write every installer made implicitly before this split), while `statusLine` starts unanswered: it was never askable under the old shape, so it never inherits the old grant.

**Exactly one population is asked for a given subject: the one with nothing of that subject installed.** A subject already on disk with no recorded answer is granted silently at startup, per `(provider, subject)`, not per module, for `hooks` that is the long-standing migration (the install only ever removes events, so there is nothing to disclose that is not already in effect), and the same grandfathering now applies to `statusLine` for anyone whose status line a pre-split build already chained.

The ask is one step of the Intro, the four-step first-run tour a greeter character speaks in-app (`webview-ui/src/components/IntroBubble.tsx`). The server sends one `hooksConsentRequest` per `(module, subject)` pair that needs one during the `webviewReady` handshake, to privileged connections only, asking `hooks` before `statusLine`, each carrying that subject's own `consentDisclosure()` (headline, disclosure, and action-button label) so no client-side copy can drift.

## A choice is an absolute state command

Back re-opens the ask for that subject, so a revision undoes whatever the earlier answer left for IT ALONE: that subject's entries on disk, a grant a failed install recorded, or a decline's own persisted off-preference. A sibling subject's record is untouched. That is why the consent record is a tri-state per `(provider, subject)` and each answer commits in ONE config write. An abort (close x, Escape) sends nothing, and the whole Intro returns on the next open. The closing step reports the install OUTCOME, not the click.

## Install state vs preference

`hooksStatus` is install state, `hooksEnabled` is preference. The Intro's closing step reports `hooksInstalled`, never the preference, so it cannot read "on" over an untouched `settings.json`. Every failure path re-derives and broadcasts the truth via `clientMessageHandler`.

- The hook script is copied BEFORE the entries are written. A failed copy aborts the install, because entries pointing at a missing script spawn a dead `node` per event.
- **A subject's preference is persisted only after its own install or uninstall settled and the on-disk result agrees.** Writing its preference off first strands the user when an uninstall fails: its entries keep firing, while the persisted preference makes the next startup skip the consent and install path entirely. `hooks` and `statusLine` each follow this rule independently.
- `terrarium --uninstall-hooks` follows the same rule for EVERY subject of every module: it persists a subject's preference off only after that subject's uninstall verifiably landed, and exits non-zero if any subject disagrees.
- The server always starts regardless of the hooks preference. Only hook installation is gated by it.

## Installed events

The installer writes the events in `CLAUDE_HOOK_EVENTS` (`server/src/providers/claude/constants.ts`, 12 events). `UserPromptSubmit` and `TaskCreated` are deliberately NOT installed: they normalize to null, so installing them only forwarded prompt text to be dropped. `normalizeHookEvent` still tolerates them for stale installs.

## The status line

Claude Code passes `rate_limits` (the Pro and Max 5-hour and 7-day windows) only to its status line command, so a second, independent subject, `statusLine`, takes that slot under its own consent, its own disclosure (`STATUS_LINE_HEADLINE` / `STATUS_LINE_DISCLOSURE` in `consentCopy.ts`), and the same write rules as the hook entries. Declining or reverting it leaves the 12 hook entries exactly as they are, and declining or reverting those leaves the status line exactly as it is. It never replaces a status line the user has:

- Ours runs `node "<hook script>" --status-line [<the user's statusLine, base64url JSON>]`. The script runs the user's command on the same stdin, in the shell Claude Code would have used (`claudeStatusLineShell.ts`: `/bin/sh` on macOS and Linux, on Windows Git Bash from `CLAUDE_CODE_GIT_BASH_PATH`, the `git.exe` on `PATH` or the default install, else PowerShell), its stdout going straight to Claude Code, and exits with its exit code. In parallel it POSTs only `session_id` and `rate_limits` to `/api/hooks/claude` as `hook_event_name: TerrariumStatusLine`, and nothing when the session has no `rate_limits`.
- The user's other fields (`padding`, `refreshInterval`, ...) are copied onto ours, so the terminal shows exactly what it showed. They stay the user's: a field changed, added or removed on ours later is carried into the chained original at the next install and written back on uninstall.
- Uninstall (`uninstallStatusLineEntry`) decodes the chained value and writes it back, so that key is byte-identical to the original, in its OWN `mutateClaudeSettings` pass, touching no hook entry. A slot that was empty is emptied again. A chained value that does not decode makes install and uninstall refuse rather than lose it.
- A `statusLine` that is not a `command` is left alone, and the office then shows no Claude quota.
- Ours is recognized by `isOurHookCommand` (the anchored rule below) followed by `--status-line`. `isStatusLineInstalled()` checks the status line slot alone, independent of `areHooksInstalled()`, which checks the 12 entries alone: a lone status line still has a removal route, a lone set of entries still has a removal route, and a bare status line in an empty slot counts as our own output for the backup rule.

With no status line of the user's, ours fills the empty slot and prints nothing. Claude Code then hides most footer hints (`esc to interrupt`, `? for shortcuts`, `hold space to speak`), as it does for any custom status line, so the status line disclosure says so. Declining keeps the slot empty across restarts.

A `statusLine` already on disk with no recorded answer is granted silently at startup, same as `hooks` (see "Who is asked, and when" above): anyone whose status line a pre-split build already chained keeps it, with no new ask. It is the one install step that adds rather than removes a slot's content, which is why its own first-run disclosure, not silent grandfathering, is the default path for everyone else. A project-level `statusLine` overrides ours, and those projects then report no quota.

## Writing `settings.json` safely

- Abort on an unparseable file or a non-array `hooks.<Event>`.
- A one-time `.terrarium.backup` is taken with an exclusive create. No backup means no write. The backup is skipped when the replaced content is entirely our own install's output (`settingsHoldOnlyOurHooks`), since a backup of what we wrote preserves nothing and masquerades as the user's original. That check compares against `makeHookEntry`, the writer, so a field added to what we write cannot silently revive the bug. Only `command` and `timeout` may differ, because they vary across installs.
- A `settings.json.pixel-agents.backup` from before the rename to Terrarium counts as that backup, so no second one is taken over settings that already hold our hooks.
- Every write failure THROWS.
- The file mode is preserved, and a new file is created `0600`.
- The file is re-read and verified immediately before the rename, with a retry, because Claude Code writes the same file without coordinating with us.

### Never rewrite a shape we did not author

The unparseable-file abort generalizes: a non-object `hooks`, a non-array `hooks.<Event>`, and junk entries inside an event array are all refused or passed through, never replaced. An array `hooks` was the sharp case: string keys assigned onto it vanish from `JSON.stringify`, so the write committed and reported `installed: true` over a file with no hooks in it. Emptied event keys are deleted only when _our_ removal emptied them.

**Internal sentinels must not be values user JSON can hold.** `null` once marked "this entry is now empty", so a user-authored `null` inside a hooks array was silently deleted (a file with no command of ours anywhere came back rewritten and logged as "Hooks removed"). It is a `Symbol` now.

### Hook identity is anchored at both ends

A substring test (`includes('claude-hook.js') && includes('.terrarium')`) claimed, and `uninstallHooks` then DELETED, a `.backup` copy of our script, a shell comment naming our path, a wrapper passing it as an argument, `/opt/evil.terrarium/hooks/claude-hook.js`, and `my-pixel-agents-hook.js`.

Ours is the `/.terrarium/hooks/claude-hook.js` suffix, ending the command's FIRST token, matched **case-insensitively** (the token is normalized to lower case). Case-sensitive matching is what shipped first. On the case-insensitive volumes this runs on (macOS, Windows) a differently-cased path is the SAME INODE as our script and genuinely firing: reinstall appended a duplicate, and uninstall left the cased entry as an orphan our own `areHooksInstalled` could no longer see, a live hook with no removal route.

The suffix from before the rename to Terrarium, `/.pixel-agents/hooks/claude-hook.js`, is matched the same way. Those entries name a script the state directory migration moved away, so the next install must replace them and uninstall must remove them.

The folding is unconditional (no filesystem case-sensitivity probe), so the accepted trade is a Linux-only false positive that is **not** a mere dedup. On a case-sensitive volume `~/.Terrarium/hooks/claude-hook.js` is a genuinely DIFFERENT file, we classify it as ours, and uninstall **deletes** it (`claudeHookInstaller.test.ts` pins that removal). Nothing creates that path, and the trade is deliberate: the alternative is a guaranteed unremovable live hook on the two platforms that need it most.

A symlink alias to our script is deliberately _not_ recognized. The cost is one duplicate entry, versus deleting a stranger's hook if we resolved paths.

## Who may answer: the `/ws` gate

A `hooksConsentResponse` choosing install is a durable, machine-wide consent grant plus a hook install, so `/ws` is gated in one tier plus a privileged escalation:

1. **Connection** (`isAllowedWebSocketOrigin`) requires a same-origin handshake. A missing Origin still connects, since non-browser clients send none. This tier is weak by design: a DNS-rebound page sends `Origin` and `Host` as the same attacker-chosen name and IS accepted (`httpServerWs.test.ts` pins that).
2. **Privileged messages** (`standaloneTokenValid`, `ClientMessageContext.privileged`) are proved by an out-of-band secret: the server token in the `/ws` `?token=` query, which the CLI prints in the local URL and the SPA forwards (`webview-ui/src/transport/index.ts`). **Never a network position**: peer address, `Host` and `Origin` all ride the channel a proxy speaks, so a LAN-bound forwarder piping bytes to 127.0.0.1 satisfies all three.

The token is a replayable bearer capability, not evidence of locality. It also reaches browser history and Fastify's request log, so the printed URL is documented to the user as a secret. An untokened client still watches the office. It just cannot change `~/.claude/settings.json`, and it cannot add, change or remove connections either.
