# Terrarium: Compressed Reference

Terrarium is a pixel art office where AI coding agents become animated characters. A standalone Node server watches agent CLIs (Claude Code hooks and transcripts, the session stores of 21 other CLIs) and terminal multiplexers (herdr, locally or over SSH), and serves the office to a browser.

`CONTEXT.md` is the canonical glossary. Read it for what Agent, Sub-agent, Teammate, Lead or Adopt mean here, and use its vocabulary in code, comments and docs.

## Naming

The product is **Terrarium**, a fork of Pixel Agents v1.4.1 (the README credits the upstream project). The repository is `https://github.com/Luckystrike561/terrarium`.

Code, paths and commands use the Terrarium name too: the npm package and CLI `terrarium`, the state directory `~/.terrarium/`, the hook script path `~/.terrarium/hooks/claude-hook.js`, the `TERRARIUM_*` environment variables, the `[Terrarium]` log prefix, and `TerrariumServer`. Say Pixel Agents only when you mean the upstream project. Installs from before the rename are migrated on startup: `stateDirMigration.ts` moves `~/.pixel-agents/` to `~/.terrarium/` when the new directory does not exist yet, and the Claude hook installer still recognizes `/.pixel-agents/hooks/claude-hook.js` entries and a `settings.json.pixel-agents.backup` as its own. The old environment variable names are not read.

## Where to look

| Topic                                                                                          | Document                                                                                                                                  |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| User setup: per-provider quick start, Docker mounts, connections, troubleshooting              | [docs/guide.md](docs/guide.md). The website's per-agent cards come from `AGENT_COVERAGE` in `scripts/build-site.ts`, so keep both in step |
| Agent, multiplexer and quota source modules, routing, one agent one character, adding a module | [docs/architecture/providers.md](docs/architecture/providers.md)                                                                          |
| AgentRuntime, store, router, HTTP/WS server, persistence                                       | [docs/architecture/server-runtime.md](docs/architecture/server-runtime.md)                                                                |
| Claude transcripts, hooks vs heuristics, timers, idle detection                                | [docs/architecture/status-tracking.md](docs/architecture/status-tracking.md)                                                              |
| Claude teams, teammates, background agents, sub-agents                                         | [docs/architecture/claude-teams.md](docs/architecture/claude-teams.md)                                                                    |
| Hooks consent, the hook installer, the Claude status line, the `/ws` privilege gate            | [docs/architecture/consent.md](docs/architecture/consent.md)                                                                              |
| Context gauge                                                                                  | [docs/architecture/context-usage.md](docs/architecture/context-usage.md)                                                                  |
| Pixi iso renderer, UI styling, characters, CTO queue, seats, layout                            | [docs/architecture/renderer.md](docs/architecture/renderer.md)                                                                            |
| Assets, generated art, catalog, load order                                                     | [docs/architecture/assets.md](docs/architecture/assets.md)                                                                                |
| Test tiers, mocks, inventory, drift checks                                                     | [docs/architecture/testing.md](docs/architecture/testing.md)                                                                              |
| Consent revision rule (ADR)                                                                    | [docs/adr/0001-…](docs/adr/0001-consent-choices-send-immediately-and-revise-as-absolute-state.md)                                         |
| Art direction                                                                                  | [docs/art-direction.md](docs/art-direction.md)                                                                                            |
| Claude spawn formats research                                                                  | [docs/research/claude-harness-spawn-formats.md](docs/research/claude-harness-spawn-formats.md)                                            |
| E2E rules and inventory                                                                        | [e2e/README.md](e2e/README.md)                                                                                                            |
| The original, unbuilt design                                                                   | [docs/history/original-plan.md](docs/history/original-plan.md)                                                                            |

## Architecture

Strict layering: `core/` depends on nothing. `server/` and `webview-ui/` depend only on `core/`. The server never imports `webview-ui/` and vice versa. `server/` and `webview-ui/` are npm workspaces. `core/` is not a package: both import its sources directly.

