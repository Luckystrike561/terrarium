# Testing

Three tiers, each with its own framework. The commands are in `CLAUDE.md` and `CONTRIBUTING.md`.

## Server unit and integration (Vitest)

`server/__tests__/` covers the shared runtime, persistence, providers, the HTTP and WebSocket server, the CLI and the e2e scenario runner. Representative suites:

| File                                  | Coverage                                                                                                                                             |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agentStateStore.test.ts`             | Mutations, EventEmitter events, snapshot                                                                                                             |
| `agentEventHandler.test.ts`           | Event application: pending/live sessions, sessionRef joins, providerId, coarse and presentation events                                               |
| `agentRuntime.restorePalette.test.ts` | Restore through the module: persisted id/palette, leads first, gone sessions dropped, dispose keeps the persisted list                               |
| `claudeHookHandler.test.ts`           | Claude hook routing on the module's private state: buffering, pending adoption, `/clear`, team gating                                                |
| `claudeRunningModule.test.ts`         | The running Claude module against a fake host: adoption, presentation events, teammates, restore, dismiss                                            |
| `claudeBackgroundLifecycle.test.ts`   | Named background teammates through the runtime: LEAD badge, removal on completion, restart restore                                                   |
| `claudeFileWatcherDismissal.test.ts`  | `DismissalTracker` integration                                                                                                                       |
| `inlineTeammates.test.ts`             | Inline-teammate helpers                                                                                                                              |
| `claude.test.ts`                      | `normalizeHookEvent` per Claude event, module shape                                                                                                  |
| `claudeHookInstaller.test.ts`         | Atomic install and uninstall, unparseable-file and non-array abort, throwing writes, mode preservation, backup, hook identity, event-scope migration |
| `consentFlow.test.ts`                 | In-app consent over the wire: who is asked, what each answer writes, Back-and-revise semantics, answer serialization                                 |
| `claude-hook.test.ts`                 | Spawned hook script integration (needs `dist/hooks/claude-hook.js`, so build first)                                                                  |
| `providerModules.test.ts`             | The three module configurations end to end                                                                                                           |
| `server.test.ts`                      | HTTP lifecycle, auth, `/ws`, broadcast                                                                                                               |
| `httpServerWs.test.ts`                | The `/ws` gate: same-origin connection, `?token=` privilege                                                                                          |
| `mockClaudeRunner.test.ts`            | E2E scenario runner sanity                                                                                                                           |

`server/__tests__/fakeHerdr.ts` is a fake herdr socket server shared by the herdr suites.

## Webview unit (Vitest, Node runner)

`webview-ui/test/` covers office state, layout serialization, seating, the iso sort, the fitted view, the backdrop, the Intro tour reducer, assets and Vite/browser wiring. Logic under test is kept DOM-free (for example `introTourState.ts`, `seatPlacement.ts`, `matrixEffectState.ts`, `officeCanvasCursor.ts`) so it runs in Node.

E2E is preferred over webview unit tests for user-facing behaviour. Contributors change webview internals constantly, and unit tests on internals would make them update those tests on top of feature work. E2E pins user-facing behaviour, which is stable across internal refactors.

## End-to-end (Playwright)

`e2e/` contains Playwright tests against a standalone Fastify server, Chromium only. The generated [e2e inventory](../../e2e/README.md) is the source of truth for current specs, scenarios and `@area:` coverage. Before writing a new spec, read `e2e/README.md` → "Mocking model & rules": it is normative for the process-boundary principle, the append-only transcript rule, assert-on-visible-outcomes, and the one standalone-server exception.

- **Mock claude.** Tests never invoke the real `claude`. A bash script (`e2e/fixtures/mock-claude`, with `mock-claude.cmd` for Windows) is copied into an isolated `bin/` and prepended to `PATH`. The scenario runner (`e2e/fixtures/mock-claude-runner.cjs`) plays `claudeScenario(...).at(ms).appendJsonl(record).emitHook(event).holdOpenFor(ms).build()` as timed JSONL writes and hook events.
- **Fake SSH.** `e2e/fixtures/fake-ssh.cjs` stands in for the OpenSSH client for the connections specs, and `e2e/helpers/herdr.ts` fakes a herdr server.
- **Isolation.** Each test gets its own `tmpHome`, workspace directory and mock-log file.
- **Allure labels.** The `_allureLabels` auto-fixture reads `@area:<tag>` from `testInfo.tags` and applies the matching Allure epic.
- **Inventory.** `e2e/README.md` carries a generated section between `<!-- BEGIN:E2E-INVENTORY -->` and `<!-- END:E2E-INVENTORY -->`. `npm run e2e:inventory` regenerates it.

**Reproducing slow-runner failures.** Run `npm run e2e -- --workers=1 --grep "<test>"`. For Linux fidelity, run inside `mcr.microsoft.com/playwright:v1.58.2-noble` Docker with `--cpus=2 --memory=4g` to simulate a throttled machine.

**Allure HTML report.** Viewing it via `file://` fails, because browsers block `fetch()` from local files. Use `npm run test:report:open`.

## Generated-file drift

No workflow runs the tests or the drift checks (`.github/workflows/` holds only the Docker image and website workflows). The checks run locally, and the husky `pre-push` hook enforces the two drift guarantees: it runs `npm run check-types`, regenerates `core/src/messages.ts` and the e2e inventory, and fails on any diff in either file.
