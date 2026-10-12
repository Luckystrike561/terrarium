import { EventEmitter } from 'node:events';

/**
 * What the Claude engine tracks for one Claude agent (lead, teammate, or external session). Private to
 * providers/claude/: the runtime never sees these fields directly, only the AgentEvents the bridge derives from
 * them. Unlike the runtime's CLI-neutral AgentState, this carries transcript cursors, hook correlation state and
 * team discovery bookkeeping -- Claude's own business.
 */
export interface ClaudeAgentState {
  id: number;
  /** The session id this agent was created for: a Claude session_id, or the transcript's own basename when adopted
   *  from the filesystem. */
  sessionId: string;
  projectDir: string;
  jsonlFile: string;
  fileOffset: number;
  lineBuffer: string;
  activeToolIds: Set<string>;
  activeToolStatuses: Map<string, string>;
  activeToolNames: Map<string, string>;
  activeSubagentToolIds: Map<string, Set<string>>; // parentToolId → active sub-tool IDs
  activeSubagentToolNames: Map<string, Map<string, string>>; // parentToolId → (subToolId → toolName)
  /** Tool ids for run_in_background Agent calls (stay alive until queue-operation). */
  backgroundAgentToolIds: Set<string>;
  isWaiting: boolean;
  permissionSent: boolean;
  hadToolsInTurn: boolean;
  /** Workspace folder name (only set for multi-root workspaces). */
  folderName?: string;
  /** One-line summary of the agent's current task. */
  task?: string;
  /** Timestamp of last JSONL data received (ms since epoch). */
  lastDataAt: number;
  /** Total JSONL lines processed for this agent. */
  linesProcessed: number;
  /** record.type values already warned about (prevents log spam). */
  seenUnknownRecordTypes: Set<string>;
  /** Whether a hook event has been delivered for this agent (suppresses heuristic timers). */
  hookDelivered: boolean;
  /** True when the agent has no transcript file. All state from hooks. */
  hooksOnly?: boolean;
  /** Set when SessionEnd(reason=clear|resume) fires; cleared when SessionStart(source=clear|resume) reassigns. */
  pendingClear?: boolean;
  /** Hook-generated tool ID for PreToolUse/PostToolUse correlation. */
  currentHookToolId?: string;
  /** Tool name from the most recent PreToolUse, used to correlate a later SubagentStart with the parent tool. */
  currentHookToolName?: string;
  /** True if the CURRENT PreToolUse tool call is a teammate spawn. Set in PreToolUse, not cleared in PostToolUse. */
  currentHookIsTeammateSpawn?: boolean;

  // -- Context window usage --
  /** Tokens in the agent's context as of its newest turn; 0 until one is seen. */
  contextTokens: number;
  /** Observational estimate of the window contextTokens fits in. Widens, never shrinks. */
  maxContextTokens: number;
  /** True once this transcript produced a main-chain turn; later sidechain records belong to sub-agents. */
  sawMainChainUsage?: boolean;

  // -- Agent Teams --
  teamName?: string;
  agentName?: string;
  /** True when teamName was read from the session's own record tags, authoritative over spawn-result re-latching. */
  teamNameFromTags?: boolean;
  isTeamLead?: boolean;
  leadAgentId?: number;
  /** True when the lead spawns teammates via tmux (run_in_background Agent calls). */
  teamUsesTmux?: boolean;
  /** For a promoted anonymous background agent (teams OFF): the lead's spawn tool_use id. */
  spawnToolUseId?: string;
  /** Tool ids of spawn calls whose input carried a `name` -- teammates-to-be. */
  teammateSpawnToolIds?: Set<string>;
}

/** Typed event map for ClaudeAgentStore. */
export interface ClaudeStoreEvents {
  agentAdded: (id: number, agent: ClaudeAgentState) => void;
  agentRemoved: (id: number) => void;
  broadcast: (message: Record<string, unknown>) => void;
}

/**
 * Private store for the Claude engine, parallel to the runtime's AgentStateStore but with no persistence and no
 * avatar fields: this engine never touches the office's agent store directly. A bridge subscribes to its events
 * and turns them into AgentEvents on the module's ModuleHost.
 */
export class ClaudeAgentStore {
  private readonly agents = new Map<number, ClaudeAgentState>();
  private readonly emitter = new EventEmitter();
  readonly nextAgentId = { current: 1 };

  get(id: number): ClaudeAgentState | undefined {
    return this.agents.get(id);
  }

  has(id: number): boolean {
    return this.agents.has(id);
  }

  get size(): number {
    return this.agents.size;
  }

  keys(): MapIterator<number> {
    return this.agents.keys();
  }

  values(): MapIterator<ClaudeAgentState> {
    return this.agents.values();
  }

  entries(): MapIterator<[number, ClaudeAgentState]> {
    return this.agents.entries();
  }

  forEach(
    cb: (agent: ClaudeAgentState, id: number, map: Map<number, ClaudeAgentState>) => void,
    thisArg?: unknown,
  ): void {
    this.agents.forEach(cb, thisArg);
  }

  [Symbol.iterator](): MapIterator<[number, ClaudeAgentState]> {
    return this.agents[Symbol.iterator]();
  }

  on<K extends keyof ClaudeStoreEvents>(event: K, listener: ClaudeStoreEvents[K]): this {
    this.emitter.on(event, listener as (...args: unknown[]) => void);
    return this;
  }

  off<K extends keyof ClaudeStoreEvents>(event: K, listener: ClaudeStoreEvents[K]): this {
    this.emitter.off(event, listener as (...args: unknown[]) => void);
    return this;
  }

  set(id: number, agent: ClaudeAgentState): this {
    const isNew = !this.agents.has(id);
    this.agents.set(id, agent);
    if (isNew) {
      this.emitter.emit('agentAdded', id, agent);
    }
    return this;
  }

  delete(id: number): boolean {
    const existed = this.agents.delete(id);
    if (existed) {
      this.emitter.emit('agentRemoved', id);
    }
    return existed;
  }

  clear(): void {
    this.agents.clear();
  }

  broadcast(message: Record<string, unknown>): void {
    this.emitter.emit('broadcast', message);
  }

  dispose(): void {
    this.emitter.removeAllListeners();
  }
}