```
core/                                Protocol + interface definitions
  asyncapi.yaml                      AsyncAPI 3.0 contract, single source of truth for the wire protocol
  src/
    messages.ts                      AUTO-GENERATED discriminated unions (do not edit)
    schemas.ts                       AgentMeta, SpriteData, FurnitureCatalogEntry, PersistedAgent
    provider.ts                      AgentModule, RunningAgentModule, MultiplexerModule, QuotaSourceModule, AgentEvent, QuotaReading (the integration boundary)
    transport.ts                     MessageTransport, TransportState
    adapter.ts                       StateAdapter, AssetCache, PersistedAgent, AgentSeat
    paletteUtils.ts                  Palette diversity for character assignment
    normalizeProjectPath.ts
    constants.ts
    assets/                          PNG decoders, manifest helpers, buildFurnitureCatalog, CHARACTER_FRAMES

server/                              Runtime + Fastify HTTP/WS server + CLI
  src/
    cli.ts                           `terrarium` entry (npm bin)
    server.ts                        Top-level composition (TerrariumServer)
    serverConfig.ts                  server.json record shape
    httpServer.ts                    POST /api/hooks/:providerId, GET /api/health, GET /ws, SPA
    clientMessageHandler.ts          Single dispatch point for ClientMessage
    agentRuntime.ts                  Lifecycle core: starts modules, creates/removes agents, restores persisted agents through their module, routes hooks
    agentEventHandler.ts             Applies every module's AgentEvent to CLI-neutral agent state and broadcasts what the office shows
    agentStateStore.ts               EventEmitter-backed single source of truth
    agentActivityResend.ts           Replays an agent's active state to a connecting client
    sessionRouter.ts                 session_id → agent_id, event buffering, pending sessions (generic, also used by the Claude module)
    multiplexerFeed.ts               Diffs one endpoint's snapshots into AgentEvents
    multiplexerConnections.ts        Persisted connection list, one feed per enabled connection
    connectionSettings.ts            Connection model, defaults, validation
    floors.ts                        Machine identity of a connection, the office's floor list
    paletteAssigner.ts               Server-side palette assignment
    pathKey.ts                       Canonical path key for Maps and identity
    fileStateAdapter.ts              ~/.terrarium/ persistence
    stateDirMigration.ts             Moves a pre-rename ~/.pixel-agents/ to ~/.terrarium/ on startup
    configPersistence.ts             config.json read/write
    layoutPersistence.ts             Read-only layout.json loader
    assetLoader.ts                   PNG → SpriteData, furniture manifests, loadDefaultLayout
    assetReload.ts                   Builds the in-memory asset cache
    quotaBoard.ts                    Latest reading per quota meter, staleness timers, the quotaUpdate broadcast
    types.ts                         AgentState (CLI-neutral), AgentTeam
    constants.ts                     Server-wide constants (hook body size, event buffer, default context window)
    providers/
      index.ts                       Module registry, loadEnabledModules, providerCapabilitiesMessage
      consentGate.ts                 Consent policy: when to ask, what an answer means
      consentExecutor.ts             Consent execution, serialized across providers
      claude/                        The Claude Code module, the only code that knows Claude specifics
        claude.ts                    The module object: vocabulary, hooks installer, start() → the running module
        claudeRunningModule.ts       RunningAgentModule: discovery, followSession, receiveHook, restore, dismiss. Owns every timer and watcher
        claudeAgentStore.ts          The module's PRIVATE per-agent state (transcript cursor, hookDelivered, hook correlation, teams)
        claudeBridge.ts              Private store → AgentEvents on the ModuleHost
        claudeHookEvents.ts          normalizeHookEvent → ClaudeHookEvent (Claude-local union)
        claudeHookHandler.ts         Hook routing on the private store: adoption, /clear + /resume, teammates
        claudeFileWatcher.ts         fs.watch + 500 ms polling, line buffering, /clear detection, teammate and session scanners
        claudeTranscriptParser.ts    JSONL records → private-store activity
        claudeTimers.ts              Heuristic waiting / permission timers
        claudeVocabulary.ts          formatToolStatus, tool taxonomy, ~/.claude/projects layout, context window per model
        contextUsage.ts              Context gauge
        subagentWatch.ts             Shadow store for unnamed background spawns
        inlineTeammates.ts           Inline-teammate helpers
        dismissalTracker.ts          Unified transcript dismissal state
        transcriptFollower.ts        followSession: a herdr pane's Claude session id → its transcript
        teamProvider.ts, claudeTeamProvider.ts   TeamProvider (Lead + Teammates) over ~/.claude/teams/
        claudeStatusLine.ts          The statusLine slot: chains the user's status line, restores it on uninstall
        claudeStatusLineShell.ts     The shell the chained status line runs in (Claude Code's: Git Bash or PowerShell on Windows)
        claudeQuota.ts               Status-line rate_limits → quota readings (5h, 7d, gateway spend)
        claudeHookInstaller.ts, claudeHookIdentity.ts, consentCopy.ts, constants.ts
        hooks/claude-hook.ts         Hook script (and, with --status-line, the status line), bundled to dist/hooks/claude-hook.js
      sessionStore/                  sessionStoreTracker.ts + jsonl / jsonDocument / sqlite stores, constants.ts
      herdr/                         herdr.ts, herdrBridge.ts, herdrSocket.ts, herdrSsh.ts, constants.ts
      <cli>/                         omp, pi, codex, copilot, cursor, opencode, kilo, kimi, droid, devin, hermes,
                                     qodercli, qwen, letta, mastracode, agy, grok, kiro, maki, gemini, cline
  __tests__/                         Vitest suites (+ fakeHerdr.ts)
  manual-hook-events.http            Manual hook testing (REST-Client format)

webview-ui/                          React 19 HUD + PixiJS (WebGL) office
  public/assets/                     Bundled sprites, furniture manifests, default layout
  public/fonts/                      FSPixelSansUnicode-Regular.ttf
  src/
    main.tsx, App.tsx                Entry and composition root
    transport/                       createTransport() → WebSocketTransport
    runtime.ts, browserMock.ts, testHooks.ts
    constants.ts, index.css          Webview magic numbers, CSS variables
    notificationSound.ts, changelogData.ts
    components/                      BottomToolbar, ConnectionsMenu, IntroBubble, ChangelogModal, Tooltip, ui/ …
    hooks/                           useExtensionMessages.ts (dispatch), introTourState.ts, useIntroTour.ts
      serverMessages/                One handler per message family (agentLifecycle, toolActivity, teamAndContext, asset, settings) and their shared messageContext.ts
    office/
      iso.ts, projection.ts          Iso projection, fitted view
      backdrop.ts, isoWalls.ts       Skyline, wall boxes and glass partitions
      colorize.ts, floorTiles.ts, wallTiles.ts, toolUtils.ts, types.ts
      sprites/                       spriteData.ts, textureCache.ts, carpetTiles.ts, petSpriteData.ts, *.json
      layout/                        furnitureCatalog.ts, layoutSerializer.ts, tileMap.ts
      engine/
        building.ts                  The floors, bottom to top
        officeState.ts               One floor's world state (layout, seats, characters, pets), delegating every rule below
        ctoOffice.ts                 CtoOffice: the CTO's desk and couch loop and the CTO queue, plus office and door geometry
        seatAssignment.ts, seatPlacement.ts   Desk vs lounge seats, seat picking by area, work-seat claims, teammate clustering
        greeterAgent.ts              The Intro greeter's spawn and despawn
        subagents.ts                 Sub-agent characters and their id maps
        agentMovement.ts             Seat reassignment, back-to-seat and walk-to-tile commands
        agentStatus.ts               Tool, bubble, team, context and task setters
        pets.ts, petEntity.ts        Pet roster and relocation, and the per-pet FSM
        furnitureAutoState.ts        Auto-on electronics and furniture animation frames
        hitTesting.ts                Character hit-testing
        characters.ts, matrixEffect.ts, matrixEffectState.ts, existingAgents.ts, worldAccess.ts, isoSort.ts, gameLoop.ts, pixiColor.ts, index.ts
        sceneRenderer.ts             OfficeSceneRenderer: Pixi stage and per-frame sequencing of the scene* layers
        sceneFloor.ts, sceneAreas.ts, sceneEntities.ts, sceneBubbles.ts, sceneBuilding.ts, scenePools.ts   Floor and carpet, areas and seat indicator, iso-sorted entities, bubbles and badges, pillars and floor names, sprite pools
      components/                    OfficeCanvas.tsx, ToolOverlay.tsx, QuotaJars.tsx (coffee-bean quota jars)
  test/                              Vitest (Node runner)

site/                                GitHub Pages website source (index.html template + style.css), built by scripts/build-site.ts

e2e/                                 Playwright, Chromium only
  playwright.config.ts, global-setup.ts, run-config.ts
  fixtures/                          standalone.ts, mock-claude(.cmd), mock-claude-runner.cjs, fake-ssh.cjs
  helpers/                           mock-claude.ts, office.ts, hooks.ts, standalone.ts, lifecycle.ts, team.ts, herdr.ts, intro.ts, …
  tests/claude/hooks-on/             basic, consent, clear-resume, subagent-and-teammate-spawns, teammate-routing-and-dismissal, cross-cutting-invariants, teams
  tests/claude/hooks-off/            lifecycle, matrix, areas, areas-multiroot, carpet, pets
  tests/standalone/                  hooks, omp, herdr, connections, ui
  demo/                              record.demo.ts (README demo GIF)

scripts/
  generate-messages.ts               AsyncAPI → core/src/messages.ts via Modelina
  validate-asyncapi.mjs              AsyncAPI validation
  run-e2e.mjs                        Playwright wrapper (run-id namespacing, video attach flags)
  generate-e2e-inventory.mjs         Splices the test list into e2e/README.md
  build-allure-report.mjs            Combines e2e + server + webview Allure results
  assemble-vercel-output.mjs         Stages /reports/allure/ for Vercel
  build-site.ts                      site/ → dist/site/, supported-agents table from the provider registry (fails on a module missing from AGENT_COVERAGE)
  npm-package-contract.mjs (+ .test) What the npm tarball must contain
  verify-npm-package.mjs             Packs, installs and smoke-tests the tarball
  publish-npm-package.mjs            Publishes a verified tarball
  record-demo.mjs                    Records docs/media/demo.gif
  iso-art/                           Generators for furniture, characters, floors and the default layout
  asset-manager.html, wall-tile-editor.html, jsonl-viewer.html

eslint-rules/terrarium-rules.mjs  no-inline-colors, pixel-shadow, pixel-font
Dockerfile                           Standalone server image (herdr + omp)
```

