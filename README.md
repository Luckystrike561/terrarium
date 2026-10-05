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

Prints one `TerrariumEvent` JSON line per event; logs go to stderr. Flags: `--host`, `--herdr-socket`, `--stats-db`, `--poll-ms`, `--stats-sync-ms`. omp writes `stats.db` only when `omp stats` runs, so the collector runs `omp stats --json` every `--stats-sync-ms` (default 30000) while an agent is working and once when a turn ends; `0` disables it. The collector itself opens `stats.db` read-only.

## Decision log

- Network option: Tailscale on all machines, hub listening on the tailnet IP only. NOT installed in this milestone.
- Host names: laptop-a, laptop-b, server.
- agentId scheme: omp agents -> "<host>:<session_file>"; non-omp agents -> "<host>:herdr:<pane_id>".
- stats.db is the ONLY source of usage numbers; the omp extension carries activity only.
