# Provider modules

`core/src/provider.ts` is the integration boundary between Terrarium's runtime and the tools it watches. There are two kinds of module, and any combination of them can run in one process.

## Agent modules

`AgentModule` (`kind: 'agent'`), one per agent CLI: Claude Code plus the 21 modules under `server/src/providers/<cli>/`. It owns that CLI's vocabulary (`formatToolStatus`, `permissionExemptTools`, `subagentToolNames`, `readingTools`, `contextWindowForModel`, optional `team`) and how to read it:

- `normalizeHookEvent` for payloads POSTed to `/api/hooks/<id>`. Absent means the CLI has no hook API.
- `hooks: HookInstaller` when it writes hooks into the CLI's settings. That write is consent-gated, see [consent.md](consent.md).
- `start(host)` when it discovers sessions on its own. It returns a `RunningAgentModule` whose `followSession(ref)` takes over a session a multiplexer found.
- The file fallback (`getSessionDirs`, `getAllSessionRoots`, `sessionFilePattern`) for transcripts in the runtime's own JSONL parser format.

The Claude module supports every transcript and hook format up to **Claude Code v2.1.220** (current as of 2026-07-30): Task-era `agent_progress` records, explicit and implicit teams, background-by-default Agent spawns, sidecar-backed background agents. Newer CLI releases may add formats that need module updates. Its team handling is in [claude-teams.md](claude-teams.md).

## Multiplexer modules

`MultiplexerModule` (`kind: 'multiplexer'`), one per multiplexer: herdr. `connect(endpoint, watcher)` watches one server (a `MultiplexerEndpoint`: a `local` socket or an `ssh` target, optional session) and reports:

- its link state: `connecting`, `connected`, `reconnecting` or `error` with the error text.
- every live agent as a `MultiplexedAgent`: pane id, agent kind (an agent module id), status level (working, blocked, idle), cwd, name, task, session ref.

It never parses a transcript. herdr's `agent_session` is a transcript path for pi and omp (`kind: 'path'`, compared by real path) and the CLI's own session id for every other integration. Amp, Kiro 2, Maki, Gemini CLI and Cline report none.

`MultiplexerConnections` runs one `MultiplexerFeed` per enabled connection. The feed does the diffing, naming, hand-over and status mapping. herdr keeps a pane's `agent` after the agent exits, so the bridge drops panes whose title is a shell prompt (`user@host:path`).

## Enabled modules

Enabled modules come from `~/.terrarium/config.json` `modules` (default `['claude']`), set by `--provider <ids>`. The server builds its runtime from `loadEnabledModules()`. An unknown id is a `--provider` error, and a warning (never a silent default) when it is in the config file.

`AgentRuntime.transcriptModule` is the enabled module declaring `getSessionDirs`: the one the runtime's own scanners, `transcriptParser.ts` and the `hooksEnabled` ref serve. `runtime.setHooksEnabled(moduleId, …)` only moves that ref for that module.

## Routing

`POST /api/hooks/:providerId` is normalized by that module and no other. In-process modules emit already-normalized events through their `ModuleHost`. An agent's `providerId` is its agent module (set by the first event from one), so per-agent behaviour (status text, sub-agent tools, team routing) comes from the right CLI. Multiplexer events never set `hookDelivered`: they must not silence the heuristics of an agent whose own module watches it.

`AgentEvent.kind` values: `toolStart`, `toolEnd`, `turnEnd`, `working`, `subagentStart`, `subagentEnd`, `subagentTurnEnd`, `progress`, `permissionRequest`, `sessionStart`, `sessionEnd`, `sessionInfo`. The runtime dispatches on `kind`, never on CLI-specific tool names.

## One agent, one character

Every module announces a session with `sessionStart.sessionRef`: the session's transcript path, or the CLI's own session id where that is what its multiplexer integration reports.