## Distribution

- **npm package** (`terrarium`). `terrarium [--port 3100]` runs the Fastify server and serves the SPA on the same port. Nothing from this fork is published to npm, and the `terrarium` name on npm belongs to an unrelated package, so never document `npx terrarium`. Run Terrarium from source (`node dist/cli.js`) or Docker. The `package.json` `files` allowlist is `CHANGELOG.md`, `LICENSE`, `dist/cli.js`, `dist/hooks/claude-hook.js`, `dist/assets/`, `dist/webview/` and `icon.png`. `scripts/npm-package-contract.mjs` pins it.
- **Docker image** (`Dockerfile`): multi-stage, `npm ci` + `npm run package`, then a runtime stage with only the server workspace's production dependencies plus `dist/`, running as `node` (UID 1000, `HOME=/home/node`) with `--provider herdr,omp --host 0.0.0.0 --port 8790`. herdr and omp by default, never Claude, because Claude hooks installed from a container would point at container paths. [docs/guide.md](docs/guide.md#docker) is the source of truth for the mounts.

## Communication flow

Hub and spoke. The server is the single aggregation point for all agent activity.

```
Hook scripts ─POST /api/hooks/:providerId─→ that running module's receiveHook() ─┐
Agent modules (session stores, Claude transcripts + hooks) ─ModuleHost.emit────┤
Multiplexer snapshots ─MultiplexerFeed─ModuleHost.emit─────────────────────────┤
                                                                              ↓
                                                        AgentEvent → AgentRuntime → AgentStateStore
                                                                              ↓
                                                        StoreEvents → broadcast → WebSocket /ws → browser

Agent modules / quota source modules ─reportQuota─→ QuotaBoard ─quotaUpdate─→ broadcast
```

