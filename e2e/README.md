# Pixel Agents e2e tests

Playwright end-to-end tests for the `npx pixel-agents` standalone server, driven in Chromium against a mocked `claude`. This README is the single source of truth for what's e2e-tested, what's not, and how to run the suite.

## What this suite covers

Behavioral overview by area. Each area corresponds to a `test.describe` block in the spec files, an `@area:` tag on each test title, and an Allure `epic` label.

### Spawn paths (`@area:spawn`)

Agents being created and adopted. Covers external Claude sessions adopted by the hook server or the JSONL scanner, basic Task subagent appearance/despawn, and lead+teammate routing for inline and tmux team modes.

### Lifecycle regressions (`@area:lifecycle`)

Edge cases that historically caused agent-character desync: `/clear`, `--resume`, X-button close, dismissal cooldown, parallel sub-agents, teammate add/remove, rapid `/clear` followed by a new tool, late resume after stale cleanup.

### Cross-cutting checks (`@area:cross-cutting`)

Invariants that should hold across every spawn path: tool status text matches the active tool name, sound chimes fire on the right events, restored agents skip the matrix spawn animation, the first-run consent gate, hook installer preserves third-party hooks, settings persist across a page reload, sub-agent permission timer fires.

### Teams routing (`@area:teams`)

Lead and teammate tool routing in both inline and tmux team modes, plus background spawns that become teammates or stay sub-agents.

### Hooks-off matrix (`@area:matrix`)

Every team mode (basic, inline teammate, tmux teammate) re-verified against the heuristic JSONL-polling path with hooks disabled. Confirms the polling-based detection produces the same agent state as the hook-driven path.

### Standalone server (`@area:standalone`)

Server-level behavior: hook-driven lifecycle propagates into the browser SPA via the single `/ws` WebSocket endpoint, the token-gated consent path, the herdr provider, and the connection indicator.

### Pet system (`@area:pets`)

The animated pets feature, which has no hook dependency. Pet sprites load and the `petSpritesLoaded` broadcast arrives; a pet seeded into `~/.pixel-agents/layout.json` loads into the office and survives a page reload; clicking a pet shows a heart bubble that auto-dismisses and dismisses again on re-click. Pets render only on the canvas, so live state is read through the `getPets` / `petClick` e2e test hooks. FSM internals, pathfinding, FOLLOW, z-sort, and legacy-layout migration are covered by webview unit tests, not e2e.

## What's NOT covered (gaps + deferred)

Scenarios that exist as product behavior but are not in the automated suite. PRs that close a gap should remove the corresponding row.

| Scenario                                                                                 | Why not automated                                                                                                                                                                                                           | Tracked                      |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Bypass-permissions startup flag                                                          | Security-sensitive; manual review path                                                                                                                                                                                      | none                         |
| Hooks-off `/clear` or `/resume` reassigning the same character                           | Not a product behavior: without hooks the server has no signal tying the new transcript to the old session, so the new file is adopted as a new character. With hooks on, `SessionEnd`/`SessionStart` reassign it (covered) | none                         |
| Multiple servers editing one `layout.json` live                                          | Each server reads `layout.json` on connect; there is no live cross-server layout sync to test                                                                                                                               | none                         |
| Producer/viewer relay scenarios (multi-viewer replay, producer reconnect reconciliation) | Producer endpoint not yet built                                                                                                                                                                                             | `feat/producer-viewer-split` |

## Pre-release manual smoke (~30 min)

CI green on this suite is the safety net for behavioral regressions. The checks below are what e2e can't meaningfully assert on (visual polish, real-Claude integration, other browsers). Run them before tagging a release, not on every PR.

**Visual + interactive polish** (after any change touching `sceneRenderer.ts`, `textureCache.ts`, `colorize.ts`, `*.tsx`, or CSS):

- Spawn 3+ agents: matrix spawn animation renders cleanly, characters move smoothly between seats and z-sort correctly against chairs and desks.
- Hover and click characters: overlay text positioning is correct, selection outline crisp, click on a seat reassigns.

**Real Claude Code integration** (mock-claude is a fixture; real Claude's JSONL has edge cases the mock doesn't):