- A session whose ref an existing agent already reports joins that agent (`claimBySessionRef`) instead of creating a second character. A bare Claude `transcriptPath` only matches module-announced agents, so Claude-vs-Claude routing is unchanged.
- A session store module keys its sessions in exactly the form herdr reports for that CLI (`jsonlSessionStore`'s `sessionIdOf`, or the SQLite row id), so the pane and the module's own discovery meet on one key.
- A pane herdr reports no ref for is bound to the module's one live session in the pane's cwd (`RunningAgentModule.sessionInDirectory`), never guessed when several share it.
- `MultiplexerFeed` announces each pane as `<multiplexer>-<connection>-<pane>`, since pane ids are only unique within one herdr server. When the agent module for the pane's kind runs, it takes the session over and reports the turn lifecycle and tools from the transcript, while the multiplexer adds the name, task and pending approvals (`blocked`).
- With no such module, the pane's status level is all there is and is reported in full: `working` becomes the `working` event, `blocked` becomes `permissionRequest`, `idle` becomes `turnEnd`.
- The transcript module (Claude) has no `start()`, because its transcripts are parsed by the runtime. `startModules` registers a `TranscriptFollower` in its place. It resolves herdr's Claude session id to `<projects>/<dir>/<id>.jsonl` (retrying until Claude creates it) and adopts it like any external session, with `hookDelivered` off so the heuristic timers end its turns until a hook arrives. A pane character already on screen gets the transcript attached instead. It ends with the pane.
- A transcript an agent already watches stays with that agent and its own lifecycle.

## Agent info

`agentInfo { id, name?, task? }` lets a module rename a character (replacing `folderName`) and attach a one-line task, shown in the hover and selected overlay. The herdr module sends it from herdr's workspace label (plus `#<tab>` when a workspace hosts several agents) and the pane's terminal title.

## Adding a provider module

Adding an agent CLI or a multiplexer is one subdirectory under `server/src/providers/<id>/` plus one registry entry. It needs no change to the runtime, the UI, or any existing module.

### Agent module (a new CLI)

1. Create `server/src/providers/<id>/<id>.ts` exporting `<id>Module: AgentModule` (use `satisfies AgentModule` when it always has `hooks`, so callers see them), plus `constants.ts` for its magic numbers. Implement the vocabulary members. Then pick how it learns about sessions:
   - **Hooks**: `normalizeHookEvent(raw)` for what the CLI POSTs to `/api/hooks/<id>`, and `hooks: HookInstaller` (`installHooks`, `uninstallHooks`, `areHooksInstalled`, `consentDisclosure`, optional `stageHookFiles(packageRoot)` for scripts the entries run).
   - **Its own discovery** (transcripts, a database): `start(host)` returning a `RunningAgentModule`. Build it from `providers/sessionStore/`: `new SessionStoreTracker(host, store, DEFAULT_SESSION_STORE_TIMING)` over `jsonlSessionStore` (append-only JSONL), `jsonDocumentSessionStore` (whole-file JSON) or `sqliteSessionStore` (one SQLite file), with a format mapping the CLI's records to `working`, `toolStart`, `toolEnd`, `turnEnd`, `permissionRequest` and `sessionEnd` where the CLI really records them. Key sessions in the form herdr's `agent_session.value` takes for the CLI (the path for pi and omp, the CLI's session id otherwise). The tracker never replays history (cursors open at the end and only the tail decides the starting state), keeps one reader per session refcounted between discovery and follows, and drops sessions untouched for the active window.
2. Add it to `agentModules` in `server/src/providers/index.ts`. Its id is also the `agentKind` a multiplexer reports for its panes, so herdr panes running it light up with tool activity.
3. Add what its sessions show (tool activity, turn ends, approvals, clean exit) to `AGENT_COVERAGE` in `scripts/build-site.ts`, or the website build (`npm run site:build`) fails.
4. Tests go in `server/__tests__/`. `providerModules.test.ts` shows how to run a module against a temp home with fake timers.

### Multiplexer module

Create `server/src/providers/<id>/<id>.ts` exporting `<id>Module: MultiplexerModule`, then add it to `multiplexerModules` and give it a `MULTIPLEXER_SUMMARY` entry in `scripts/build-site.ts`.

- `connect(endpoint, watcher)` reports full snapshots of live agents and its link state. An agent missing from a snapshot has ended. An unanswered poll must not report an empty list.
- `probe(endpoint)` does one round-trip. Adding a connection probes it before saving.

### Consent

A module that writes into any file outside `~/.terrarium/` must do it through `hooks: HookInstaller`. The consent gate then asks once per such module with its own `consentDisclosure()`, and the server installs, migrates and uninstalls it through the same generic paths: no module id appears in `cli.ts` or `clientMessageHandler.ts`. A module that only reads (omp, herdr) has no `hooks` and is never part of a consent ask. See [consent.md](consent.md).