## Protocol contract

`core/asyncapi.yaml` is the contract, pinned to **AsyncAPI 3.0.0** because `@asyncapi/modelina@5.10.1` declares `supportedVersions: ['3.0.0']` only (3.1.0 produces `export type Root = any`). Revisit when Modelina supports 3.1.0.

- **32 ServerMessage variants** (server → client): agent lifecycle and activity, sub-agent activity, team and context usage, assets, settings, hooks consent, connections, floors, quotas.
- **10 ClientMessage variants** (client → server): `webviewReady`, `closeAgent`, `saveAgentSeats`, `setLastSeenVersion`, `setHooksInfoShown`, `hooksConsentResponse`, `saveAreaMappings`, and the privileged `addConnection`, `updateConnection`, `removeConnection`.

Both unions use `oneOf` with `discriminator: type`, and every concrete message sets `additionalProperties: false`. `core/src/messages.ts` is generated by `npm run asyncapi:generate` (Modelina with custom constraints: `propertyKey` preserves `type`/`status`, `constant` inlines `const` literals). Never edit it by hand. Regenerate and commit it with every contract change.

## Transport

```typescript
export interface MessageTransport {
  send(msg: ClientMessage): void;
  onMessage(handler: (msg: ServerMessage) => void): () => void;
  readonly ready: Promise<void>;
  readonly state: TransportState; // 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
  onStateChange(handler: (state: TransportState) => void): () => void;
  dispose(): void;
}
```

