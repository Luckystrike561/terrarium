# Claude agent status tracking

How the runtime turns a Claude Code session into working, waiting and permission states. Other CLIs report through their own modules, see [providers.md](providers.md).

## Transcripts

JSONL transcripts live at `~/.claude/projects/<project-hash>/<session-id>.jsonl`. The project hash is the workspace path with `:`, `\` and `/` replaced by `-`.

Record types:

- `assistant`: tool_use or thinking.
- `user`: tool_result, or a text prompt. `content` can be a string (text) or an array (tool_results), so handle both.
- `system` with `subtype: "turn_duration"`: the reliable turn-end signal.
- `progress` with `data.type`:
  - `agent_progress`: sub-agent tool_use and tool_result. Non-exempt tools trigger permission timers.
  - `bash_progress`: Bash output. Restarts the permission timer.
  - `mcp_progress`: MCP tool. Same timer restart.
- Observed but not tracked: `file-history-snapshot`, `queue-operation` (except for background agents, see [claude-teams.md](claude-teams.md)).

`/clear` creates a NEW JSONL file, and the old file just stops.

**File watching** (`server/src/providers/claude/claudeFileWatcher.ts`): `fs.watch` paired with 500 ms polling, because `fs.watch` is unreliable on Windows. Partial lines are buffered across reads, since a poll can land mid-write. Tool-done messages are delayed 300 ms so React batching cannot hide brief active states.

## Dual-mode detection

| Mode                     | Source                                                            | Detection                                                                                                                                                                                                                    |
| ------------------------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hooks** (preferred)    | Claude Code hooks → HTTP POST → the Claude module's `receiveHook` | Instant and reliable. The installed events are `CLAUDE_HOOK_EVENTS`                                                                                                                                                          |
| **Heuristic** (fallback) | Polling JSONL files                                               | Per-agent 500 ms JSONL polling for `/clear` detection, 1 s main scanner for workspace session adoption, 3 s external scanner, 30 s stale check. Content-based `/clear` detection (`/clear</command-name>` in the first 8 KB) |

The per-agent `hookDelivered` flag (in the Claude module's private state) and the module's `hooksEnabled` (set by `setHooksEnabled`) gate the timer logic. JSONL polling always runs in both modes for tool content (status text, animations). Only the permission (7 s) and text-idle (5 s) timers are suppressed by `hookDelivered`.

Hook-based IPC failed in early prototypes: hooks are captured at startup and environment variables do not propagate. HTTP `/api/hooks/:providerId` with `~/.terrarium/server.json` discovery works.

## Idle detection

Two signals:

1. `system` + `subtype: "turn_duration"`. Reliable for tool-using turns (about 98%), emitted once per completed turn.
2. The text-idle timer (`TEXT_IDLE_DELAY_MS = 5 s`) for text-only turns. It only starts when `hadToolsInTurn` is false and is suppressed once `hadToolsInTurn` becomes true. It resets on a new user prompt or `turn_duration`, and ANY new JSONL data cancels it.

## Sub-agent permission detection (heuristic)

When a sub-agent runs a non-exempt tool, `startPermissionTimer` fires on the parent agent. If `PERMISSION_TIMER_DELAY_MS` (7 s) elapses with no data, permission bubbles appear on both the parent and the sub-agent characters via `agentToolPermission` and `subagentToolPermission` broadcasts.

`activeSubagentToolNames: Map<parentToolId, Map<subToolId, toolName>>` tracks which sub-tools are active for the exempt check. It is cleared when data resumes, the Task completes, or `turn_duration` arrives.

**Timing budget for tests.** The "Subtask:" overlay appears when the parent's **Task tool_use** is parsed (scenario time T), but the timer only starts when the **sub-tool tool_use** in the progress record is parsed, about 1 s later. Add the 7 s timer and about 300 ms of IPC and render slop: a test waiting for the bubble after the overlay needs a 9 to 10 s budget, and anything under about 10 s is unsafe.

## External-session adoption

The external scanner runs every 3 s. In hooks-OFF e2e scenarios the test setup can race the first scanner tick, so mock-claude scenarios should leave a few seconds of margin before assertions.

## Manual hook testing

`server/manual-hook-events.http` (REST-Client format) drives the hook endpoint of a running server. Copy `port` and `token` from `~/.terrarium/server.json` and set `cwd` to a workspace directory. It covers `SessionStart` → `PreToolUse` → `PermissionRequest` / `Notification` / `Stop` → `SessionEnd`.
