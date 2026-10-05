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

## Decision log

- Network option: Tailscale on all machines, hub listening on the tailnet IP only. NOT installed in this milestone.
- Host names: laptop-a, laptop-b, server.
- agentId scheme: omp agents -> "<host>:<session_file>"; non-omp agents -> "<host>:herdr:<pane_id>".
- stats.db is the ONLY source of usage numbers; the omp extension carries activity only.