- `node dist/cli.js` (or `npx pixel-agents` after publish), open the printed URL, run a real Claude session in a terminal with a few tool-heavy turns and a permission-requiring tool. Watch for character desync, missing animations, stuck permission bubbles.
- Use a session with a large pasted image (multi-MB base64 user message): confirm the "Possible format issue" warning doesn't false-fire and tool tracking still works.
- Test with one MCP server installed: confirm `mcp_progress` records don't break tool status.

**Other browsers** (e2e covers Chromium only):

- Open the printed URL in Firefox AND Safari: characters appear and animate via WebSocket.
- Refresh the browser mid-session: WebSocketTransport reconnects, agents reappear from server state.

**First-run experience** (before publishing):

- Delete `~/.pixel-agents/` entirely. Start the server fresh: default layout loads, the Intro runs and asks for hook consent, no console errors.

**Platform sanity** (CI hosts ≠ your machine):

- On the OS you primarily develop on, run a normal session for ~5 minutes: no surprise CPU spikes, no leaked file watchers, a page reload doesn't lose state.

## Running

```bash
cd pixel-agents
npm run compile && npm run e2e               # full suite

npm run e2e -- --grep "@area:spawn"          # filter by area tag
npm run e2e -- --grep "@area:cross-cutting"
npm run e2e -- --headed                      # watch Chromium

npm run e2e:inventory                        # regenerate the inventory section below
npm run test:report                          # build the Allure dashboard from latest run
npm run test:report:open                     # serve + open the Allure dashboard in a browser
```

## Mocking model & rules

E2E tests drive Pixel Agents through a Claude-like **process boundary**, not by poking internals. The mocked `claude` (`e2e/fixtures/mock-claude` → `mock-claude-runner.cjs`) behaves like the real CLI for the parts Pixel Agents observes: it spawns as a process, creates its own append-only JSONL transcripts, and executes the installed hook script under `~/.pixel-agents/hooks`, the same path the real CLI uses. Every agent is an external session the server adopts, spawned with `spawnExternalClaudeScenario`. The builder API itself (`claudeScenario(...)`, `.at()`, `.appendJsonl()`, `.emitHook()`, `.holdOpenFor()`) is documented in CONTRIBUTING.md → "Mock claude".

Rules for a correct test:

- **Drive behavior through a scenario, not by hand.** Define timed actions with the `claudeScenario(...)` builder and let the mock perform them. Don't hand-write transcript files or hand-fire hooks inside a scenario-driven test body.
- **Transcripts are append-only.** Existing JSONL lines are never mutated in place; new records appear later in the stream. Scenarios model this with timed `.appendJsonl(...)` steps.
- **Assert only on Playwright-visible outcomes**: agent overlays, character state, sound hooks. Never on the mock's internals. The mock never decides pass/fail.
- **Direct hook POSTs are the one exception.** `standalone/hooks.spec.ts` and `standalone/ui.spec.ts` exercise the server's hook endpoint itself, so they POST to it directly via `sendHookEvent`. Every agent-lifecycle test must use the scenario builder.

## What to read before adding a test

- `CLAUDE.md`: architecture and message protocol
- `e2e/fixtures/standalone.ts` and `e2e/helpers/standalone.ts`: fixture lifecycle and seed options
- `e2e/helpers/`: every helper, especially `hooks.ts`, `mock-claude.ts`, `office.ts`, `webview.ts`

When you add a new test:

- Pick a `test.describe` block that matches an existing `@area:` tag, OR add a new area to the "What this suite covers" section above and pick a tag.
- Add `@area:<tag>` to the test title.
- Add Allure `epic` / `feature` / `story` labels matching the area.
- Run `npm run e2e:inventory` and commit the regenerated section.

When you remove a test:

- Run `npm run e2e:inventory` so the inventory drops it.
- If the scenario it tested is now manual or deferred, add a row to "What's NOT covered".

## Narration

Tests call `narrator.step('…')` before an action and `narrator.check('…')` after an assertion resolves (the `standalone` fixture exposes `narrator`). Shared helpers narrate universal moments (spawning or closing an agent) via the module-level `narrate` in `helpers/test-narration.ts`. Each line goes to `<tmpHome>/.claude-mock/test-narration.log`, and every external mock session's own stdout goes to `<tmpHome>/.claude-mock/external-narration.log`. A failing test gets both attached, next to the server log, the debug log, the webview message log and a screenshot.

