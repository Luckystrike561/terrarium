import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type ClaudeAgentState,
  ClaudeAgentStore,
} from '../src/providers/claude/claudeAgentStore.js';
import {
  scanForBackgroundAgentFiles,
  setSubagentWatch,
} from '../src/providers/claude/claudeFileWatcher.js';
import {
  processTranscriptLine,
  setBackgroundAgentCompletedCallback,
  setBackgroundAgentDetectedCallback,
} from '../src/providers/claude/claudeTranscriptParser.js';
import { SubagentWatch } from '../src/providers/claude/subagentWatch.js';

const LEAD_SESSION = 'lead-session-1';
const SPAWN_TOOL_ID = 'toolu_01LMvN98KN4sn1fmvftm7vhk';
const SUB_TOOL_ID = 'toolu_sub_01';

function createLeadAgent(projectDir: string): ClaudeAgentState {
  return {
    id: 1,
    sessionId: LEAD_SESSION,
    projectDir,
    jsonlFile: path.join(projectDir, `${LEAD_SESSION}.jsonl`),
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeToolNames: new Map(),
    activeSubagentToolIds: new Map(),
    activeSubagentToolNames: new Map(),
    backgroundAgentToolIds: new Set(),
    isWaiting: false,
    permissionSent: false,
    hadToolsInTurn: false,
    lastDataAt: 0,
    linesProcessed: 0,
    seenUnknownRecordTypes: new Set(),
    hookDelivered: false,
    contextTokens: 0,
    maxContextTokens: 200_000,
  } as ClaudeAgentState;
}

/** Records shaped like the background-agent flow (Claude 2.1.x, teams OFF):
 *  unflagged Agent tool_use, "Async agent launched" result, queue-operation
 *  completion. */
function agentSpawnRecord(): string {
  return JSON.stringify({
    type: 'assistant',
    message: {
      content: [
        {
          type: 'tool_use',
          id: SPAWN_TOOL_ID,
          name: 'Agent',
          input: { description: 'Say hello', subagent_type: 'general-purpose' },
        },
      ],
    },
  });
}

function namedAgentSpawnRecord(): string {
  return JSON.stringify({
    type: 'assistant',
    message: {
      content: [
        {
          type: 'tool_use',
          id: SPAWN_TOOL_ID,
          name: 'Agent',
          input: {
            description: 'ghost writer probe',
            name: 'ghost-writer',
            subagent_type: 'general-purpose',
          },
        },
      ],
    },
  });
}

function asyncLaunchResultRecord(): string {
  return JSON.stringify({
    type: 'user',
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: SPAWN_TOOL_ID,
          content: [
            {
              type: 'text',
              text: 'Async agent launched successfully. (This tool result is internal metadata.)\nagentId: a4cb86c99458dbe55 (internal)',
            },
          ],
        },
      ],
    },
  });
}

function queueOpCompletionRecord(): string {
  return JSON.stringify({
    type: 'queue-operation',
    operation: 'enqueue',
    content: `<task-notification> <task-id>a4cb86c99458dbe55</task-id> <tool-use-id>${SPAWN_TOOL_ID}</tool-use-id> <output>done</output>`,
  });
}

/** Lines for the SPAWN's OWN transcript (watched by the shadow store). */
function subToolUseLine(): string {
  return JSON.stringify({
    type: 'assistant',
    message: {
      content: [
        { type: 'tool_use', id: SUB_TOOL_ID, name: 'Read', input: { file_path: '/tmp/x.ts' } },
      ],
    },
  });
}

function subToolResultLine(): string {
  return JSON.stringify({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: SUB_TOOL_ID, content: 'ok' }] },
  });
}

function subTurnDurationLine(): string {
  return JSON.stringify({ type: 'system', subtype: 'turn_duration' });
}

