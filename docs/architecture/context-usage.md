# Context usage

Every agent's context gauge comes from `server/src/providers/claude/contextUsage.ts`. It is fed from `message.usage` on assistant records by `processTranscriptLine`, broadcast as `agentContextUsage`, and rendered by `ToolOverlay`.

Both halves are easy to get wrong. Cumulative sums measure spend rather than occupancy, `input_tokens` without the cache counters measures almost nothing, and a 200k window assumed for a 1M model reads five times too full. Check the gauge against Claude Code's own statusline `context_window.used_percentage`.

## Rules

- **Snapshot, not a total.** Context is the newest turn's `input_tokens + cache_creation_input_tokens + cache_read_input_tokens + output_tokens`. Summing turns measures spend, not occupancy, and misses the cached tokens that ARE the context (`input_tokens` is single digits once caching kicks in). It falls on compaction and `/clear` for free.
- **All-zero usage means "no news".** Synthetic records (API errors, interrupts) report zeros and must not blank the gauge.
- **Sidechain rule.** A lead's sidechain records are its sub-agents' turns and must not move its gauge. A teammate's own transcript is sidechain top to bottom and would otherwise never report. The positional latch `sawMainChainUsage` resolves both: once a file produces a main-chain turn, later sidechain records belong to someone else.
- **The window comes from the provider**, not from the runtime: `contextWindowForModel(model)` on the agent module (Claude: 1M for the current line, 200k for Haiku and the older models, `undefined` for ids it cannot place). Transcripts state usage but never the limit. `widenContextWindow` is the backstop for unrecognized models and unknown larger windows. It only ever widens, since a context that does not fit disproves the assumption while a shrinking one proves nothing.
- **`seedContextUsage` runs once per agent in `startFileWatching`**, the single seam every watched agent passes through. Agents adopted or restored mid-session start at end-of-file, so without a tail read they would have no gauge until their next turn.
- Sub-agents get no gauge: they have no session of their own, and the shadow store never forwards `agentContextUsage`.
