# Server runtime

`server/src/server.ts` composes the pieces below, and `server/src/cli.ts` starts it. Only the `StateAdapter` namespace and the `MessageTransport` differ between a running server and its tests.

## AgentRuntime

`AgentRuntime` (`server/src/agentRuntime.ts`) is the shared lifecycle core.

```typescript
export class AgentRuntime {
  constructor(store: AgentStateStore, modules: ModuleSet);
  readonly transcriptModule: AgentModule | undefined;
  connections: MultiplexerConnections | undefined;
  startModules / setLifecycleCallbacks / setHooksEnabled / handleHookEvent
  registerAgent / unregisterAgent / removeAgent / removeTeammate / removeTeammates
  restoreExternalAgents / startProjectScan / startExternalScanning / startStaleCheck
  dispose();
}
```

It owns the timer Maps (waiting, permission, text-idle, stale), the scanners (project-dir 1 s, external 3 s, stale 30 s), `HookEventHandler`, `SessionRouter` and `DismissalTracker`. Scanners are skipped entirely while hooks are flowing (`hookDelivered` is set on every agent). `RuntimeLifecycleCallbacks` is the only seam between the runtime and its host.

## AgentStateStore

An EventEmitter-backed container in `server/src/agentStateStore.ts` with typed mutations and typed events (`agentAdded`, `agentRemoved`, `agentUpdated`, `broadcast`). The broadcast layer subscribes once at boot and translates `StoreEvents` into `ServerMessage` over the active transport. **No module under `server/` calls a transport method directly.**

## SessionRouter and DismissalTracker

Two classes that replaced ad-hoc module state.

- `SessionRouter` owns the `session_id → agent_id` mapping, pre-registration event buffering, and pending external sessions.
- `DismissalTracker` unifies four legacy globals (`dismissedJsonlFiles`, `clearDismissedFiles`, `seededMtimes`, `pendingClearFiles`) into one class with typed reasons.

## HTTP and WebSocket server

Fastify v5 with `@fastify/cors`, `@fastify/websocket` and `@fastify/static` (`server/src/httpServer.ts`):

| Method | Path                     | Purpose                                 |
| ------ | ------------------------ | --------------------------------------- |
| POST   | `/api/hooks/:providerId` | Bearer-authenticated hook event ingress |
| GET    | `/api/health`            | Liveness: `{ ok, version, port, pid }`  |
| GET    | `/ws`                    | Bidirectional protocol channel          |
| GET    | `/*`                     | Webview SPA                             |

`/ws` accepts same-origin connections and grants privileged messages only to a socket that presents the server token. The gate and why it is built that way are in [consent.md](consent.md#who-may-answer-the-ws-gate).

Server discovery is written to `~/.terrarium/server.json` as `{ port, pid, authToken }`. A second server detects an existing `server.json` and reuses or replaces it based on PID liveness. Every Docker container's server is PID 1, so `TerrariumServer` prunes an own-PID registry entry older than the process instead of reusing it.

## Client message dispatch

`handleClientMessage` in `server/src/clientMessageHandler.ts` is the single dispatch point for `ClientMessage`. Each variant calls into `AgentRuntime`, `AgentStateStore`, `layoutPersistence.ts` or `FileStateAdapter`, or delegates to host callbacks (`onSetHooksEnabled` in `cli.ts`, the install and uninstall side effects the consent executor runs).

The connection messages go to `runtime.connections` and, like `hooksConsentResponse`, are accepted only from a privileged (tokened) socket, because they open SSH sessions to other machines. `connectionsLoaded` is sent on the handshake and on every change, to privileged sockets only, because it names SSH targets.

On `webviewReady` the handler sends assets, then `layoutLoaded`, then agent state. Agent state comes AFTER `layoutLoaded`, because the characters it targets only exist once the layout flush creates them. The asset order is in [assets.md](assets.md#load-order).

## ServerAgentState

`server/src/types.ts` holds per-agent runtime data: the provider reference, the session key, transcript-fallback fields (`jsonlFile`, `fileOffset`, `lineBuffer`), tool state Maps and Sets, team fields (`teamName`, `agentName`, `isTeamLead`, `leadAgentId`, `teamUsesTmux`), context usage (`contextTokens`, `maxContextTokens`, `sawMainChainUsage`), and the **`hookDelivered`** flag that suppresses heuristic timers when hooks are flowing.

## Persistence

```
~/.terrarium/
  config.json              standalone, hooksConsent, hooksEnabled (both per provider), modules, connections
  herdr/<connection>.sock  Local end of each SSH connection's forwarded herdr socket (directory 0700)
  standalone-state.json    { agents, seats }
  layout.json              OfficeLayout, read-only, optional
  server.json              { port, pid, authToken }
  hooks/claude-hook.js     Bundled hook script (CJS, shebang)
```

`FileStateAdapter` backs persistence. Its settings are `lastSeenVersion`, `hooksInfoShown` and `areaMappings`. The hooks preference is per provider and machine-global, at the config top level. `connections` absent means the default `local` connection.

A leftover config key or state file from an older install (including the removed `watchAllSessions`, `soundEnabled`, `alwaysShowLabels`, `showAreas` and `externalAssetDirectories`) is ignored, never an error.

`migrateLegacyStateDir` (`server/src/stateDirMigration.ts`) runs first in the CLI. When `~/.pixel-agents/` exists and `~/.terrarium/` does not, it renames the old directory, so an install from before the rename keeps its settings, consent and seats. An existing `~/.terrarium/` is authoritative and is never merged with the old directory.

There is no settings panel. Every session on the machine is watched, the waiting chime always plays, and agent labels show on hover or selection (every label renders under the e2e harness, so specs can read overlay text).

`layout.json` is read-only: the server reads it on every `webviewReady` and serves the bundled default only when the file is missing. Nothing writes it.