**Cosmetic-only contract (never violate):** Pixel Agents never reads these logs, so narration cannot change what a test exercises. Narration must **never carry an assertion, gate logic, or affect timing**. Deleting every `step`/`check` call must leave all tests passing. Never call the narrator from inside a browser-context callback (`page.waitForFunction`/`evaluate`/`.poll`): it is Node-side only.

## Test inventory

This section is auto-generated. Do not edit between the markers; CI fails on drift.

<!-- BEGIN:E2E-INVENTORY -->

68 tests total. Generated by `scripts/generate-e2e-inventory.mjs`. Re-run after adding or removing tests.

### `@area:spawn` (2 tests)

- `e2e/claude/hooks-on/basic.spec.ts:27` — external session spawns agent and Task subagent appears then despawns (Hooks ON / spawn paths)
- `e2e/claude/hooks-on/basic.spec.ts:99` — external Claude session adopted via hook confirmation lifecycle (Hooks ON / spawn paths)

### `@area:lifecycle` (17 tests)

- `e2e/claude/hooks-off/lifecycle.spec.ts:36` — heuristic late --resume after stale cleanup prevents zombie agents (Hooks OFF / lifecycle)
- `e2e/claude/hooks-off/lifecycle.spec.ts:93` — three parallel Task subagents in one turn render distinct sub-characters via polling (Hooks OFF / lifecycle)
- `e2e/claude/hooks-off/lifecycle.spec.ts:156` — inline teammate removed from team config disappears within one second via polling (Hooks OFF / lifecycle)
- `e2e/claude/hooks-off/lifecycle.spec.ts:217` — close via X prevents re-adoption of old JSONL during dismissal cooldown via polling (Hooks OFF / lifecycle)
- `e2e/claude/hooks-off/lifecycle.spec.ts:284` — external basic subagent with run_in_background but no teamName routes to basic path (Hooks OFF / lifecycle)
- `e2e/claude/hooks-on/lifecycle.spec.ts:73` — /clear reassigns the same character to the new JSONL (Hooks ON / lifecycle)
- `e2e/claude/hooks-on/lifecycle.spec.ts:148` — /resume reassigns the same agent within the grace window (Hooks ON / lifecycle)
- `e2e/claude/hooks-on/lifecycle.spec.ts:228` — /clear edge case with a sibling agent in the same projectDir (Hooks ON / lifecycle)
- `e2e/claude/hooks-on/lifecycle.spec.ts:321` — --resume after the grace window expires cleans up the old agent (Hooks ON / lifecycle)
- `e2e/claude/hooks-on/lifecycle.spec.ts:402` — three parallel Task subagents in one turn render distinct sub-characters (Hooks ON / lifecycle)
- `e2e/claude/hooks-on/lifecycle.spec.ts:472` — inline teammate removed from team config disappears within one second (Hooks ON / lifecycle)
- `e2e/claude/hooks-on/lifecycle.spec.ts:535` — lead SessionEnd cascade-removes active inline teammates (Hooks ON / lifecycle)
- `e2e/claude/hooks-on/lifecycle.spec.ts:617` — external basic subagent with run_in_background routes to basic path (Hooks ON / lifecycle)
- `e2e/claude/hooks-on/lifecycle.spec.ts:682` — lead permission_prompt routes bubble to teammate not lead when teammates exist (Hooks ON / lifecycle)
- `e2e/claude/hooks-on/lifecycle.spec.ts:767` — TeammateIdle marks only the targeted teammate done and leaves lead unchanged (Hooks ON / lifecycle)
- `e2e/claude/hooks-on/lifecycle.spec.ts:877` — rapid /clear then new tool within 500ms lands on the reassigned agent (Hooks ON / lifecycle)
- `e2e/claude/hooks-on/lifecycle.spec.ts:949` — close via X prevents re-adoption of old JSONL during dismissal cooldown (Hooks ON / lifecycle)

### `@area:cross-cutting` (18 tests)

