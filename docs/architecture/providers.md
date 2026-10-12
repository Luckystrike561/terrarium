# Provider modules

`core/src/provider.ts` is the integration boundary between Terrarium's runtime and the tools it watches. There are three kinds of module, and any combination of them can run in one process.

## Agent modules

`AgentModule` (`kind: 'agent'`), one per agent CLI: Claude Code plus the 21 modules under `server/src/providers/<cli>/`. It owns that CLI's vocabulary (`formatToolStatus`, `permissionExemptTools`, `subagentToolNames`, `readingTools`, `contextWindowForModel`) and how to read it:

- `hooks: HookInstaller` when it writes hooks into the CLI's settings. That write is consent-gated, see [consent.md](consent.md).
- `start(host)` when it discovers sessions on its own. It returns a `RunningAgentModule`: `followSession(ref)` takes over a session a multiplexer found, `sessionInDirectory(cwd)` binds a pane with no ref, `receiveHook(payload)` takes what the CLI POSTs to `/api/hooks/<id>` (absent = no hook API), `setHooksEnabled(enabled)` carries the hooks preference, `restoreSession(session)` resumes a persisted session after a restart, and `dismissSession(sessionId)` stops reporting a session whose character the user closed. `protocolVersion` is 2.

The Claude module supports every transcript and hook format up to **Claude Code v2.1.220** (current as of 2026-07-30): Task-era `agent_progress` records, explicit and implicit teams, background-by-default Agent spawns, sidecar-backed background agents. Newer CLI releases may add formats that need module updates. Its team handling is in [claude-teams.md](claude-teams.md).

## Multiplexer modules

`MultiplexerModule` (`kind: 'multiplexer'`), one per multiplexer: herdr. `connect(endpoint, watcher)` watches one server (a `MultiplexerEndpoint`: a `local` socket or an `ssh` target, optional session) and reports:

- its link state: `connecting`, `connected`, `reconnecting` or `error` with the error text.
- every live agent as a `MultiplexedAgent`: pane id, agent kind (an agent module id), status level (working, blocked, idle), cwd, name, task, session ref.

It never parses a transcript. herdr's `agent_session` is a transcript path for pi and omp (`kind: 'path'`, compared by real path) and the CLI's own session id for every other integration. Amp, Kiro 2, Maki, Gemini CLI and Cline report none.

`MultiplexerConnections` runs one `MultiplexerFeed` per enabled connection. The feed does the diffing, naming, hand-over and status mapping. herdr keeps a pane's `agent` after the agent exits, so the bridge drops panes whose title is a shell prompt (`user@host:path`).

## Quota sources

