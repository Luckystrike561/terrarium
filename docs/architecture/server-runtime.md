# Server runtime

`server/src/server.ts` composes the pieces below, and `server/src/cli.ts` starts it. Only the `StateAdapter` namespace and the `MessageTransport` differ between a running server and its tests.

## AgentRuntime

`AgentRuntime` (`server/src/agentRuntime.ts`) is the shared lifecycle core.

```typescript
export class AgentRuntime {
  constructor(store: AgentStateStore, modules: ModuleSet);
  connections: MultiplexerConnections | undefined;
  startModules(); // agent modules, their hooks preference, persisted agents, then multiplexer connections
  setHooksEnabled(moduleId, enabled);
  handleHookEvent(providerId, payload); // → that module's receiveHook
  closeAgent(id); // every module reporting the agent dismisses it, then the agent goes
  removeAgent(id);
  dispose(); // stops modules, drops agents, keeps the persisted list for the next start
}
```

It knows no CLI: no transcript, hook or team logic lives here. `AgentEventHandler` (`server/src/agentEventHandler.ts`) applies each module's `AgentEvent` to CLI-neutral `AgentState` and broadcasts what the office shows. A session's restore goes through its module: `startModules` reads the persisted agents before starting any module, reserves their ids, then hands each to its module's `restoreSession`, leads first.

## AgentStateStore

An EventEmitter-backed container in `server/src/agentStateStore.ts` with typed mutations and typed events (`agentAdded`, `agentRemoved`, `agentUpdated`, `broadcast`). The broadcast layer subscribes once at boot and translates `StoreEvents` into `ServerMessage` over the active transport. **No module under `server/` calls a transport method directly.**

## SessionRouter and DismissalTracker

Two classes that replaced ad-hoc module state.

- `SessionRouter` owns the `session_id → agent_id` mapping, pre-registration event buffering, and pending sessions. It is generic over the routed event and the pending record: the runtime routes module sessions with one, and the Claude module routes its hooks with another (`ClaudePendingSession` carries `transcriptPath`).
- `DismissalTracker` (Claude-internal, `providers/claude/dismissalTracker.ts`) unifies transcript dismissal (closed by the user, replaced by `/clear`, seeded mtimes, pending clears) into one class with typed reasons.

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

The connection messages go to `runtime.connections` and, like `hooksConsentResponse`, are accepted only from a privileged (tokened) socket, because they open SSH sessions to other machines. `connectionsLoaded` is sent on the handshake and on every change, to privileged sockets only, because it names SSH targets. `floorsLoaded` goes to every socket: it names machines by their connection labels, never by target. A floor id, also on `agentCreated` and `existingAgents`, is `local` or an HMAC of the host keyed with a secret drawn at startup (`machineIdOf`), so it groups connections by host without naming it. Nothing stores a floor id, so a new key per process costs nothing. `AgentRuntime` recomputes the floor list (`listFloors`) on every connection change and broadcasts it only when it changed, after the removed connection's agents are gone.

On `webviewReady` the handler sends assets, then `layoutLoaded`, then agent state. Agent state comes AFTER `layoutLoaded`, because the characters it targets only exist once the layout flush creates them. The asset order is in [assets.md](assets.md#load-order). `layoutLoaded.isDefault` tells the webview whether the sent layout is the bundled default (`true`, no `~/.terrarium/layout.json`) or a user layout (`false`): only the default grows and shrinks at runtime with the agent count (`docs/architecture/renderer.md`'s "Runtime growth"). `settingsLoaded.ctoOffice` (from `config.json` `standalone.ctoOffice`) likewise tells it whether to compose a CTO module at all.

## AgentState

`server/src/types.ts` holds per-agent runtime data, CLI-neutral: `providerId` (always set), session id and `sessionRef`, tool state Maps and Sets (`backgroundToolIds`, `teammateSpawnToolIds` for the replay), waiting and permission flags, `folderName`/`task`, context usage (`contextTokens`, `maxContextTokens`), `team` (an `AgentTeam`: what the module last reported, with the lead resolved to its agent id), and palette. A module's own bookkeeping never lands here: Claude's transcript cursor, `hookDelivered`, hook correlation and team discovery live in its private `ClaudeAgentState` (`providers/claude/claudeAgentStore.ts`).

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