- `e2e/claude/hooks-off/lifecycle.spec.ts:328` — agentToolsClear fires at turn end via turn_duration JSONL record (Hooks OFF / lifecycle)
- `e2e/claude/hooks-off/lifecycle.spec.ts:381` — heuristic permission timer is cancelled when an agent is closed via overlay (Hooks OFF / lifecycle)
- `e2e/claude/hooks-off/lifecycle.spec.ts:449` — sub-agent permission bubble fires on stalled non-exempt sub-tool via heuristic timer (Hooks OFF / lifecycle)
- `e2e/claude/hooks-on/consent.spec.ts:121` — fresh install: the Intro pages to the disclosure and Install writes the hooks (Hooks consent gate)
- `e2e/claude/hooks-on/consent.spec.ts:208` — Not Now writes nothing, continues the tour, and leaves consent ungranted (Hooks consent gate)
- `e2e/claude/hooks-on/consent.spec.ts:233` — Don't Ask Again writes nothing and persists hooks off (Hooks consent gate)
- `e2e/claude/hooks-on/consent.spec.ts:259` — the close x aborts the tour and writes nothing, exactly like Not Now (Hooks consent gate)
- `e2e/claude/hooks-on/consent.spec.ts:289` — Back from the closing step lets Don't Ask Again undo a landed install (Hooks consent gate)
- `e2e/claude/hooks-on/consent.spec.ts:323` — Back after Don't Ask Again lets Not Now bring the ask back (Hooks consent gate)
- `e2e/claude/hooks-on/consent.spec.ts:371` — a failed install is reported, and Not Now brings the ask back (Hooks consent gate › when settings.json cannot be parsed)
- `e2e/claude/hooks-on/consent.spec.ts:418` — clicking the office around the bubble neither answers nor dismisses (Hooks consent gate)
- `e2e/claude/hooks-on/consent.spec.ts:456` — a pre-consent 14-event install migrates to 12 with no prompt (Hooks consent gate / pre-consent install)
- `e2e/claude/hooks-on/lifecycle.spec.ts:1044` — done sound chime fires on agentStatus waiting (Hooks ON / lifecycle)
- `e2e/claude/hooks-on/lifecycle.spec.ts:1126` — restored agents skip the matrix spawn animation (Hooks ON / lifecycle)
- `e2e/claude/hooks-on/lifecycle.spec.ts:1215` — tool status text matches every PreToolUse tool name (Hooks ON / lifecycle)
- `e2e/claude/hooks-on/lifecycle.spec.ts:1304` — permission sound chime fires on agentToolPermission (Hooks ON / lifecycle)
- `e2e/claude/hooks-on/lifecycle.spec.ts:1402` — pixel-agents hook is installed in settings.json on server startup (Hooks ON / lifecycle)
- `e2e/claude/hooks-on/lifecycle.spec.ts:1424` — permission bubble auto-clears when a fresh PreToolUse arrives (Hooks ON / lifecycle)

### `@area:teams` (5 tests)

- `e2e/claude/hooks-on/teams.spec.ts:61` — new-harness background agent becomes a named teammate character (Hooks ON / teams)
- `e2e/claude/hooks-on/teams.spec.ts:162` — unnamed background spawn stays a sub-agent with live activity and survives Stop (Hooks ON / teams)
- `e2e/claude/hooks-on/teams.spec.ts:243` — named background spawn becomes a teammate and badges the spawner LEAD (Hooks ON / teams)
- `e2e/claude/hooks-on/teams.spec.ts:317` — external session lead with inline teammate routes tools to teammate (Hooks ON / teams)
- `e2e/claude/hooks-on/teams.spec.ts:385` — external session lead with tmux teammate routes tools to teammate (Hooks ON / teams)

### `@area:matrix` (3 tests)

- `e2e/claude/hooks-off/matrix.spec.ts:46` — external basic spawn adopted via JSONL polling (Hooks OFF / matrix)
- `e2e/claude/hooks-off/matrix.spec.ts:86` — external inline teammate adopted via JSONL polling (Hooks OFF / matrix)
- `e2e/claude/hooks-off/matrix.spec.ts:140` — external tmux teammate adopted via JSONL polling (Hooks OFF / matrix)

