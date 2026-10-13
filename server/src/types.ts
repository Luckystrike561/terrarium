/** An agent's team, as its module last reported it, with the lead resolved to its agent id. */
export interface AgentTeam {
  teamName?: string;
  /** The agent's name within the team. Absent for the lead. */
  agentName?: string;
  isTeamLead?: boolean;
  leadAgentId?: number;
  teamUsesTmux?: boolean;
}

/** What the office shows for one agent, whichever module reports it. Every field is CLI-neutral: a module keeps its
 *  own bookkeeping (transcript cursors, hook correlation, team discovery) to itself and reports changes as
 *  AgentEvents. */
export interface AgentState {
  id: number;
  /** The session id the agent was created for. Other modules' sessions may route to it too. */
  sessionId: string;
  /** Module that reports this agent: the agent module whose vocabulary it speaks once one has reported it, else the
   *  multiplexer that found it. */
  providerId: string;
  /** Session ref a module announced for this agent (transcript path or the CLI's session id): the identity that lets
   *  a multiplexer pane and an agent module reporting the same session share this one character. */
  sessionRef?: string;
  /** Floor id of the machine the agent runs on: `LOCAL_MACHINE_ID` for this one. */
  machineId: string;
  activeToolIds: Set<string>;
  activeToolStatuses: Map<string, string>;
  activeToolNames: Map<string, string>;
  activeSubagentToolIds: Map<string, Set<string>>; // parentToolId → active sub-tool IDs
  /** Tools announced as running in the background: a turn end keeps them and shows them again. */
  backgroundToolIds: Set<string>;
  /** Tools that spawn a teammate, which gets its own character instead of a sub-agent one. */
  teammateSpawnToolIds: Set<string>;
  isWaiting: boolean;
  permissionSent: boolean;
  /** Character label: the workspace folder name, or the module's name for the agent */
  folderName?: string;
  /** Provider-reported one-line summary of the agent's current task */
  task?: string;

  // -- Context window usage --
  /** Tokens in the agent's context as of its newest turn; 0 until reported. */
  contextTokens: number;
  maxContextTokens: number;

  team?: AgentTeam;

  // -- Avatar customization --
  /** Preferred character palette (0-5). If undefined, auto-assigned for diversity. */
  palette?: number;
  /** Hue shift in degrees (0-360). Rotates the base palette colors. */
  hueShift?: number;
}
