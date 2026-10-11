# Hooks consent and the Claude hook installer

Terrarium writes outside `~/.pixel-agents/` in exactly one place: the Claude module's hook entries in `~/.claude/settings.json`. This document covers when it asks, what an answer does, and how the installer edits a file it does not own. The full rule and its rejected alternatives are in [ADR 0001](../adr/0001-consent-choices-send-immediately-and-revise-as-absolute-state.md).

## Where the logic lives

| File                                                 | Role                                                                                                                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/src/providers/consentGate.ts`                | Policy: when to ask (`hooksConsentRequest` per module) and what an answer means (`consentActionFor(choice, {installed, consent})`)                            |
| `server/src/providers/consentExecutor.ts`            | Execution: `applyConsentChoice(providerId, choice, ConsentEffects)` runs the six actions in one order and SERIALIZES answers per process across ALL providers |
| `server/src/providers/claude/claudeHookInstaller.ts` | Claude's `HookInstaller`: install, uninstall, detect, migrate                                                                                                 |
| `server/src/providers/claude/consentCopy.ts`         | Claude's first-run disclosure text (scope, data, undo), served through `consentDisclosure()`                                                                  |
| `server/src/providers/claude/hooks/claude-hook.ts`   | The hook script, bundled to `dist/hooks/claude-hook.js` and staged under `~/.pixel-agents/hooks/`                                                             |

The ask-or-not predicate, the choice→action rule and the execution live ONCE, in the two provider-agnostic files. No module id appears in `cli.ts` or `clientMessageHandler.ts`.

## Who is asked, and when

Consent is required before any FIRST settings-file write, per provider. `config.json` holds `hooksConsent: {providerId: 'granted' | 'declined'}` (absent = unanswered) and, beside it, the per-provider, machine-global `hooksEnabled` preference.

**Exactly one population is asked: the one with nothing of ours installed.** Hooks already on disk are granted silently at startup, since that install only ever removes events.

The ask is one step of the Intro, the four-step first-run tour a greeter character speaks in-app (`webview-ui/src/components/IntroBubble.tsx`). The server sends `hooksConsentRequest` during the `webviewReady` handshake, one per provider, to privileged connections only, carrying the provider's own `consentDisclosure()` so no client-side copy can drift.

## A choice is an absolute state command

Back re-opens the ask, so a revision undoes whatever the earlier answer left: hooks on disk, a grant a failed install recorded, or a decline's own persisted hooks-off. That is why the consent record is a tri-state and each answer commits in ONE config write. An abort (close x, Escape) sends nothing, and the whole Intro returns on the next open. The closing step reports the install OUTCOME, not the click.

## Install state vs preference

`hooksStatus` is install state, `hooksEnabled` is preference. The Intro's closing step reports `hooksInstalled`, never the preference, so it cannot read "on" over an untouched `settings.json`. Every failure path re-derives and broadcasts the truth via `clientMessageHandler`.

- The hook script is copied BEFORE the entries are written. A failed copy aborts the install, because entries pointing at a missing script spawn a dead `node` per event.
- **The hooks preference is persisted only after the install or uninstall settled and the on-disk result agrees.** Writing hooks-off first strands the user when an uninstall fails: the entries keep firing, while the persisted preference makes the next startup skip the consent and install path entirely.
- `pixel-agents --uninstall-hooks` follows the same rule: it persists hooks-off only after the uninstall verifiably landed, and exits non-zero otherwise.
- The server always starts regardless of the hooks preference. Only hook installation is gated by it.

## Installed events

The installer writes the events in `CLAUDE_HOOK_EVENTS` (`server/src/providers/claude/constants.ts`, 12 events). `UserPromptSubmit` and `TaskCreated` are deliberately NOT installed: they normalize to null, so installing them only forwarded prompt text to be dropped. `normalizeHookEvent` still tolerates them for stale installs.

## Writing `settings.json` safely

- Abort on an unparseable file or a non-array `hooks.<Event>`.
- A one-time `.pixel-agents.backup` is taken with an exclusive create. No backup means no write. The backup is skipped when the replaced content is entirely our own install's output (`settingsHoldOnlyOurHooks`), since a backup of what we wrote preserves nothing and masquerades as the user's original. That check compares against `makeHookEntry`, the writer, so a field added to what we write cannot silently revive the bug. Only `command` and `timeout` may differ, because they vary across installs.
- Every write failure THROWS.
- The file mode is preserved, and a new file is created `0600`.
- The file is re-read and verified immediately before the rename, with a retry, because Claude Code writes the same file without coordinating with us.

### Never rewrite a shape we did not author

The unparseable-file abort generalizes: a non-object `hooks`, a non-array `hooks.<Event>`, and junk entries inside an event array are all refused or passed through, never replaced. An array `hooks` was the sharp case: string keys assigned onto it vanish from `JSON.stringify`, so the write committed and reported `installed: true` over a file with no hooks in it. Emptied event keys are deleted only when _our_ removal emptied them.

**Internal sentinels must not be values user JSON can hold.** `null` once marked "this entry is now empty", so a user-authored `null` inside a hooks array was silently deleted (a file with no command of ours anywhere came back rewritten and logged as "Hooks removed"). It is a `Symbol` now.

### Hook identity is anchored at both ends

A substring test (`includes('claude-hook.js') && includes('.pixel-agents')`) claimed, and `uninstallHooks` then DELETED, a `.backup` copy of our script, a shell comment naming our path, a wrapper passing it as an argument, `/opt/evil.pixel-agents/hooks/claude-hook.js`, and `my-pixel-agents-hook.js`.

Ours is the `/.pixel-agents/hooks/claude-hook.js` suffix, ending the command's FIRST token, matched **case-insensitively** (the token is normalized to lower case). Case-sensitive matching is what shipped first. On the case-insensitive volumes this runs on (macOS, Windows) a differently-cased path is the SAME INODE as our script and genuinely firing: reinstall appended a duplicate, and uninstall left the cased entry as an orphan our own `areHooksInstalled` could no longer see, a live hook with no removal route.

The folding is unconditional (no filesystem case-sensitivity probe), so the accepted trade is a Linux-only false positive that is **not** a mere dedup. On a case-sensitive volume `~/.Pixel-Agents/hooks/claude-hook.js` is a genuinely DIFFERENT file, we classify it as ours, and uninstall **deletes** it (`claudeHookInstaller.test.ts` pins that removal). Nothing creates that path, and the trade is deliberate: the alternative is a guaranteed unremovable live hook on the two platforms that need it most.

A symlink alias to our script is deliberately _not_ recognized. The cost is one duplicate entry, versus deleting a stranger's hook if we resolved paths.

## Who may answer: the `/ws` gate

A `hooksConsentResponse` choosing install is a durable, machine-wide consent grant plus a hook install, so `/ws` is gated in one tier plus a privileged escalation:

1. **Connection** (`isAllowedWebSocketOrigin`) requires a same-origin handshake. A missing Origin still connects, since non-browser clients send none. This tier is weak by design: a DNS-rebound page sends `Origin` and `Host` as the same attacker-chosen name and IS accepted (`httpServerWs.test.ts` pins that).
2. **Privileged messages** (`standaloneTokenValid`, `ClientMessageContext.privileged`) are proved by an out-of-band secret: the server token in the `/ws` `?token=` query, which the CLI prints in the local URL and the SPA forwards (`webview-ui/src/transport/index.ts`). **Never a network position**: peer address, `Host` and `Origin` all ride the channel a proxy speaks, so a LAN-bound forwarder piping bytes to 127.0.0.1 satisfies all three.

The token is a replayable bearer capability, not evidence of locality. It also reaches browser history and Fastify's request log, so the printed URL is documented to the user as a secret. An untokened client still watches the office. It just cannot change `~/.claude/settings.json`, and it cannot add, change or remove connections either.
