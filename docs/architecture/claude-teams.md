# Claude teams, teammates and background agents

`TeamProvider` (`core/src/teamProvider.ts`) is an optional extension for CLIs that support team workflows. Claude Agent Teams is the only implementation (`server/src/providers/claude/claudeTeamProvider.ts`, reading `~/.claude/teams/<name>/config.json`). It answers semantic queries (`discoverTeammates`, `getTeamMembers`, `getTeamMetadataForSession`, `extractTeammateNameFromEvent`, `isTeammateSpawnCall`), and each provider chooses its own storage strategy.

`CONTEXT.md` defines Lead, Teammate and Sub-agent. Use those words.

## Teammate modes

| Mode                            | Trigger                                          | Detection                                                             |
| ------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------- |
| Basic sub-agent (teams OFF)     | `Task(...)` or `Agent(run_in_background: false)` | `subagentStart` with team gate not matched, or JSONL `agent_progress` |
| Inline teammate (teams ON)      | `Agent(run_in_background: true)` in-process      | `onTeammateDetected` → `discoverTeammates(projectDir, leadSessionId)` |
| Session teammate (teams + tmux) | `Agent(run_in_background: true)` in a tmux pane  | Own session, own hooks, routes through the normal flow                |
| Implicit-team agent (Claude 5)  | `Agent(...)`, background by default, NO flag     | See below                                                             |

**Implicit-team agents.** On the lead's side, the spawn tool_result carries `agent_id: <name>@<team>`, and `extractTeammateSpawnFromToolResult` sets the lead's `teamName`. The teammate is its own top-level UUID session, tagged `teamName` and `agentName` on every record, discovered by `discoverTeammates(projectDir, leadSessionId, teamName)` and fast-attached in `onExternalSessionDetected`.

Newer harnesses (Claude 5) never tag the LEAD's records with team metadata and never write `agent_progress` or `queue-operation` records for these spawns. The spawn tool_result and the teammate's own session (own JSONL, own hooks) are the only signals. The implicit team writes `~/.claude/teams/session-<8hex>/config.json`. Its `leadSessionId` matches no transcript on disk, so never link by it. Own-session teammates are registered with the `SessionRouter` (`setTeammateRegisterCallback`) so their hooks route directly to them.

## Team generations on resume (last-wins latch)

Every CLI run of a session mints a FRESH implicit team, so a resumed lead's transcript carries spawn tool_results from several `session-<8hex>` generations.

- A tag-less lead re-latches to the newest spawn's team. `setTeamSwitchCallback` removes the defunct team's teammates.
- Tag-derived identity (`teamNameFromTags`, set by the record-tags branch) is authoritative and never overwritten by spawn results.
- `linkTeammates` never badges a named teammate as LEAD. If only teammates are tracked, linking waits until the real lead is detected. This prevents a phantom LEAD character when a teammate session is adopted before or without its lead.
- Restore drops `isTeamLead` from persisted agents that carry an `agentName`.

## Background spawns without a CLI team (sidecar-backed)

`Agent(...)` spawns that never register a team take the async path. The result reads "Async agent launched successfully. agentId: \<hex>" (no team anywhere), the transcript and a sidecar live under `<projectDir>/<leadSessionId>/subagents/`, and completion arrives as a `queue-operation`. The sidecar carries `agentType`, `description` and `toolUseId`, plus `name` when the spawn was named. `scanForBackgroundAgentFiles` classifies them by the sidecar `name`, which is the domain model's sole Sub-agent vs Teammate distinction:

- **Named → Teammate.** Its own seated character, `agentName` from the sidecar `name`. The spawner gets `isTeamLead` and an `agentTeamInfo` broadcast (a derived team with NO `teamName`, so config polling stays away), and the transient Subtask is ghost-killed via `subagentClear`. The child has `leadAgentId` and `spawnToolUseId`. It is removed on the completion `queue-operation` or on the lead's `sessionEnd`. `removeTeammate` must NOT unregister its session, since it shares the lead's.
- **Unnamed → Sub-agent.** The Subtask sub-character stays. The spawn's transcript is watched in a **shadow `AgentStateStore`** (`server/src/subagentWatch.ts`, owned by `AgentRuntime`, ids from 1 000 000 up) whose broadcasts are translated onto the main store as `subagentToolStart`, `subagentToolDone` and `subagentToolPermission` keyed `(leadId, spawnToolUseId)`. That gives live activity on the sub-character with no protocol change. `agentToolsClear` on the shadow agent synthesizes `subagentToolDone` for still-live tools so the sub idles between turns. Shadow agents are never persisted or announced.

The gate for both: the sidecar `toolUseId` must match a LIVE entry in the lead's `backgroundAgentToolIds` (anti-spurious, no `teamName` involved). `scanForTeammateFiles` skips sidecars carrying a live `toolUseId` so it cannot race the classification.

The lead's `backgroundAgentToolIds` are persisted. Children never are: they are derived state the 1 s scan re-materializes after a reload, and restore skips stale entries with `leadAgentId` but no `teamName`.

The turn-end background-tool re-sends (`transcriptParser`, `hookEventHandler`, `timerManager`'s `clearAgentActivity`) must include `toolName` and `runInBackground`, or the webview cannot recreate the Subtask after `agentToolsClear`. They must skip tools whose spawn became a teammate character (`hasPromotedBackgroundAgent`), or a ghost Subtask appears next to it.

## Dismissal

Teammate dismissal is driven by:

- team config polling: `getTeamMembers(teamName)` is authoritative, and members with `isActive: false` are treated as departed.
- the teammate's own `sessionEnd` (own-session teammates).
- `sessionEnd` on the lead.

## The webview gate

In `webview-ui/src/hooks/useExtensionMessages.ts`, `agentToolStart` with `runInBackground=true` only creates a Subtask sub-character when the **parent has no `teamName`**. With a team, `onTeammateDetected` creates the teammate instead, and the gate prevents a ghost sub-agent. Without a team, the teammate path never fires and the basic Subtask sub-character is the only visible representation, so the gate must let it through. `addSubagent` dedups via `subagentIdMap`, so that is safe even if a teammate is detected later.

The gate's blind spot is a TEAMED lead's unnamed background spawn. `subagentToolStart` covers it by creating the sub-character lazily when it is missing (`addSubagent` is idempotent), and the same lazy path recreates subs after a page reload.

## Sub-agents in the office

Sub-agents have negative ids (from -1 down). They are created on `agentToolStart` with a "Subtask:" prefix, or lazily by `subagentToolStart`. They share the parent's palette and hue shift, and clicking one selects the parent. They are not persisted. A sub-agent spawns at the closest free walkable tile to its parent (`closestFreeWalkableTile`), around it, never in a seat. It idles (stops typing) when every tracked sub-tool row is done, and its overlay shows the latest non-done sub-tool status, falling back to the Subtask label.
