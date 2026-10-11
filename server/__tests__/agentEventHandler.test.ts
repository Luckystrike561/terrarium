import { beforeEach, describe, expect, it } from 'vitest';

import type { AgentModule, MultiplexerModule } from '../../core/src/provider.js';
import type { AnnouncedSession } from '../src/agentEventHandler.js';
import { AgentEventHandler } from '../src/agentEventHandler.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import type { RoutedEvent } from '../src/sessionRouter.js';
import { SessionRouter } from '../src/sessionRouter.js';
import type { AgentState } from '../src/types.js';

function createTestAgent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: 1,
    sessionId: '',
    providerId: 'fake-cli',
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

function fileOf(input: unknown): string | undefined {
  if (input && typeof input === 'object' && 'file' in input && typeof input.file === 'string') {
    return input.file;
  }
  return undefined;
}

const fakeAgentModule: AgentModule = {
  kind: 'agent',
  id: 'fake-cli',
  displayName: 'Fake CLI',
  protocolVersion: AgentEventHandler.SUPPORTED_PROTOCOL_VERSION,
  formatToolStatus: (toolName, input) => {
    const file = fileOf(input);
    return file ? `Using ${toolName} on ${file}` : `Using ${toolName}`;
  },
  permissionExemptTools: new Set(),
  subagentToolNames: new Set(),
  readingTools: new Set(),
};
const outdatedAgentModule: AgentModule = {
  ...fakeAgentModule,
  id: 'old-cli',
  protocolVersion: AgentEventHandler.SUPPORTED_PROTOCOL_VERSION - 1,
};
const fakeMultiplexerModule: MultiplexerModule = {
  kind: 'multiplexer',
  id: 'fake-mux',
  displayName: 'Fake Multiplexer',
  connect: () => ({ stop: () => {} }),
  probe: () => Promise.resolve(undefined),
};