`createTransport()` in `webview-ui/src/transport/index.ts` is the one construction point. It forwards the page URL's `?token=` into the socket URL, which makes the socket privileged. `WebSocketTransport` reconnects with exponential backoff (250 ms to 4 s, capped) and queues sends while disconnected.

## Provider modules

Three kinds, any combination per process, chosen with `--provider <ids>` and saved in `config.json` `modules` (default `['claude']`):

- **Agent module** (one per CLI, Claude included) owns that CLI's vocabulary and how to read it: `hooks: HookInstaller` for consent-gated hook installs, and `start(host)` returning a `RunningAgentModule` for its own session discovery (built on `providers/sessionStore/`, or Claude's transcripts and hooks). The running module takes hook payloads (`receiveHook`), the hooks preference (`setHooksEnabled`), persisted sessions after a restart (`restoreSession`) and closed characters (`dismissSession`).
- **Multiplexer module** (herdr) reports live panes and its link state per connection, never parses a transcript, and hands each pane to the agent module for its kind when that module runs.
- **Quota source module** (none shipped yet) reads an account quota of a provider that runs no agent CLI here and reports `QuotaReading`s through its `QuotaHost`. An agent module that sees its provider's quota reports it through `ModuleHost.reportQuota` instead: Claude does, from Claude Code's status line `rate_limits`. `QuotaBoard` keeps the latest reading per meter and the office draws each as a coffee-bean jar on the break-room coffee machine. Ollama Cloud is deferred: it has no usage API.

The runtime dispatches on `AgentEvent.kind`, never on CLI-specific tool names. One session is one character, whichever modules see it. Adding a CLI, a multiplexer or a quota source is one directory under `server/src/providers/<id>/` plus one registry entry in `server/src/providers/index.ts`. Details and the step-by-step guide: [providers.md](docs/architecture/providers.md).

## Server runtime

`AgentRuntime` knows no CLI: it starts the modules, hands each its hooks preference and its persisted agents, routes `POST /api/hooks/:providerId` to that module's `receiveHook`, and applies every module's events through `AgentEventHandler`. `AgentStateStore` is the single source of truth: typed mutations, typed events, and a broadcast layer that is the only code allowed to call the transport. `handleClientMessage` (`clientMessageHandler.ts`) is the single dispatch point for client messages. Details: [server-runtime.md](docs/architecture/server-runtime.md).

Claude agents are tracked inside `providers/claude/` in two modes: hooks (instant, preferred) and heuristics over JSONL transcripts (fallback). The per-agent `hookDelivered` flag, in the module's private state, suppresses the heuristic permission (7 s) and text-idle (5 s) timers. Details: [status-tracking.md](docs/architecture/status-tracking.md).