### `@area:standalone` (11 tests)

- `e2e/standalone/herdr.spec.ts:94` — herdr: one character per live pane, named by workspace and tab, task read from the title (Standalone / herdr provider)
- `e2e/standalone/herdr.spec.ts:162` — herdr: a shell-prompt title never creates a character, and a live agent is removed when it returns to the shell (Standalone / herdr provider)
- `e2e/standalone/herdr.spec.ts:209` — herdr: a terminal title change updates the task text (Standalone / herdr provider)
- `e2e/standalone/herdr.spec.ts:249` — herdr + omp: a pane running omp shows omp tool activity, never replays history, and goes idle at turn end (Standalone / herdr provider)
- `e2e/standalone/herdr.spec.ts:309` — herdr + omp: an omp session omp and herdr both report is one character, and one outside herdr renders too (Standalone / herdr provider)
- `e2e/standalone/hooks.spec.ts:16` — propagates hook-driven lifecycle into the browser UI (Standalone / hooks)
- `e2e/standalone/hooks.spec.ts:130` — an untokened spectator page never sees the consent dialog (Standalone / hooks consent)
- `e2e/standalone/hooks.spec.ts:156` — declining the first-run Intro installs nothing (Standalone / hooks consent)
- `e2e/standalone/omp.spec.ts:34` — omp: a running session appears with its tool activity and goes idle when its turn ends, with no herdr (Standalone / omp provider)
- `e2e/standalone/ui.spec.ts:16` — closeAgent despawns the character (Standalone / UI)
- `e2e/standalone/ui.spec.ts:44` — ConnectionIndicator appears when the WebSocket connection drops (Standalone / UI)

### `@area:areas` (3 tests)

- `e2e/claude/hooks-off/areas-multiroot.spec.ts:111` — an agent for the MAPPED folder takes a seat inside its area (Areas (folder-mapped agents))
- `e2e/claude/hooks-off/areas-multiroot.spec.ts:136` — an agent for an UNMAPPED folder is not forced into the area (Areas (folder-mapped agents))
- `e2e/claude/hooks-off/areas.spec.ts:30` — seeded areas + areaTiles load into the office (Areas (no agent folders) › seeded area data)

### `@area:carpet` (6 tests)

- `e2e/claude/hooks-off/carpet.spec.ts:26` — carpet sprites load and broadcast to the webview (Carpet)
- `e2e/claude/hooks-off/carpet.spec.ts:53` — seeded carpetTiles load into the office (Carpet › seeded carpet tiles)
- `e2e/claude/hooks-off/carpet.spec.ts:88` — junction case reflects just the NW neighbor (Carpet › autotiling: a single neighbor)
- `e2e/claude/hooks-off/carpet.spec.ts:118` — junction case reflects NW + NE neighbors (Carpet › autotiling: two neighbors)
- `e2e/claude/hooks-off/carpet.spec.ts:147` — junction case is fully set when all four corners are present (Carpet › autotiling: fully surrounded)
- `e2e/claude/hooks-off/carpet.spec.ts:196` — a seeded carpet coexists with furniture on the same tile (Carpet surface placement (seeded))

### `@area:pets` (3 tests)

- `e2e/claude/hooks-off/pets.spec.ts:58` — pet sprites load and broadcast to the webview (Pets)
- `e2e/claude/hooks-off/pets.spec.ts:77` — loads from the seeded layout and survives a page reload (Pets › a seeded pet)
- `e2e/claude/hooks-off/pets.spec.ts:100` — clicking a pet shows a heart bubble that auto-dismisses and dismisses on re-click (Pets › a seeded pet)

<!-- END:E2E-INVENTORY -->

## Coverage philosophy

We do not measure e2e via code coverage (too noisy, doesn't map to user-observable scenarios). Coverage is tracked by:

1. **The inventory section above** — every test in the suite with its area tag and file:line.
2. **The "What's NOT covered" gap list** — deliberately maintained; closing a gap removes the corresponding row.
3. **Allure dashboard** — `epic` / `feature` / `story` labels group tests by area without needing this file. Run `npm run test:report` after a suite run, then open `allure-report/allure/index.html` → Behaviors view.
