# The hook entries and the status line are separate consent subjects

The hook install originally took two different pieces of `~/.claude/settings.json` under
one consent: the 12 `hooks.<Event>` entries, and, once quota reporting shipped, the
`statusLine` slot. One `hooksConsent: {providerId: 'granted' | 'declined'}` answer and one
`hooksEnabled: {providerId: boolean}` preference covered both. A decline on either meant a
decline on both, and `terrarium --uninstall-hooks` could not remove one while leaving the
other.

That coupling is wrong for what each write actually is. The hook entries forward tool and
turn activity, continuously, for every event Claude Code fires. The status line forwards
two numbers, once per status-line refresh, only when the session has `rate_limits`. A user
who wants the office to show their quota but does not want every tool call POSTed to a
local server (or the reverse: wants live activity but already runs a status line they will
not let Terrarium touch) had no way to say so.

## Decision

Consent is now keyed by `(providerId, subjectId)`, not `providerId` alone. `HookInstaller`
gained `readonly id: string` and its own `consentDisclosure()`; `AgentModule.hooks` is
`readonly HookInstaller[]`, not a single optional installer. Claude's module exposes two:
`hooksSubject` (id `'hooks'`) for the 12 entries, and `statusLineSubject` (id
`'statusLine'`) for the status-line slot. Each subject:

- is asked about independently, with its own headline, disclosure and action-button label
  (`consentCopy.ts`'s `CONSENT_*` constants for `hooks`, `STATUS_LINE_*` for `statusLine`);
- is installed and uninstalled through its own `mutateClaudeSettings` pass
  (`installEntries`/`uninstallEntries` vs `installStatusLineEntry`/
  `uninstallStatusLineEntry` in `claudeHookInstaller.ts`), so one subject's write can never
  touch the other subject's field in `settings.json`;
- has its own independent on-disk check (`areHooksInstalled()` vs
  `isStatusLineInstalled()`);
- has its own `hooksConsent` / `hooksEnabled` entry in `config.json`, revised on its own
  per [ADR 0001](0001-consent-choices-send-immediately-and-revise-as-absolute-state.md),
  with no effect on its sibling's entry.

`module.stageHookFiles` stays module-level: both subjects' commands run the same bundled
`claude-hook.js`, so the script is staged once before either subject installs, not once
per subject.

### Config shape and migration

`config.json`'s `hooksConsent` and `hooksEnabled` moved from `Record<providerId, value>` to
`Record<providerId, Record<subjectId, value>>`. A config written before this split used the
flat shape, with one implicit write per provider corresponding to the hook entries. On
read, `parseHooksConsent` / `parseHooksEnabled` detect a bare `'granted' | 'declined'` (or
boolean) value and migrate it onto the `hooks` subject, the one subject that existed under
the old shape. `statusLine` is never migrated onto: it starts unanswered for every existing
install, since nobody could have answered a question that did not yet exist, and it is
asked for on the next `webviewReady` handshake like any other unanswered subject.

### Grandfathering generalizes per subject

Before the split, a `hooks` entries already on disk with no recorded consent (a pre-consent
install, or hand-edited `settings.json`) was granted silently at startup rather than asked
about again, because that install only ever removes events on reinstall and has nothing new
to disclose. That rule now applies per `(provider, subject)`: a `statusLine` a pre-split
build of Terrarium already chained is granted silently too, on the same logic, since it is
already running with the same disclosure the current build would give. A subject that was
never on disk and never answered is still asked, in full, through the normal UI path.

### Startup and uninstall loop over subjects

`installHooksOnStartup` iterates a module's `hooks` array and gates each subject
independently on its own persisted preference and its own one-time grant. `terrarium
--uninstall-hooks` iterates every module's every subject, uninstalling and persisting a
decline only once that subject's own on-disk state agrees, and failing non-zero if any
subject's uninstall did not land, exactly as the single-subject version did for its one
subject.

## Considered options

- **Keep one consent, split only the UI copy** — disclose both effects in one dialog but
  let an uninstall remove only what changed. Rejected: the stranding bug ADR 0001 exists to
  prevent (a persisted preference disagreeing with the actual on-disk write) would come
  back the moment the two writes could partially fail, and a user who declines would still
  lose the entries they wanted.
- **A `statusLine: boolean` flag beside the single consent, not a second full subject** —
  rejected because it cannot express "status line granted, hooks declined" as a persisted,
  revisable answer, and it would need its own copy of the install-state-vs-preference
  bookkeeping anyway, just not generalized.
- **Leave status line consent-free, gated only by the hooks grant** — the shipped behavior
  before this change. Rejected on its own terms: it already produced support confusion
  from users who declined hooks for activity-privacy reasons and were surprised a status
  line swap happened anyway.

## Consequences

- **`HookInstaller` is now a per-subject contract**, not a per-module one. A module that
  only ever had one subject (every CLI besides Claude today) still returns a one-element
  `hooks` array; nothing about the array shape privileges Claude.
- **Every consent-bearing wire message and config accessor grew a `subjectId` parameter.**
  `hooksConsentRequest`, `applyConsentChoice`, `getHooksEnabled`/`setHooksEnabled`,
  `findHookSubject` (new, alongside the existing module-level `findHookModule`). None of
  this is optional: a caller that forgets the subject cannot express "which write".
- **The Intro asks up to two questions per module now**, `hooks` first, then `statusLine`,
  rather than one. A user who answers the first sees the second immediately after, still
  inside the same four-step tour: no new step was added, the existing consent step repeats
  once per unanswered subject.
- **A fresh install with Claude hooks enabled by default still shows one quota-relevant
  ask more than it used to**, for anyone who wants quota readings. That is the point: the
  old behavior silently took the status line as a side effect of answering a question about
  activity tracking.