## Persistence

Everything lives under `~/.terrarium/`: `config.json` (consent and hooks preference per provider, enabled modules, connections, area mappings), `standalone-state.json` (agents, seats), an optional read-only `layout.json`, `server.json` (`{ port, pid, authToken }` discovery), the staged hook script under `hooks/`, and forwarded herdr sockets under `herdr/`. Leftover keys from older installs are ignored, never an error. Nothing writes `layout.json`. Details: [server-runtime.md](docs/architecture/server-runtime.md#persistence).

## Office UI

Game state lives in imperative classes, not React state, and is drawn as 2:1 isometric pixel art by a PixiJS retained scene graph (`office/engine/sceneRenderer.ts`). The simulation stays on the top-down tile grid. Only drawing and hit-testing go through `office/iso.ts`. The office fits the viewport exactly (non-integer `fitZoom`, no user zoom). Agents that need the human queue at the CTO's office. Idle agents rest in the lounge. There is no in-app layout editor and no settings panel: the office is authored in `scripts/iso-art/layout.ts`. Details: [renderer.md](docs/architecture/renderer.md) and [assets.md](docs/architecture/assets.md).

**Floors.** The office is a `Building` (`office/engine/building.ts`): one floor per machine, stacked bottom to top, each a whole `OfficeState` with its own seats, lounge, CTO office and CTO queue. The first floor is the machine the server runs on (`LOCAL_MACHINE_ID`, named after its host name). Every other host reached through a connection gets one floor, named after its first connection, and two connections to one host share it (`server/src/floors.ts`, `machineIdOf`). An agent carries its floor as `machineId` (`agentCreated`, `existingAgents.machineIds`, set by a multiplexer feed through `sessionStart.machineId`), is added to that floor's `OfficeState` and never leaves it. The server sends `floorsLoaded` on connect and whenever a connection changes the list. `layout.json` furnishes the first floor and every other uses the bundled default (`layoutLoaded.floorLayout`). Floor N is drawn `elevation` iso px higher on the same projection, clear of the walls below, so floors never overlap and hit-testing shifts by the same height. Selection, hover and camera follow belong to the building.

## Commands

```bash
npm install                # root + all workspaces
npm run build              # asyncapi:generate, check-types, lint, esbuild, vite (alias of compile)
npm run package            # production build
npm run watch              # esbuild watch + tsc --noEmit watch (no Vite)
npm run dev                # build, then watch esbuild + vite and run the server with herdr,omp on :8790
npm run dev -w webview-ui  # Vite dev server with the browser mock
npm test                   # webview + server Vitest + package contract
npm run test:server        # server Vitest only
npm run test:webview       # webview Vitest only
npm run e2e                # Playwright (needs a build)
npm run e2e:inventory      # regenerate the e2e/README.md inventory
npm run lint               # core + server + webview + e2e ESLint
npm run check-types        # tsc across all packages
npm run asyncapi:validate  # validate the contract
npm run asyncapi:generate  # regenerate core/src/messages.ts
npm run verify:npm-package # pack, install and smoke-test the tarball
npm run site:build         # build the website from site/ into dist/site/
```

`esbuild.js` bundles the CLI (`dist/cli.js`, Fastify externals) and the hook script (`dist/hooks/claude-hook.js`, CJS with shebang), and copies `webview-ui/public/assets/` to `dist/assets/`. `process.env.TERRARIUM_VERSION` is stamped into all bundles.

## Checks

No workflow runs the checks. `.github/workflows/` holds only `docker.yml` (builds the image for `linux/amd64` and `linux/arm64` and pushes it to `ghcr.io/luckystrike561/terrarium`: `latest` on every push to `master`, `X.Y.Z` on each published release) and `pages.yml` (builds the website on every push and pull request, deploys it to GitHub Pages from `master`). Run the checks locally before pushing:

```bash
npm run lint && npm run check-types && npm run asyncapi:validate
npm run asyncapi:generate && npm run e2e:inventory   # must leave no git diff
npm run build && npm test && npm run e2e
```

The husky `pre-commit` hook runs gitleaks and lint-staged (ESLint, Prettier). The `pre-push` hook runs `check-types` and fails if `core/src/messages.ts` or `e2e/README.md` drift from their generators. Test tiers and authoring rules: [testing.md](docs/architecture/testing.md) and [e2e/README.md](e2e/README.md).

## TypeScript constraints

- **No `enum`** (`erasableSyntaxOnly` in the webview): use `as const` objects (`TileType`, `CharacterState`, `Direction`).
- **`import type`** for type-only imports (`verbatimModuleSyntax` in the webview, convention in the server).
- **`noUnusedLocals` / `noUnusedParameters`** everywhere.
- **`.js` extensions** on all relative imports in the server (Node16 module resolution, target ES2022).
- `noFallthroughCasesInSwitch` in the webview.
- **At most 600 lines per file** in `server/src`, `webview-ui/src` and `e2e`: ESLint `max-lines` fails `npm run lint` past that. Split along a responsibility seam, as `office/engine/` does. The only exemptions are the four oversized Claude module files listed in `eslint.config.mjs`, until they are split too.

## Constants

All magic numbers and strings are centralized, never inline:

| Where                                    | What                                       |
| ---------------------------------------- | ------------------------------------------ |
| `server/src/constants.ts`                | Timing and scanning constants, server-wide |
| `server/src/providers/<id>/constants.ts` | One module's own tuning and paths          |
| `core/src/constants.ts`                  | Protocol-level constants                   |
| `webview-ui/src/constants.ts`            | Webview magic numbers and colour strings   |
| `webview-ui/src/index.css` `:root`       | CSS custom properties                      |

The custom ESLint rules `no-inline-colors`, `pixel-shadow` and `pixel-font` are `error` level.

## Errors and logging

Errors are caught and logged, and never crash the server. Malformed JSONL lines are ignored. Missing assets log a warning and fall back to null. There is no telemetry. Log with `console.log` / `warn` / `error` and a prefix: `[Terrarium]` (server), `[AssetLoader]` (asset loading), `[Webview]` (webview).

## Key decisions

- **Layered codebase** (core → server, core → webview-ui), with the AsyncAPI contract as the single source of truth for the wire protocol.
- **AgentStateStore is the single source of truth.** No transport calls outside the broadcast layer.
- **Provider modules are the integration boundary.** No module id appears in the runtime, the UI, `cli.ts` or `clientMessageHandler.ts`.
- **Single-namespace persistence** under `~/.terrarium/`.
- **The server always starts** regardless of the hooks preference. Only hook installation is gated by it.
- **Consent before any first write outside `~/.terrarium/`**, asked once per `(module, subject)` pair in the Intro (Claude has two: `hooks` for the 12 entries, `statusLine` for the quota slot, each with its own grant, disclosure and revision), and a choice is an absolute state command. A subject's preference is persisted only after its own install or uninstall verifiably landed. See [consent.md](docs/architecture/consent.md), ADR 0001 and ADR 0002.
- **Never rewrite a JSON shape we did not author**, and identify our hook by an anchored, case-insensitive path suffix, never a substring. See [consent.md](docs/architecture/consent.md#writing-settingsjson-safely).
- **Privilege is a token, never a network position.** See [consent.md](docs/architecture/consent.md#who-may-answer-the-ws-gate).
- **E2E over webview unit tests** for user-facing behaviour. See [testing.md](docs/architecture/testing.md).

## Condensed lessons

- `fs.watch` is unreliable on Windows: always pair it with polling.
- Carry unterminated lines across reads of append-only files.
- Delay `agentToolDone` 300 ms so React batching cannot hide brief active states.
- `/clear` creates a NEW JSONL file. The old file just stops.
- Heuristic permission bubbles land 7 s after the SUB-TOOL is registered, not after the parent Task: budget 9 to 10 s in tests.
- Context usage is a snapshot of the newest turn against a provider-declared window, never a sum. See [context-usage.md](docs/architecture/context-usage.md).
- The webview's `runInBackground` sub-character gate depends on the parent's `teamName`. See [claude-teams.md](docs/architecture/claude-teams.md#the-webview-gate).
