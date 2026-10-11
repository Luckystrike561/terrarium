import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StateAdapter } from '../../core/src/adapter.js';
import type { PersistedAgent } from '../../core/src/schemas.js';
import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { claudeModule } from '../src/providers/claude/claude.js';
import { getSessionDirs } from '../src/providers/claude/claudeVocabulary.js';
import {
  EXTERNAL_SCAN_INTERVAL_MS,
  FILE_WATCHER_POLL_INTERVAL_MS,
} from '../src/providers/claude/constants.js';

// The Claude module reads ~/.claude: keep it in a temp home.
let tmpHome: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpHome };
});

type Message = Record<string, unknown>;

const LEAD_SESSION = '7c1e0b5e-4a2d-4c36-9f0e-1d2c3b4a5f60';

function line(record: object): string {
  return `${JSON.stringify(record)}\n`;
}

function namedSpawn(toolId: string, name: string): string {
  return line({
    type: 'assistant',
    message: {
      content: [
        {
          type: 'tool_use',
          id: toolId,
          name: 'Agent',
          input: { description: `${name} probe`, name, subagent_type: 'general-purpose' },
        },
      ],
    },
  });
}

function asyncLaunch(toolId: string, agentId: string): string {
  return line({
    type: 'user',
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolId,
          content: [
            {
              type: 'text',
              text: `Async agent launched successfully. (This tool result is internal metadata.)\nagentId: ${agentId} (internal)`,
            },
          ],
        },
      ],
    },
  });
}

function completion(toolId: string, agentId: string): string {
  return line({
    type: 'queue-operation',
    operation: 'enqueue',
    content: `<task-notification> <task-id>${agentId}</task-id> <tool-use-id>${toolId}</tool-use-id> <output>done</output>`,
  });
}

function memoryAdapter(): StateAdapter {
  let agents: PersistedAgent[] = [];
  return {
    loadAgents: () => agents,
    saveAgents: (next) => {
      agents = next;
    },
    loadSeats: () => ({}),
    saveSeats: () => {},
    getSetting: <T>(_key: string, defaultValue: T): T => defaultValue,
    setSetting: () => {},
  };
}

/**
 * Named background spawns (teams OFF) become teammate characters under a LEAD. These run the Claude module through
 * the runtime: the lead's transcript is written where Claude writes it, and the office state is read from the
 * runtime's store, as the browser would see it.
 */
describe('Claude background teammates through the runtime', () => {
  let projectDir: string;
  let leadFile: string;
  let adapter: StateAdapter;
  let store: AgentStateStore;
  let runtime: AgentRuntime | undefined;
  let messages: Message[];

  function start(): void {
    store = new AgentStateStore();
    store.setAdapter(adapter);
    messages = [];
    store.on('broadcast', (m) => messages.push(m));
    runtime = new AgentRuntime(store, { agents: [claudeModule], multiplexers: [] });
    runtime.startModules();
  }

  function appendToLead(...lines: string[]): void {
    fs.appendFileSync(leadFile, lines.join(''));
    vi.advanceTimersByTime(FILE_WATCHER_POLL_INTERVAL_MS * 2);
  }

  function seedSidecar(agentId: string, toolId: string, name: string): void {
    const dir = path.join(projectDir, LEAD_SESSION, 'subagents');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `agent-${agentId}.jsonl`), '');
    fs.writeFileSync(
      path.join(dir, `agent-${agentId}.meta.json`),
      JSON.stringify({ agentType: 'general-purpose', description: name, toolUseId: toolId, name }),
    );
  }

  /** Start the lead's session in the workspace and let the module adopt it. Returns the lead's agent id. */
  function startLead(): number {
    fs.writeFileSync(leadFile, line({ type: 'user', message: { content: 'go' } }));
    vi.advanceTimersByTime(EXTERNAL_SCAN_INTERVAL_MS);
    expect(store.size).toBe(1);
    return [...store.keys()][0];
  }

  function spawnTeammate(toolId: string, agentId: string, name: string): number {
    seedSidecar(agentId, toolId, name);
    appendToLead(namedSpawn(toolId, name), asyncLaunch(toolId, agentId));
    const teammate = [...store.values()].find((a) => a.team?.agentName === name);
    expect(teammate).toBeDefined();
    return teammate!.id;
  }

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-claude-bg-'));
    const workspace = path.join(tmpHome, 'work', 'bg');
    fs.mkdirSync(workspace, { recursive: true });
    vi.spyOn(process, 'cwd').mockReturnValue(workspace);
    projectDir = path.join(
      tmpHome,
      '.claude',
      'projects',
      path.basename(getSessionDirs(workspace)[0]),
    );
    fs.mkdirSync(projectDir, { recursive: true });
    leadFile = path.join(projectDir, `${LEAD_SESSION}.jsonl`);
    adapter = memoryAdapter();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    start();
  });

  afterEach(() => {
    runtime?.dispose();
    runtime = undefined;
    vi.useRealTimers();
    vi.restoreAllMocks();
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('a named spawn becomes a teammate seated under its LEAD', () => {
    const leadId = startLead();
    const teammateId = spawnTeammate('toolu_spawn_1', 'a1b2c3', 'ghost-writer');
    expect(store.get(teammateId)?.team).toMatchObject({
      agentName: 'ghost-writer',
      leadAgentId: leadId,
    });
    expect(store.get(leadId)?.team?.isTeamLead).toBe(true);
  });

  it('drops the LEAD badge when the last teammate leaves', () => {
    const leadId = startLead();
    const teammateId = spawnTeammate('toolu_spawn_1', 'a1b2c3', 'ghost-writer');
    messages.length = 0;

    appendToLead(completion('toolu_spawn_1', 'a1b2c3'));

    expect(store.has(teammateId)).toBe(false);
    expect(store.get(leadId)?.team?.isTeamLead).toBeUndefined();
    expect(messages).toContainEqual(
      expect.objectContaining({ type: 'agentTeamInfo', id: leadId, isTeamLead: undefined }),
    );
  });

  it('keeps the LEAD badge while other teammates remain', () => {
    const leadId = startLead();
    const first = spawnTeammate('toolu_spawn_1', 'a1b2c3', 'ghost-writer');
    const second = spawnTeammate('toolu_spawn_2', 'd4e5f6', 'researcher');

    appendToLead(completion('toolu_spawn_1', 'a1b2c3'));

    expect(store.has(first)).toBe(false);
    expect(store.has(second)).toBe(true);
    expect(store.get(leadId)?.team?.isTeamLead).toBe(true);
  });

  it('a restart restores the lead with its live background spawns and never resurrects the spawned child', () => {
    const leadId = startLead();
    const teammateId = spawnTeammate('toolu_spawn_1', 'a1b2c3', 'ghost-writer');
    expect(adapter.loadAgents().find((p) => p.id === leadId)?.backgroundToolIds).toEqual([
      'toolu_spawn_1',
    ]);
    runtime!.dispose();

    start();

    expect(store.has(leadId)).toBe(true);
    expect(store.has(teammateId)).toBe(false);
    expect(adapter.loadAgents().find((p) => p.id === leadId)?.backgroundToolIds).toEqual([
      'toolu_spawn_1',
    ]);
    // The restored lead still knows the spawn is live: its completion clears the spawn's sub-agent.
    messages.length = 0;
    appendToLead(completion('toolu_spawn_1', 'a1b2c3'));
    expect(messages).toContainEqual({
      type: 'subagentClear',
      id: leadId,
      parentToolId: 'toolu_spawn_1',
    });
  });
});
