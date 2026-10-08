/** Map status prefixes back to tool names for animation selection */
const STATUS_TO_TOOL: Record<string, string> = {
  Reading: 'Read',
  Searching: 'Grep',
  Globbing: 'Glob',
  Fetching: 'WebFetch',
  'Searching web': 'WebSearch',
  Writing: 'Write',
  Editing: 'Edit',
  Running: 'Bash',
  Task: 'Task',
};

export function extractToolName(status: string): string | null {
  for (const [prefix, tool] of Object.entries(STATUS_TO_TOOL)) {
    if (status.startsWith(prefix)) return tool;
  }
  const first = status.split(/[\s:]/)[0];
  return first || null;
}

// ── Provider capabilities (tool taxonomy for rendering decisions) ────────────
// Populated once by the `providerCapabilities` message after `webviewReady`.
// Modules classifying tools (character animation, subagent creation gate) read
// from here instead of hardcoding Claude-specific tool names. Characters do not
// carry their agent module, so every enabled module's names are merged.

const providerCaps: {
  readingTools: Set<string>;
  subagentToolNames: Set<string>;
} = {
  readingTools: new Set(),
  subagentToolNames: new Set(),
};

export function setProviderCapabilities(
  providers: ReadonlyArray<{ readingTools: string[]; subagentToolNames: string[] }>,
): void {
  providerCaps.readingTools = new Set(providers.flatMap((p) => p.readingTools));
  providerCaps.subagentToolNames = new Set(providers.flatMap((p) => p.subagentToolNames));
}

export function isReadingToolName(name: string | null | undefined): boolean {
  return typeof name === 'string' && providerCaps.readingTools.has(name);
}

export function isSubagentToolName(name: string | null | undefined): boolean {
  return typeof name === 'string' && providerCaps.subagentToolNames.has(name);
}
