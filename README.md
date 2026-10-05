# Terrarium

A full-screen tank showing every AI agent on my machines as a creature. See PLAN.md.

## Usage

```sh
bun install
bun run typecheck
bun run lint
bun run format
bun run test
```

## Collector (local)

```sh
bun packages/collector/src/main.ts --stdout
```

Prints one `TerrariumEvent` JSON line per event; logs go to stderr. Flags: `--host`, `--herdr-socket`, `--omp-socket`, `--stats-db`, `--poll-ms`, `--stats-sync-ms`. omp writes `stats.db` only when `omp stats` runs, so the collector runs `omp stats --json` every `--stats-sync-ms` (default 30000) while an agent is working and once when a turn ends; `0` disables it. The collector itself opens `stats.db` read-only.

## omp extension

`extensions/omp/terrarium.ts` hooks `session_start`, `agent_start`, `agent_end`, `tool_execution_start`, `tool_execution_end`, `tool_approval_requested` and `session_shutdown`, and writes one `TerrariumEvent` line per hook to `$XDG_RUNTIME_DIR/terrarium.sock` (fallback `/tmp/terrarium.sock`). It carries tool names, the error flag, state and the folder name only; when the socket is missing it drops events silently. `TERRARIUM_HOST` overrides the host name; the collector restamps host and agentId with its own `--host` anyway. Installing it into `~/.omp` is M5.

The collector listens on that socket (mode 0600) and merges the stream with herdr by agentId: once the extension reports an agent, its states and tool events win over herdr's; `turn.usage` is only taken from `stats.db`. `extensions/omp/harness.ts` loads the extension against a stand-in API so hooks can be fired without omp; `scripts/verify-M2.sh` uses it.

## Decision log

- Network option: Tailscale on all machines, hub listening on the tailnet IP only. NOT installed in this milestone.
- Host names: laptop-a, laptop-b, server.
- agentId scheme: omp agents -> "<host>:<session_file>"; non-omp agents -> "<host>:herdr:<pane_id>".
- stats.db is the ONLY source of usage numbers; the omp extension carries activity only.