describe('background spawns (teams OFF) classified by sidecar name', () => {
  let tmpRoot: string;
  let agents: ClaudeAgentStore;
  let watch: SubagentWatch;
  let lead: ClaudeAgentState;
  let messages: Array<Record<string, unknown>>;
  let completed: Array<{ leadId: number; toolUseId: string }>;
  const waitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const pollingTimers = new Map<number, ReturnType<typeof setInterval>>();
  const fileWatchers = new Map<number, fs.FSWatcher>();

  /** Mirrors the agentRuntime wiring for the two transcriptParser callbacks. */
  function wireCallbacks() {
    setBackgroundAgentDetectedCallback((leadId) => {
      scanForBackgroundAgentFiles(
        leadId,
        agents,
        { current: 100 },
        fileWatchers,
        pollingTimers,
        waitingTimers,
        permissionTimers,
      );
    });
    setBackgroundAgentCompletedCallback((leadId, toolUseId) => {
      completed.push({ leadId, toolUseId });
      for (const [id, a] of agents) {
        if (a.leadAgentId === leadId && a.spawnToolUseId === toolUseId) {
          agents.delete(id);
          break;
        }
      }
      watch.removeBySpawn(leadId, toolUseId);
    });
  }

  function seedSidecar(opts?: { name?: string; transcriptLines?: string[] }): string {
    const subagentsDir = path.join(tmpRoot, LEAD_SESSION, 'subagents');
    fs.mkdirSync(subagentsDir, { recursive: true });
    const jsonlPath = path.join(subagentsDir, 'agent-a4cb86c99458dbe55.jsonl');
    const lines = opts?.transcriptLines ?? [];
    fs.writeFileSync(jsonlPath, lines.length > 0 ? lines.join('\n') + '\n' : '');
    fs.writeFileSync(
      path.join(subagentsDir, 'agent-a4cb86c99458dbe55.meta.json'),
      JSON.stringify({
        agentType: 'general-purpose',
        description: 'Say hello',
        toolUseId: SPAWN_TOOL_ID,
        spawnDepth: 1,
        ...(opts?.name ? { name: opts.name } : {}),
      }),
    );
    return jsonlPath;
  }

  function spawnAndLaunch(): void {
    processTranscriptLine(1, agentSpawnRecord(), agents, waitingTimers, permissionTimers);
    processTranscriptLine(1, asyncLaunchResultRecord(), agents, waitingTimers, permissionTimers);
  }

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'terrarium-bg-'));
    agents = new ClaudeAgentStore();
    watch = new SubagentWatch(agents);
    setSubagentWatch(watch);
    lead = createLeadAgent(tmpRoot);
    agents.set(1, lead);
    messages = [];
    completed = [];
    agents.on('broadcast', (m) => messages.push(m as Record<string, unknown>));
    wireCallbacks();
  });

  afterEach(() => {
    setBackgroundAgentDetectedCallback(() => {});
    setBackgroundAgentCompletedCallback(() => {});
    watch.dispose();
    setSubagentWatch(null);
    for (const t of pollingTimers.values()) clearInterval(t);
    pollingTimers.clear();
    vi.useRealTimers();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  // ── Unnamed spawn = Sub-agent (shadow-watched) ──────────────────────

  it('flags a NAMED spawn as isTeammateSpawn so the webview never creates a Subtask ghost', () => {
    processTranscriptLine(1, namedAgentSpawnRecord(), agents, waitingTimers, permissionTimers);

    const start = messages.find((m) => m.type === 'agentToolStart' && m.toolId === SPAWN_TOOL_ID);
    expect(start).toBeDefined();
    expect(start!.isTeammateSpawn).toBe(true);

    // The async re-broadcast and the turn-end re-send must carry the flag too
    // (a turn can end before the teammate character is discovered).
    processTranscriptLine(1, asyncLaunchResultRecord(), agents, waitingTimers, permissionTimers);
    messages.length = 0;
    processTranscriptLine(
      1,
      JSON.stringify({ type: 'system', subtype: 'turn_duration' }),
      agents,
      waitingTimers,
      permissionTimers,
    );
    for (const m of messages) {
      if (m.type === 'agentToolStart' && m.toolId === SPAWN_TOOL_ID) {
        expect(m.isTeammateSpawn).toBe(true);
      }
    }
  });

  it('does not flag an unnamed spawn as isTeammateSpawn', () => {
    processTranscriptLine(1, agentSpawnRecord(), agents, waitingTimers, permissionTimers);
    const start = messages.find((m) => m.type === 'agentToolStart' && m.toolId === SPAWN_TOOL_ID);
    expect(start).toBeDefined();
    expect(start!.isTeammateSpawn).toBeUndefined();
  });

  it('re-broadcasts the spawn tool flagged runInBackground when the async result lands', () => {
    // The tool_use input OMITS run_in_background on current harnesses, so the
    // original agentToolStart went out unflagged. Without the flagged
    // re-broadcast, the webview removes the Subtask at the first turn-end
    // clear and recreates it at a new tile (the teleport bug).
    seedSidecar();
    spawnAndLaunch();

    const flagged = messages.find(
      (m) =>
        m.type === 'agentToolStart' && m.toolId === SPAWN_TOOL_ID && m.runInBackground === true,
    );
    expect(flagged).toBeDefined();
    expect(flagged!.toolName).toBe('Agent');
  });

  it('watches an unnamed spawn in the shadow store instead of creating a character', () => {
    const jsonlPath = seedSidecar();
    spawnAndLaunch();

    expect(lead.backgroundAgentToolIds.has(SPAWN_TOOL_ID)).toBe(true);
    // No main-store child, so no agentCreated fires and nothing is persisted.
    expect([...agents.values()].some((a) => a.leadAgentId === 1)).toBe(false);
    // The transient Subtask sub-character must LIVE: no ghost-kill.
    expect(
      messages.some((m) => m.type === 'subagentClear' && m.parentToolId === SPAWN_TOOL_ID),
    ).toBe(false);
    expect(watch.isWatching(jsonlPath)).toBe(true);
  });

  it('translates the watched transcript into subagent* messages keyed to the spawn tool', () => {
    vi.useFakeTimers();
    seedSidecar({ transcriptLines: [subToolUseLine(), subToolResultLine()] });
    spawnAndLaunch();

    const start = messages.find((m) => m.type === 'subagentToolStart');
    expect(start).toBeDefined();
    expect(start!.id).toBe(1);
    expect(start!.parentToolId).toBe(SPAWN_TOOL_ID);
    expect(start!.toolId).toBe(SUB_TOOL_ID);
    expect(start!.status).toContain('x.ts');

    // Per-tool dones are DEFERRED to the sub's turn end: emitting them as they
    // happened made the sub-character flap between typing and idle on every
    // tool boundary.
    vi.advanceTimersByTime(400);
    expect(messages.some((m) => m.type === 'subagentToolDone')).toBe(false);

    // Nothing leaks through untranslated: the shadow agent's own lifecycle
    // messages must not reach the webview with a shadow id.
    expect(messages.some((m) => (m.id as number) >= 1_000_000)).toBe(false);
  });

  it('marks sub tools done when the watched transcript ends its turn cleanly', () => {
    // tool_result BEFORE turn_duration: nothing left to clear at turn end, so
    // the done batch must ride the agentStatus:waiting broadcast instead.
    seedSidecar({
      transcriptLines: [subToolUseLine(), subToolResultLine(), subTurnDurationLine()],
    });
    spawnAndLaunch();

    const done = messages.find((m) => m.type === 'subagentToolDone' && m.toolId === SUB_TOOL_ID);
    expect(done).toBeDefined();
    expect(done!.id).toBe(1);
    expect(done!.parentToolId).toBe(SPAWN_TOOL_ID);
  });

  it('synthesizes subagentToolDone for live tools when the watched transcript hits turn end', () => {
    seedSidecar({ transcriptLines: [subToolUseLine(), subTurnDurationLine()] });
    spawnAndLaunch();

    // No tool_result arrived; turn_duration (-> agentToolsClear on the shadow
    // agent) must still resolve the started tool so the sub-character idles.
    const done = messages.find((m) => m.type === 'subagentToolDone' && m.toolId === SUB_TOOL_ID);
    expect(done).toBeDefined();
    expect(done!.id).toBe(1);
    expect(done!.parentToolId).toBe(SPAWN_TOOL_ID);
  });

  it('re-sends a watched spawn tool with toolName + runInBackground at turn end', () => {
    // The Subtask sub-character is the spawn's only representation and MUST be
    // recreatable after the turn-end agentToolsClear.
    seedSidecar();
    spawnAndLaunch();
    processTranscriptLine(
      1,
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 'toolu_fg', name: 'Bash', input: { command: 'ls' } }],
        },
      }),
      agents,
      waitingTimers,
      permissionTimers,
    );
    messages.length = 0;
    processTranscriptLine(
      1,
      JSON.stringify({ type: 'system', subtype: 'turn_duration' }),
      agents,
      waitingTimers,
      permissionTimers,
    );
    const resent = messages.find((m) => m.type === 'agentToolStart' && m.toolId === SPAWN_TOOL_ID);
    expect(resent).toBeDefined();
    expect(resent!.toolName).toBe('Agent');
    expect(resent!.runInBackground).toBe(true);
  });

  it('re-sends a watched spawn tool when a new user prompt clears activity (heuristic path)', () => {
    // clearAgentActivity used to re-send background tools WITHOUT toolName/
    // runInBackground -- the webview then failed to recreate the Subtask and
    // the sub-character despawned on the next user prompt.
    seedSidecar();
    spawnAndLaunch();
    messages.length = 0;
    processTranscriptLine(
      1,
      JSON.stringify({ type: 'user', message: { content: 'now do something else' } }),
      agents,
      waitingTimers,
      permissionTimers,
    );
    const resent = messages.find((m) => m.type === 'agentToolStart' && m.toolId === SPAWN_TOOL_ID);
    expect(resent).toBeDefined();
    expect(resent!.toolName).toBe('Agent');
    expect(resent!.runInBackground).toBe(true);
  });

  it('stops the shadow watch when the completion queue-operation lands', () => {
    const jsonlPath = seedSidecar();
    spawnAndLaunch();
    expect(watch.isWatching(jsonlPath)).toBe(true);

    processTranscriptLine(1, queueOpCompletionRecord(), agents, waitingTimers, permissionTimers);

    expect(completed).toEqual([{ leadId: 1, toolUseId: SPAWN_TOOL_ID }]);
    expect(watch.isWatching(jsonlPath)).toBe(false);
    expect(lead.backgroundAgentToolIds.size).toBe(0);
  });

  it('does not double-watch on a re-scan', () => {
    seedSidecar();
    spawnAndLaunch();
    expect(watch.store.size).toBe(1);

    scanForBackgroundAgentFiles(
      1,
      agents,
      { current: 200 },
      fileWatchers,
      pollingTimers,
      waitingTimers,
      permissionTimers,
    );

    expect(watch.store.size).toBe(1);
    expect([...agents.values()].some((a) => a.leadAgentId === 1)).toBe(false);
  });

  // ── Foreground spawns (open Agent tool, no async result) ───────────

  function foregroundResultRecord(): string {
    return JSON.stringify({
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: SPAWN_TOOL_ID, content: 'Here is my report.' },
        ],
      },
    });
  }

  it('watches a foreground spawn sidecar while its tool is open, even when named', () => {
    // Foreground spawns are within-turn work whatever the sidecar says: they
    // are watched for live activity, never seated as teammates.
    const jsonlPath = seedSidecar({ name: 'ghost-writer' });
    processTranscriptLine(1, agentSpawnRecord(), agents, waitingTimers, permissionTimers);
    // No async launch result: the tool is a live FOREGROUND spawn.
    scanForBackgroundAgentFiles(
      1,
      agents,
      { current: 300 },
      fileWatchers,
      pollingTimers,
      waitingTimers,
      permissionTimers,
    );

    expect(watch.isWatching(jsonlPath)).toBe(true);
    expect([...agents.values()].some((a) => a.leadAgentId === 1)).toBe(false);
  });

  it('stops the foreground watch when the spawn tool completes', () => {
    const jsonlPath = seedSidecar();
    processTranscriptLine(1, agentSpawnRecord(), agents, waitingTimers, permissionTimers);
    scanForBackgroundAgentFiles(
      1,
      agents,
      { current: 300 },
      fileWatchers,
      pollingTimers,
      waitingTimers,
      permissionTimers,
    );
    expect(watch.isWatching(jsonlPath)).toBe(true);

    processTranscriptLine(1, foregroundResultRecord(), agents, waitingTimers, permissionTimers);

    expect(watch.isWatching(jsonlPath)).toBe(false);
    expect(
      messages.some((m) => m.type === 'subagentClear' && m.parentToolId === SPAWN_TOOL_ID),
    ).toBe(true);
  });

  // ── Named spawn = Teammate ──────────────────────────────────────────

  it('creates a teammate named from the sidecar name and badges the lead', () => {
    const jsonlPath = seedSidecar({ name: 'ghost-writer' });
    spawnAndLaunch();

    const teammate = [...agents.values()].find((a) => a.leadAgentId === 1);
    expect(teammate).toBeDefined();
    // The sidecar `name` wins over description/agentType.
    expect(teammate!.agentName).toBe('ghost-writer');
    expect(teammate!.spawnToolUseId).toBe(SPAWN_TOOL_ID);
    expect(teammate!.jsonlFile).toBe(jsonlPath);
    // Derived team: NO teamName (config polling must stay away), but the
    // spawner becomes a Lead.
    expect(teammate!.teamName).toBeUndefined();
    expect(lead.isTeamLead).toBe(true);
    expect(
      messages.some((m) => m.type === 'agentTeamInfo' && m.id === 1 && m.isTeamLead === true),
    ).toBe(true);
    // The transient Subtask sub-character is superseded by the real character.
    expect(
      messages.some((m) => m.type === 'subagentClear' && m.parentToolId === SPAWN_TOOL_ID),
    ).toBe(true);
    expect(watch.isWatching(jsonlPath)).toBe(false);
  });

  it('does not create a second teammate when the sidecar path is spelled differently', () => {
    // Windows only: the same transcript reaches the runtime spelled two ways
    // (hooks carry Claude's `process.cwd()` casing, scanners build from
    // Uri.fsPath's lowercased drive letter). An exact-string already-tracked
    // check missed and adopted the same background agent twice.
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    try {
      const jsonlPath = seedSidecar({ name: 'ghost-writer' });
      spawnAndLaunch();
      const teammates = [...agents.values()].filter((a) => a.leadAgentId === 1);
      expect(teammates).toHaveLength(1);

      // Re-scan with the agent's path stored under the other spelling.
      teammates[0].jsonlFile = jsonlPath.toUpperCase();
      scanForBackgroundAgentFiles(
        1,
        agents,
        { current: 200 },
        fileWatchers,
        pollingTimers,
        waitingTimers,
        permissionTimers,
      );

      expect([...agents.values()].filter((a) => a.leadAgentId === 1)).toHaveLength(1);
    } finally {
      platformSpy.mockRestore();
    }
  });

  it('does not re-send the spawn tool at turn end for a named teammate (no ghost Subtask)', () => {
    seedSidecar({ name: 'ghost-writer' });
    spawnAndLaunch();
    // Add a foreground tool so the turn_duration cleanup branch runs.
    processTranscriptLine(
      1,
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 'toolu_fg', name: 'Bash', input: { command: 'ls' } }],
        },
      }),
      agents,
      waitingTimers,
      permissionTimers,
    );
    messages.length = 0;
    processTranscriptLine(
      1,
      JSON.stringify({ type: 'system', subtype: 'turn_duration' }),
      agents,
      waitingTimers,
      permissionTimers,
    );
    expect(messages.some((m) => m.type === 'agentToolStart' && m.toolId === SPAWN_TOOL_ID)).toBe(
      false,
    );
  });

  it('does not re-send the spawn tool on a new user prompt once a teammate exists', () => {
    seedSidecar({ name: 'ghost-writer' });
    spawnAndLaunch();
    messages.length = 0;
    processTranscriptLine(
      1,
      JSON.stringify({ type: 'user', message: { content: 'now do something else' } }),
      agents,
      waitingTimers,
      permissionTimers,
    );
    expect(messages.some((m) => m.type === 'agentToolStart' && m.toolId === SPAWN_TOOL_ID)).toBe(
      false,
    );
  });

  it('removes the teammate when the completion queue-operation lands', () => {
    seedSidecar({ name: 'ghost-writer' });
    spawnAndLaunch();
    expect([...agents.values()].some((a) => a.leadAgentId === 1)).toBe(true);

    processTranscriptLine(1, queueOpCompletionRecord(), agents, waitingTimers, permissionTimers);

    expect(completed).toEqual([{ leadId: 1, toolUseId: SPAWN_TOOL_ID }]);
    expect([...agents.values()].some((a) => a.leadAgentId === 1)).toBe(false);
    expect(lead.backgroundAgentToolIds.size).toBe(0);
  });

  // ── Shared gate ─────────────────────────────────────────────────────

  it('adopts nothing when the sidecar toolUseId matches no live background spawn', () => {
    // Stale sidecar from an earlier session: same shape, dead toolUseId.
    const subagentsDir = path.join(tmpRoot, LEAD_SESSION, 'subagents');
    fs.mkdirSync(subagentsDir, { recursive: true });
    fs.writeFileSync(path.join(subagentsDir, 'agent-old.jsonl'), '');
    fs.writeFileSync(
      path.join(subagentsDir, 'agent-old.meta.json'),
      JSON.stringify({ agentType: 'general-purpose', toolUseId: 'toolu_dead', name: 'stale' }),
    );
    spawnAndLaunch();
    expect([...agents.values()].some((a) => a.leadAgentId === 1)).toBe(false);
    expect(watch.isWatching(path.join(subagentsDir, 'agent-old.jsonl'))).toBe(false);
  });
});