describe('AgentEventHandler', () => {
  let agents: AgentStateStore;
  let messages: Array<Record<string, unknown>>;
  let sessionRouter: SessionRouter<RoutedEvent, AnnouncedSession>;
  let handler: AgentEventHandler;
  let detected: AnnouncedSession[];
  let ended: number[];

  /** Put agent 1 on screen, routed from `sessionId` of `sourceId`. */
  function seedAgent(overrides: Partial<AgentState> = {}, sourceId = 'fake-cli'): AgentState {
    const agent = createTestAgent({ sessionId: 'sess-1', ...overrides });
    agents.set(agent.id, agent);
    handler.registerAgent(agent.sessionId, agent.id, sourceId);
    return agent;
  }

  const ofType = (type: string) => messages.filter((m) => m.type === type);

  beforeEach(() => {
    agents = new AgentStateStore();
    messages = [];
    agents.on('broadcast', (msg) => messages.push(msg));
    sessionRouter = new SessionRouter();
    handler = new AgentEventHandler(
      agents,
      { agents: [fakeAgentModule, outdatedAgentModule], multiplexers: [fakeMultiplexerModule] },
      sessionRouter,
    );
    detected = [];
    ended = [];
    handler.setLifecycleCallbacks({
      onSessionDetected: (session) => detected.push(session),
      onSessionEnd: (agentId) => ended.push(agentId),
    });
  });

  describe('session lifecycle', () => {
    it('a sessionStart waits for its first event before the session is detected', () => {
      handler.handleAgentEvent('fake-cli', 'ext', { kind: 'sessionStart', cwd: '/work/alpha' });
      expect(detected).toEqual([]);
      expect(sessionRouter.hasPending('ext')).toBe(true);

      handler.handleAgentEvent('fake-cli', 'ext', { kind: 'working' });
      expect(detected).toEqual([
        expect.objectContaining({ sessionId: 'ext', cwd: '/work/alpha', sourceIds: ['fake-cli'] }),
      ]);
    });

    it('a live sessionStart is detected at once, with the label and team its module gave it', () => {
      handler.handleAgentEvent('fake-cli', 'live', {
        kind: 'sessionStart',
        live: true,
        sessionRef: '/work/live.jsonl',
        folderName: 'alpha',
        team: { teamName: 'crew', agentName: 'scout' },
      });
      expect(detected).toEqual([
        expect.objectContaining({
          sessionId: 'live',
          sessionRef: '/work/live.jsonl',
          folderName: 'alpha',
          team: { teamName: 'crew', agentName: 'scout' },
        }),
      ]);
    });

    it('a session that ends before its first event never gets a character', () => {
      handler.handleAgentEvent('fake-cli', 'transient', { kind: 'sessionStart', cwd: '/w' });
      handler.handleAgentEvent('fake-cli', 'transient', { kind: 'sessionEnd' });
      handler.handleAgentEvent('fake-cli', 'transient', { kind: 'working' });
      expect(detected).toEqual([]);
    });

    it('a sessionStart for a session already routed updates its ref and creates nothing', () => {
      const agent = seedAgent({ sessionRef: 'old-id' });
      handler.handleAgentEvent('fake-cli', 'sess-1', {
        kind: 'sessionStart',
        source: 'clear',
        sessionRef: 'new-id',
      });
      expect(agent.sessionRef).toBe('new-id');
      expect(detected).toEqual([]);
    });

    it('sessionEnd ends the agent its session routes to', () => {
      seedAgent();
      handler.handleAgentEvent('fake-cli', 'sess-1', { kind: 'sessionEnd', reason: 'exit' });
      expect(ended).toEqual([1]);
    });

    it('silently drops events for sessions nobody announced', () => {
      handler.handleAgentEvent('fake-cli', 'nobody', { kind: 'turnEnd' });
      expect(messages).toEqual([]);
      expect(detected).toEqual([]);
    });

    it('drops every event of a module speaking another protocol version', () => {
      handler.handleAgentEvent('old-cli', 'old', { kind: 'sessionStart', live: true });
      expect(detected).toEqual([]);
    });

    it('unregisterAgent drops every session routed to the agent', () => {
      seedAgent();
      handler.registerAgent('pane-1', 1, 'fake-mux');
      expect(handler.sessionsOf(1)).toEqual([
        { sessionId: 'sess-1', sourceId: 'fake-cli' },
        { sessionId: 'pane-1', sourceId: 'fake-mux' },
      ]);
      handler.unregisterAgent(1);
      expect(handler.sessionsOf(1)).toEqual([]);
    });
  });

  describe('claimBySessionRef (one agent, one character)', () => {
    it('a sessionStart whose sessionRef an existing agent already reports joins that agent immediately', () => {
      seedAgent({ sessionId: 'herdr-sess-1', sessionRef: '/work/alpha/session.jsonl' }, 'fake-mux');

      handler.handleAgentEvent('fake-cli', 'cli-sess-2', {
        kind: 'sessionStart',
        sessionRef: '/work/alpha/session.jsonl',
        cwd: '/work/alpha',
      });

      expect(sessionRouter.resolve('cli-sess-2')).toBe(1);
      expect(detected).toEqual([]);

      handler.handleAgentEvent('fake-cli', 'cli-sess-2', { kind: 'working' });
      expect(messages).toContainEqual(
        expect.objectContaining({ type: 'agentStatus', id: 1, status: 'active' }),
      );
    });

    it('a live sessionStart whose ref an agent already reports joins it instead of creating one', () => {
      seedAgent({ sessionId: 'herdr-sess-1', sessionRef: 'claude-session-id' }, 'fake-mux');
      handler.handleAgentEvent('fake-cli', 'cli-key', {
        kind: 'sessionStart',
        live: true,
        sessionRef: 'claude-session-id',
      });
      expect(sessionRouter.resolve('cli-key')).toBe(1);
      expect(detected).toEqual([]);
    });

    it('a pending session joins the agent that reports its ref by the time it is confirmed', () => {
      handler.handleAgentEvent('fake-mux', 'pane', {
        kind: 'sessionStart',
        sessionRef: 'shared',
        cwd: '/w',
      });
      seedAgent({ sessionId: 'cli-key', sessionRef: 'shared' });
      handler.handleAgentEvent('fake-mux', 'pane', { kind: 'sessionInfo', name: 'pane name' });
      expect(sessionRouter.resolve('pane')).toBe(1);
      expect(detected).toEqual([]);
    });

    it('a sessionStart with a different sessionRef does not join the existing agent', () => {
      seedAgent({ sessionId: 'herdr-sess-1', sessionRef: '/work/alpha/session.jsonl' });

      handler.handleAgentEvent('fake-cli', 'cli-sess-3', {
        kind: 'sessionStart',
        sessionRef: '/work/beta/session.jsonl',
        cwd: '/work/beta',
      });
      expect(sessionRouter.resolve('cli-sess-3')).toBeUndefined();
      expect(sessionRouter.hasPending('cli-sess-3')).toBe(true);

      handler.handleAgentEvent('fake-cli', 'cli-sess-3', { kind: 'working' });
      expect(detected).toEqual([
        expect.objectContaining({
          sessionId: 'cli-sess-3',
          sessionRef: '/work/beta/session.jsonl',
        }),
      ]);
    });

    it('an agent without a session ref is never joined, so two sessions with no shared ref stay separate', () => {
      seedAgent({ sessionId: 'a', sessionRef: undefined });
      handler.handleAgentEvent('fake-cli', 'b', {
        kind: 'sessionStart',
        sessionRef: '/project/session-a.jsonl',
        cwd: '/project',
      });
      handler.handleAgentEvent('fake-cli', 'b', { kind: 'turnEnd' });
      expect(sessionRouter.resolve('b')).toBeUndefined();
      expect(detected).toEqual([expect.objectContaining({ sessionId: 'b' })]);
    });

    it('providerId is set by the first agent-module event and is not overwritten by a later multiplexer event', () => {
      const agent = seedAgent({ providerId: 'fake-mux' }, 'fake-mux');
      handler.registerAgent('cli-sess', 1, 'fake-cli');

      handler.handleAgentEvent('fake-cli', 'cli-sess', { kind: 'working' });
      expect(agent.providerId).toBe('fake-cli');

      handler.handleAgentEvent('fake-mux', 'sess-1', { kind: 'working' });
      expect(agent.providerId).toBe('fake-cli');
    });
  });

  describe('coarse turn activity', () => {
    it('toolStart shows the tool with the module status text and makes the agent active', () => {
      const agent = seedAgent({ isWaiting: true });
      handler.handleAgentEvent('fake-cli', 'sess-1', {
        kind: 'toolStart',
        toolId: 't1',
        toolName: 'read',
        input: { file: 'a.ts' },
      });
      expect(ofType('agentToolStart')).toEqual([
        expect.objectContaining({
          id: 1,
          toolId: 't1',
          toolName: 'read',
          status: 'Using read on a.ts',
        }),
      ]);
      expect(ofType('agentStatus').at(-1)).toMatchObject({ id: 1, status: 'active' });
      expect(agent.isWaiting).toBe(false);
      expect(agent.activeToolStatuses.get('t1')).toBe('Using read on a.ts');
    });

    it('toolEnd marks exactly that tool done', () => {
      const agent = seedAgent();
      handler.handleAgentEvent('fake-cli', 'sess-1', {
        kind: 'toolStart',
        toolId: 't1',
        toolName: 'a',
      });
      handler.handleAgentEvent('fake-cli', 'sess-1', {
        kind: 'toolStart',
        toolId: 't2',
        toolName: 'b',
      });
      handler.handleAgentEvent('fake-cli', 'sess-1', { kind: 'toolEnd', toolId: 't1' });
      expect(ofType('agentToolDone')).toEqual([{ type: 'agentToolDone', id: 1, toolId: 't1' }]);
      expect([...agent.activeToolIds]).toEqual(['t2']);
    });

    it('turnEnd clears foreground tools, shows background ones again, then waits', () => {
      const agent = seedAgent();
      handler.handleAgentEvent('fake-cli', 'sess-1', {
        kind: 'toolStart',
        toolId: 'fg',
        toolName: 'a',
      });
      handler.handleAgentEvent('fake-cli', 'sess-1', {
        kind: 'toolStart',
        toolId: 'bg',
        toolName: 'Agent',
        runInBackground: true,
      });
      messages.length = 0;

      handler.handleAgentEvent('fake-cli', 'sess-1', { kind: 'turnEnd' });

      expect(messages.map((m) => m.type)).toEqual([
        'agentToolsClear',
        'agentToolStart',
        'agentStatus',
      ]);
      expect(messages[1]).toMatchObject({ toolId: 'bg', toolName: 'Agent', runInBackground: true });
      expect(messages[2]).toMatchObject({ status: 'waiting', awaitingInput: false });
      expect([...agent.activeToolIds]).toEqual(['bg']);
      expect(agent.isWaiting).toBe(true);
    });

    it('turnEnd with awaitingInput reports "Waiting for input"', () => {
      seedAgent();
      handler.handleAgentEvent('fake-cli', 'sess-1', { kind: 'turnEnd', awaitingInput: true });
      expect(ofType('agentStatus').at(-1)).toMatchObject({
        status: 'waiting',
        awaitingInput: true,
      });
    });

    it('permissionRequest shows the bubble on the agent and on every sub-agent with tools running', () => {
      const agent = seedAgent();
      agent.activeSubagentToolIds.set('parent', new Set(['sub']));
      handler.handleAgentEvent('fake-cli', 'sess-1', { kind: 'permissionRequest' });
      expect(ofType('agentToolPermission')).toEqual([{ type: 'agentToolPermission', id: 1 }]);
      expect(ofType('subagentToolPermission')).toEqual([
        { type: 'subagentToolPermission', id: 1, parentToolId: 'parent' },
      ]);
      expect(agent.permissionSent).toBe(true);
    });

    it('working withdraws a pending permission ask', () => {
      seedAgent({ permissionSent: true, isWaiting: true });
      handler.handleAgentEvent('fake-cli', 'sess-1', { kind: 'working' });
      expect(messages.map((m) => m.type)).toEqual(['agentToolPermissionClear', 'agentStatus']);
    });

    it('sessionInfo renames the character and sets its task', () => {
      const agent = seedAgent();
      handler.handleAgentEvent('fake-mux', 'sess-1', { kind: 'sessionInfo', name: 'n', task: 't' });
      expect(agent.folderName).toBe('n');
      expect(agent.task).toBe('t');
      expect(ofType('agentInfo')).toEqual([{ type: 'agentInfo', id: 1, name: 'n', task: 't' }]);
    });
  });

  describe('presentation events', () => {
    it('toolShown shows the tool exactly as the module formatted it, flags included', () => {
      const agent = seedAgent();
      handler.handleAgentEvent('fake-cli', 'sess-1', {
        kind: 'toolShown',
        toolId: 'spawn',
        toolName: 'Agent',
        status: 'Subtask: research',
        runInBackground: true,
        isTeammateSpawn: true,
      });
      expect(ofType('agentToolStart')).toEqual([
        expect.objectContaining({
          id: 1,
          toolId: 'spawn',
          toolName: 'Agent',
          status: 'Subtask: research',
          runInBackground: true,
          isTeammateSpawn: true,
        }),
      ]);
      expect(ofType('agentStatus')).toEqual([]);
      expect(agent.backgroundToolIds.has('spawn')).toBe(true);
      expect(agent.teammateSpawnToolIds.has('spawn')).toBe(true);
    });

    it('toolsCleared forgets foreground tools and keeps background ones, broadcasting only the clear', () => {
      const agent = seedAgent();
      handler.handleAgentEvent('fake-cli', 'sess-1', {
        kind: 'toolShown',
        toolId: 'fg',
        status: 'x',
      });
      handler.handleAgentEvent('fake-cli', 'sess-1', {
        kind: 'toolShown',
        toolId: 'bg',
        status: 'y',
        runInBackground: true,
      });
      messages.length = 0;
      handler.handleAgentEvent('fake-cli', 'sess-1', { kind: 'toolsCleared' });
      expect(messages).toEqual([{ type: 'agentToolsClear', id: 1 }]);
      expect([...agent.activeToolIds]).toEqual(['bg']);
    });

    it('statusChanged passes the status through and tracks waiting', () => {
      const agent = seedAgent({ permissionSent: true });
      handler.handleAgentEvent('fake-cli', 'sess-1', {
        kind: 'statusChanged',
        status: 'waiting',
        awaitingInput: false,
      });
      expect(messages).toEqual([
        { type: 'agentStatus', id: 1, status: 'waiting', awaitingInput: false },
      ]);
      expect(agent.isWaiting).toBe(true);
      expect(agent.permissionSent).toBe(false);
    });

    it('sub-agent tools are tracked under their parent until the sub-agent is cleared', () => {
      const agent = seedAgent();
      handler.handleAgentEvent('fake-cli', 'sess-1', {
        kind: 'subagentToolShown',
        parentToolId: 'p',
        toolId: 's',
        status: 'Reading',
      });
      expect(agent.activeSubagentToolIds.get('p')).toEqual(new Set(['s']));
      handler.handleAgentEvent('fake-cli', 'sess-1', {
        kind: 'subagentPermissionShown',
        parentToolId: 'p',
      });
      handler.handleAgentEvent('fake-cli', 'sess-1', {
        kind: 'subagentCleared',
        parentToolId: 'p',
      });
      expect(agent.activeSubagentToolIds.has('p')).toBe(false);
      expect(messages.map((m) => m.type)).toEqual([
        'subagentToolStart',
        'subagentToolPermission',
        'subagentClear',
      ]);
    });

    it('teamChanged names the lead by its agent id and keeps the last known teamUsesTmux', () => {
      seedAgent({ id: 1, sessionId: 'lead-key' });
      const teammate = seedAgent({ id: 2, sessionId: 'mate-key' });
      handler.handleAgentEvent('fake-cli', 'mate-key', {
        kind: 'teamChanged',
        team: {
          teamName: 'crew',
          agentName: 'scout',
          leadSessionId: 'lead-key',
          teamUsesTmux: true,
        },
      });
      handler.handleAgentEvent('fake-cli', 'mate-key', {
        kind: 'teamChanged',
        team: { teamName: 'crew', agentName: 'scout', leadSessionId: 'lead-key' },
      });
      expect(teammate.team).toEqual({
        teamName: 'crew',
        agentName: 'scout',
        isTeamLead: undefined,
        leadAgentId: 1,
        teamUsesTmux: true,
      });
      expect(ofType('agentTeamInfo').at(-1)).toEqual({
        type: 'agentTeamInfo',
        id: 2,
        teamName: 'crew',
        agentName: 'scout',
        isTeamLead: undefined,
        leadAgentId: 1,
        teamUsesTmux: undefined,
      });
    });

    it('contextUsage sets the gauge', () => {
      const agent = seedAgent();
      handler.handleAgentEvent('fake-cli', 'sess-1', {
        kind: 'contextUsage',
        contextTokens: 1234,
        maxContextTokens: 1_000_000,
      });
      expect(agent.contextTokens).toBe(1234);
      expect(ofType('agentContextUsage')).toEqual([
        { type: 'agentContextUsage', id: 1, contextTokens: 1234, maxContextTokens: 1_000_000 },
      ]);
    });
  });

  it('dispose leaves no routes behind', () => {
    seedAgent();
    handler.dispose();
    handler.handleAgentEvent('fake-cli', 'sess-1', { kind: 'working' });
    expect(messages).toEqual([]);
  });
});
