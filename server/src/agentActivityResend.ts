import type { AgentStateStore } from './agentStateStore.js';

/**
 * Replay an agent's active state to a connecting client.
 *
 * Order matters:
 * 1. Team info first — webview needs team context before tool messages
 * 2. Regular tools
 * 3. Background tools with runInBackground + isTeammateSpawn flags
 * 4. Waiting status
 * 5. Context usage
 */
export function resendAgentActivity(
  send: (message: Record<string, unknown>) => void,
  store: AgentStateStore,
): void {
  for (const [id, agent] of store) {
    // 1. Team metadata first — webview uses this to route tool messages correctly.
    // Derived teams (named background spawns) have a name and a lead link but NO
    // teamName, so gate on any team field.
    const team = agent.team;
    if (team && (team.teamName || team.agentName || team.isTeamLead)) {
      send({
        type: 'agentTeamInfo',
        id,
        teamName: team.teamName,
        agentName: team.agentName,
        isTeamLead: team.isTeamLead,
        leadAgentId: team.leadAgentId,
        teamUsesTmux: team.teamUsesTmux,
      });
    }

    // 2. Regular (non-background) tools
    for (const [toolId, status] of agent.activeToolStatuses) {
      // Skip background tools here — they're sent separately below with proper flags
      if (agent.backgroundToolIds.has(toolId)) continue;

      const toolName = agent.activeToolNames.get(toolId) ?? '';
      send({
        type: 'agentToolStart',
        id,
        toolId,
        status,
        toolName,
      });
    }

    // 3. Background tools with runInBackground flag. A teammate spawn carries isTeammateSpawn, so the webview
    // never creates a Subtask character beside the teammate's own.
    for (const toolId of agent.backgroundToolIds) {
      const status = agent.activeToolStatuses.get(toolId);
      if (!status) continue;

      const toolName = agent.activeToolNames.get(toolId);
      send({
        type: 'agentToolStart',
        id,
        toolId,
        status,
        toolName,
        runInBackground: true,
        isTeammateSpawn: agent.teammateSpawnToolIds.has(toolId) || undefined,
      });
    }

    // 4. Waiting status
    if (agent.isWaiting) {
      send({
        type: 'agentStatus',
        id,
        status: 'waiting',
      });
    }

    // 5. Context usage
    if (agent.contextTokens > 0) {
      send({
        type: 'agentContextUsage',
        id,
        contextTokens: agent.contextTokens,
        maxContextTokens: agent.maxContextTokens,
      });
    }

    if (agent.task) {
      send({ type: 'agentInfo', id, task: agent.task });
    }
  }
}
