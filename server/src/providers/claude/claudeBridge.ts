import * as path from 'path';

import type { AgentEvent, ModuleHost, TeamMembership } from '../../../../core/src/provider.js';
import type { ClaudeAgentState, ClaudeAgentStore } from './claudeAgentStore.js';

/** Stable session key for a private Claude agent, for its whole life (also across /clear). */
export function sessionKey(privateId: number): string {
  return `claude-${privateId}`;
}

/** The private id a session key names, or undefined when it names no Claude agent. */
export function privateIdOf(key: string): number | undefined {
  if (!key.startsWith('claude-')) return undefined;
  const id = Number(key.slice('claude-'.length));
  return Number.isInteger(id) ? id : undefined;
}

/**
 * The session's identity as a Claude multiplexer pane or herdr report it: the Claude session id when the
 * transcript is the top-level `<sessionId>.jsonl` (what herdr reports for Claude panes, so a pane and this module
 * land on one character), else the transcript path (teammates / background teammates share the lead's session id
 * and must not collide this way). A hooks-only agent (no transcript) uses its session id.
 */
export function sessionRefOf(agent: ClaudeAgentState): string {
  if (agent.hooksOnly || !agent.jsonlFile) return agent.sessionId;
  const isTopLevel = path.basename(agent.jsonlFile, '.jsonl') === agent.sessionId;
  return isTopLevel ? agent.sessionId : agent.jsonlFile;
}

/** Subscribes to a ClaudeAgentStore's events and re-emits them as AgentEvents on a ModuleHost. One bridge per
 *  private store: the engine's own business (transcript cursors, hook correlation, team discovery) never crosses
 *  this boundary, only the events the office needs to show a character. */
export function bridgeClaudeStore(store: ClaudeAgentStore, host: ModuleHost): () => void {
  const onAgentAdded = (id: number, agent: ClaudeAgentState): void => {
    const event: AgentEvent = {
      kind: 'sessionStart',
      source: 'startup',
      live: true,
      sessionRef: sessionRefOf(agent),
      folderName: agent.folderName,
      team: teamOf(agent),
    };
    host.emit(sessionKey(id), event);
  };
  const onAgentRemoved = (id: number): void => {
    host.emit(sessionKey(id), { kind: 'sessionEnd', reason: 'exit' });
  };
  const onBroadcast = (message: Record<string, unknown>): void => {
    const event = translateBroadcast(message);
    if (!event) return;
    const id = message.id as number;
    host.emit(sessionKey(id), event);
  };

  store.on('agentAdded', onAgentAdded);
  store.on('agentRemoved', onAgentRemoved);
  store.on('broadcast', onBroadcast);

  return () => {
    store.off('agentAdded', onAgentAdded);
    store.off('agentRemoved', onAgentRemoved);
    store.off('broadcast', onBroadcast);
  };
}

/** Re-emit a /clear reassignment: same session key, new sessionRef, so the runtime updates that agent's ref
 *  without a new character. */
export function emitSessionReassigned(host: ModuleHost, id: number, agent: ClaudeAgentState): void {
  host.emit(sessionKey(id), {
    kind: 'sessionStart',
    source: 'clear',
    live: true,
    sessionRef: sessionRefOf(agent),
    folderName: agent.folderName,
    team: teamOf(agent),
  });
}

function teamOf(agent: ClaudeAgentState): TeamMembership | undefined {
  if (!agent.teamName && agent.leadAgentId === undefined && !agent.isTeamLead) return undefined;
  return {
    teamName: agent.teamName,
    agentName: agent.agentName,
    isTeamLead: agent.isTeamLead,
    leadSessionId: agent.leadAgentId !== undefined ? sessionKey(agent.leadAgentId) : undefined,
    teamUsesTmux: agent.teamUsesTmux,
  };
}

function translateBroadcast(message: Record<string, unknown>): AgentEvent | null {
  switch (message.type) {
    case 'agentToolStart':
      return {
        kind: 'toolShown',
        toolId: message.toolId as string,
        toolName: message.toolName as string | undefined,
        status: message.status as string,
        permissionActive: message.permissionActive as boolean | undefined,
        runInBackground: message.runInBackground as boolean | undefined,
        isTeammateSpawn: message.isTeammateSpawn as boolean | undefined,
      };
    case 'agentToolDone':
      return { kind: 'toolDone', toolId: message.toolId as string };
    case 'agentToolsClear':
      return { kind: 'toolsCleared' };
    case 'agentStatus':
      return {
        kind: 'statusChanged',
        status: message.status as 'active' | 'waiting',
        awaitingInput: message.awaitingInput as boolean | undefined,
      };
    case 'agentToolPermission':
      return { kind: 'permissionShown' };
    case 'agentToolPermissionClear':
      return { kind: 'permissionCleared' };
    case 'subagentToolStart':
      return {
        kind: 'subagentToolShown',
        parentToolId: message.parentToolId as string,
        toolId: message.toolId as string,
        status: message.status as string,
      };
    case 'subagentToolDone':
      return {
        kind: 'subagentToolDone',
        parentToolId: message.parentToolId as string,
        toolId: message.toolId as string,
      };
    case 'subagentToolPermission':
      return { kind: 'subagentPermissionShown', parentToolId: message.parentToolId as string };
    case 'subagentClear':
      return { kind: 'subagentCleared', parentToolId: message.parentToolId as string };
    case 'agentTeamInfo': {
      const leadAgentId = message.leadAgentId as number | undefined;
      return {
        kind: 'teamChanged',
        team: {
          teamName: message.teamName as string | undefined,
          agentName: message.agentName as string | undefined,
          isTeamLead: message.isTeamLead as boolean | undefined,
          leadSessionId: leadAgentId !== undefined ? sessionKey(leadAgentId) : undefined,
          teamUsesTmux: message.teamUsesTmux as boolean | undefined,
        },
      };
    }
    case 'agentContextUsage':
      return {
        kind: 'contextUsage',
        contextTokens: message.contextTokens as number,
        maxContextTokens: message.maxContextTokens as number,
      };
    // agentInfo (sessionInfo) has no Claude-side producer today; dropped here on purpose.
    default:
      return null;
  }
}