A quota meter is one account-level limit (Claude's 5-hour window, a monthly credit), shown in the office as coffee beans. Two kinds of code report meters, and both reach the same place:

- **An agent module** that sees its provider's quota calls `reportQuota(reading)` on its `ModuleHost`. Claude does: its status line forwards Claude Code's `rate_limits` to `/api/hooks/claude`, and `claudeQuota.ts` turns them into the `five_hour`, `seven_day` and (behind a Claude apps gateway) `spend_limit` meters.
- **A `QuotaSourceModule`** (`kind: 'quota'`) for a provider that runs no agent CLI here. `start(host: QuotaHost)` reads the quota however it can (poll or push is its choice) and calls `host.reportQuota`.

A `QuotaReading` is `meterId`, `label`, `usage` (`{kind: 'fraction', usedFraction}` or `{kind: 'amount', usedAmount, limitAmount, unit, usedFraction?}`, or `null` when the source cannot read the meter), optional `resetsAt`, `observedAt` and `staleAfterMs`. An amount carries the provider's own `usedFraction` when the two are read at different times: Claude Code refreshes a gateway's dollars only about every five minutes, while `used_percentage` comes with every response, so the jar follows the percentage and the tooltip still shows the dollars. `QuotaBoard` (`server/src/quotaBoard.ts`) keeps the latest reading per `<providerId>:<meterId>`, drops readings with NaN or negative figures, normalizes amounts without a share of their own to a share, and broadcasts the whole board as `quotaUpdate` on every reading and again the moment one goes stale (`observedAt + staleAfterMs`, or `resetsAt` when that comes first). Clients get the board on connect too. It knows no provider.

**Ollama Cloud is deferred.** Ollama has no usage API, the only documented scraper parses the legacy session and weekly percentages from `ollama.com/settings` rather than the current plans' monthly dollar credits, and scraping means storing the user's login cookie. A `QuotaSourceModule` can add it once an official endpoint exists.

## Enabled modules

Enabled modules come from `~/.terrarium/config.json` `modules` (default `['claude']`), set by `--provider <ids>`. The server builds its runtime from `loadEnabledModules()`. An unknown id is a `--provider` error, and a warning (never a silent default) when it is in the config file.

`startModules` starts every agent module with a `start` the same way (Claude included), hands each its hooks preference, then the persisted agents (each to its module's `restoreSession`), then the quota source modules, then the multiplexer connections. The runtime holds no transcript, hook or team logic of any CLI.

## Routing

`POST /api/hooks/:providerId` goes to that running module's `receiveHook` and no other. Claude normalizes the payload with its own `normalizeHookEvent` and routes it on its private state. Every module emits already-normalized events through its `ModuleHost`. An agent's `providerId` is always set: the module that announced it, replaced by the first agent module that reports it, so per-agent behaviour (status text, sub-agent tools) comes from the right CLI. Multiplexer events never reach a module's heuristics: Claude's `hookDelivered` lives in its own state and only its own hooks set it.

`AgentEvent.kind` values, in three groups. **Lifecycle**: `sessionStart` (`live` puts the character on screen at once, `folderName` and `team` set what it starts with), `sessionEnd`, `sessionInfo`. **Coarse activity**, from a source that only sees the turn coarsely: `toolStart`, `toolEnd`, `turnEnd`, `working`, `permissionRequest`. **Presentation**, from a module that tracks the turn itself: `toolShown`, `toolDone`, `toolsCleared`, `statusChanged`, `permissionShown`, `permissionCleared`, `subagentToolShown`, `subagentToolDone`, `subagentPermissionShown`, `subagentCleared`, `teamChanged`, `contextUsage`. The runtime dispatches on `kind`, never on CLI-specific tool names.

## One agent, one character

Every module announces a session with `sessionStart.sessionRef`: the session's transcript path, or the CLI's own session id where that is what its multiplexer integration reports.

- A session whose ref an existing agent already reports joins that agent (`claimBySessionRef`) instead of creating a second character. A bare Claude `transcriptPath` only matches module-announced agents, so Claude-vs-Claude routing is unchanged.
- A session store module keys its sessions in exactly the form herdr reports for that CLI (`jsonlSessionStore`'s `sessionIdOf`, or the SQLite row id), so the pane and the module's own discovery meet on one key.
- A pane herdr reports no ref for is bound to the module's one live session in the pane's cwd (`RunningAgentModule.sessionInDirectory`), never guessed when several share it.
- `MultiplexerFeed` announces each pane as `<multiplexer>-<connection>-<pane>`, since pane ids are only unique within one herdr server. When the agent module for the pane's kind runs, it takes the session over and reports the turn lifecycle and tools from the transcript, while the multiplexer adds the name, task and pending approvals (`blocked`).
- With no such module, the pane's status level is all there is and is reported in full: `working` becomes the `working` event, `blocked` becomes `permissionRequest`, `idle` becomes `turnEnd`.
- Claude's `followSession` resolves herdr's Claude session id to `<projects>/<dir>/<id>.jsonl` (retrying until Claude creates it) and adopts it like any external session, with `hookDelivered` off so the heuristic timers end its turns until a hook arrives. Its `sessionStart` carries the same session id, so the pane's character takes it over. It ends with the pane.
- A transcript an agent already watches stays with that agent and its own lifecycle.

## Agent info

`agentInfo { id, name?, task? }` lets a module rename a character (replacing `folderName`) and attach a one-line task, shown in the hover and selected overlay. The herdr module sends it from herdr's workspace label (plus `#<tab>` when a workspace hosts several agents) and the pane's terminal title.

## Adding a provider module

Adding an agent CLI, a multiplexer or a quota source is one subdirectory under `server/src/providers/<id>/` plus one registry entry. It needs no change to the runtime, the UI, or any existing module.

### Agent module (a new CLI)

1. Create `server/src/providers/<id>/<id>.ts` exporting `<id>Module: AgentModule` (use `satisfies AgentModule` when it always has `hooks`, so callers see them), plus `constants.ts` for its magic numbers. Implement the vocabulary members. Then pick how it learns about sessions:
   - **Hooks**: `hooks: HookInstaller` (`installHooks`, `uninstallHooks`, `areHooksInstalled`, `consentDisclosure`, optional `stageHookFiles(packageRoot)` for scripts the entries run), and `RunningAgentModule.receiveHook(payload)` for what the CLI POSTs to `/api/hooks/<id>` (normalize the payload inside the module).
   - **Its own discovery** (transcripts, a database): `start(host)` returning a `RunningAgentModule`. Build it from `providers/sessionStore/`: `new SessionStoreTracker(host, store, DEFAULT_SESSION_STORE_TIMING)` over `jsonlSessionStore` (append-only JSONL), `jsonDocumentSessionStore` (whole-file JSON) or `sqliteSessionStore` (one SQLite file), with a format mapping the CLI's records to `working`, `toolStart`, `toolEnd`, `turnEnd`, `permissionRequest` and `sessionEnd` where the CLI really records them. Key sessions in the form herdr's `agent_session.value` takes for the CLI (the path for pi and omp, the CLI's session id otherwise). The tracker never replays history (cursors open at the end and only the tail decides the starting state), keeps one reader per session refcounted between discovery and follows, and drops sessions untouched for the active window.
2. Add it to `agentModules` in `server/src/providers/index.ts`. Its id is also the `agentKind` a multiplexer reports for its panes, so herdr panes running it light up with tool activity.
3. Add what its sessions show (tool activity, turn ends, approvals, clean exit) to `AGENT_COVERAGE` in `scripts/build-site.ts`, or the website build (`npm run site:build`) fails.
4. Tests go in `server/__tests__/`. `providerModules.test.ts` shows how to run a module against a temp home with fake timers.

### Multiplexer module

Create `server/src/providers/<id>/<id>.ts` exporting `<id>Module: MultiplexerModule`, then add it to `multiplexerModules` and give it a `MULTIPLEXER_SUMMARY` entry in `scripts/build-site.ts`.

- `connect(endpoint, watcher)` reports full snapshots of live agents and its link state. An agent missing from a snapshot has ended. An unanswered poll must not report an empty list.
- `probe(endpoint)` does one round-trip. Adding a connection probes it before saving.

### Quota source module

Create `server/src/providers/<id>/<id>.ts` exporting `<id>Module: QuotaSourceModule`, plus `constants.ts` for its poll interval and stale threshold, then add it to `quotaSourceModules`. `--provider <id>` enables it like any other module. It needs no change to the runtime, the protocol or the office: report `usage: null` when the source cannot read the meter (missing credentials, an expired session), never a zero. A source that holds a credential stores it under `~/.terrarium/` with mode 0600, never sends it over `/ws`, and never logs it. An agent module reports its provider's quota through its existing `ModuleHost.reportQuota` instead.

### Consent

A module that writes into any file outside `~/.terrarium/` must do it through `hooks: HookInstaller`. The consent gate then asks once per such module with its own `consentDisclosure()`, and the server installs, migrates and uninstalls it through the same generic paths: no module id appears in `cli.ts` or `clientMessageHandler.ts`. A module that only reads (omp, herdr) has no `hooks` and is never part of a consent ask. See [consent.md](consent.md).
