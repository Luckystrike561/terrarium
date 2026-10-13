import { describe, expect, it } from 'vitest';

import { resendAgentActivity } from '../src/agentActivityResend.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import type { AgentState } from '../src/types.js';

function createTestAgent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: 0,
    sessionId: 'test-session',
    providerId: 'claude',
    machineId: 'local',
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeToolNames: new Map(),
    activeSubagentToolIds: new Map(),
    backgroundToolIds: new Set(),
    teammateSpawnToolIds: new Set(),
    isWaiting: false,
    permissionSent: false,
    contextTokens: 0,
    maxContextTokens: 200_000,
    ...overrides,
  };
}

describe('resendAgentActivity', () => {
  it('sends messages in order: team info, tools, waiting, context', () => {
    const store = new AgentStateStore();
    store.set(
      1,
      createTestAgent({
        id: 1,
        team: { teamName: 'test-team' },
        activeToolStatuses: new Map([['tool-1', 'Running']]),
        activeToolNames: new Map([['tool-1', 'Bash']]),
        isWaiting: true,
        contextTokens: 50_000,
      }),
    );
    const sent: Array<Record<string, unknown>> = [];
    resendAgentActivity((msg) => sent.push(msg), store);

    expect(sent.map((m) => m.type)).toEqual([
      'agentTeamInfo',
      'agentToolStart',
      'agentStatus',
      'agentContextUsage',
    ]);
  });

  it('includes basic fields for regular tools', () => {
    const store = new AgentStateStore();
    store.set(
      1,
      createTestAgent({
        id: 1,
        activeToolStatuses: new Map([['tool-1', 'Running']]),
        activeToolNames: new Map([['tool-1', 'Bash']]),
      }),
    );
    const sent: Array<Record<string, unknown>> = [];
    resendAgentActivity((msg) => sent.push(msg), store);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      type: 'agentToolStart',
      id: 1,
      toolId: 'tool-1',
      status: 'Running',
      toolName: 'Bash',
    });
  });

  it('replays background tools with their flags after the team info', () => {
    const store = new AgentStateStore();
    store.set(
      1,
      createTestAgent({
        id: 1,
        // A teamed lead: the webview routes agentToolStart by the parent's
        // teamName, so the team message has to land before the tool replays or
        // a background spawn is routed as if the lead had no team.
        team: { teamName: 'test-team' },
        activeToolStatuses: new Map([
          ['bg-unnamed', 'Subtask: Unnamed'],
          ['bg-named', 'Subtask: Named'],
        ]),
        activeToolNames: new Map([
          ['bg-unnamed', 'Agent'],
          ['bg-named', 'Agent'],
        ]),
        backgroundToolIds: new Set(['bg-unnamed', 'bg-named']),
        teammateSpawnToolIds: new Set(['bg-named']),
      }),
    );
    const sent: Array<Record<string, unknown>> = [];
    resendAgentActivity((msg) => sent.push(msg), store);

    const toolStarts = sent.filter((m) => m.type === 'agentToolStart');
    expect(toolStarts).toHaveLength(2);

    // Team info first: the webview reads the parent's teamName to decide whether
    // a background agentToolStart becomes a Subtask sub-character, so a replay
    // that arrives before it is routed against stale team state.
    const teamIdx = sent.findIndex((m) => m.type === 'agentTeamInfo' && m.id === 1);
    const firstBgToolIdx = sent.findIndex((m) => m.type === 'agentToolStart' && m.id === 1);
    expect(teamIdx).toBeGreaterThanOrEqual(0);
    expect(teamIdx).toBeLessThan(firstBgToolIdx);

    // Unnamed: runInBackground=true, no isTeammateSpawn. toolName is required —
    // without it the webview cannot recreate the Subtask after agentToolsClear.
    const unnamed = toolStarts.find((t) => t.toolId === 'bg-unnamed');
    expect(unnamed).toMatchObject({ runInBackground: true, toolName: 'Agent' });
    expect(unnamed?.isTeammateSpawn).toBeUndefined();

    // Named: runInBackground=true, isTeammateSpawn=true, toolName present.
    const named = toolStarts.find((t) => t.toolId === 'bg-named');
    expect(named).toMatchObject({
      runInBackground: true,
      isTeammateSpawn: true,
      toolName: 'Agent',
    });
  });

  it('sends team info for any team field trigger, omits when none present', () => {
    // teamName trigger
    let store = new AgentStateStore();
    store.set(1, createTestAgent({ id: 1, team: { teamName: 'my-team' } }));
    let sent: Array<Record<string, unknown>> = [];
    resendAgentActivity((msg) => sent.push(msg), store);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'agentTeamInfo', id: 1, teamName: 'my-team' });

    // agentName trigger (derived team)
    store = new AgentStateStore();
    store.set(2, createTestAgent({ id: 2, team: { agentName: 'worker-1', leadAgentId: 1 } }));
    sent = [];
    resendAgentActivity((msg) => sent.push(msg), store);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'agentTeamInfo', id: 2, agentName: 'worker-1' });

    // isTeamLead trigger
    store = new AgentStateStore();
    store.set(3, createTestAgent({ id: 3, team: { isTeamLead: true } }));
    sent = [];
    resendAgentActivity((msg) => sent.push(msg), store);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'agentTeamInfo', id: 3, isTeamLead: true });

    // No team fields: no message
    store = new AgentStateStore();
    store.set(4, createTestAgent({ id: 4 }));
    sent = [];
    resendAgentActivity((msg) => sent.push(msg), store);
    expect(sent.filter((m) => m.type === 'agentTeamInfo')).toHaveLength(0);
  });

  it('sends waiting status only when agent is waiting', () => {
    let store = new AgentStateStore();
    store.set(1, createTestAgent({ id: 1, isWaiting: true }));
    let sent: Array<Record<string, unknown>> = [];
    resendAgentActivity((msg) => sent.push(msg), store);
    expect(sent).toEqual([{ type: 'agentStatus', id: 1, status: 'waiting' }]);

    store = new AgentStateStore();
    store.set(2, createTestAgent({ id: 2, isWaiting: false }));
    sent = [];
    resendAgentActivity((msg) => sent.push(msg), store);
    expect(sent).toHaveLength(0);
  });

  it('sends context usage only when agent has tokens', () => {
    let store = new AgentStateStore();
    store.set(1, createTestAgent({ id: 1, contextTokens: 50_000, maxContextTokens: 200_000 }));
    let sent: Array<Record<string, unknown>> = [];
    resendAgentActivity((msg) => sent.push(msg), store);
    expect(sent).toEqual([
      { type: 'agentContextUsage', id: 1, contextTokens: 50_000, maxContextTokens: 200_000 },
    ]);

    store = new AgentStateStore();
    store.set(2, createTestAgent({ id: 2, contextTokens: 0, maxContextTokens: 200_000 }));
    sent = [];
    resendAgentActivity((msg) => sent.push(msg), store);
    expect(sent).toHaveLength(0);
  });

  it('handles edge cases: empty store and multiple agents', () => {
    // Empty store
    let store = new AgentStateStore();
    let sent: Array<Record<string, unknown>> = [];
    resendAgentActivity((msg) => sent.push(msg), store);
    expect(sent).toHaveLength(0);

    // Multiple agents with different activity
    store = new AgentStateStore();
    store.set(
      1,
      createTestAgent({
        id: 1,
        activeToolStatuses: new Map([['tool-1', 'Running']]),
        activeToolNames: new Map([['tool-1', 'Bash']]),
      }),
    );
    store.set(2, createTestAgent({ id: 2, isWaiting: true }));
    sent = [];
    resendAgentActivity((msg) => sent.push(msg), store);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ type: 'agentToolStart', id: 1 });
    expect(sent[1]).toMatchObject({ type: 'agentStatus', id: 2, status: 'waiting' });
  });
});
