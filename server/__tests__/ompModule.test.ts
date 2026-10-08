import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import {
  OMP_STATUS_DETAIL_MAX_LENGTH,
  OMP_STATUS_MAX_LENGTH,
} from '../src/providers/omp/constants.js';
import { formatToolStatus, ompModule } from '../src/providers/omp/omp.js';
import { SESSION_POLL_INTERVAL_MS } from '../src/providers/sessionStore/constants.js';

// omp's session store and the server's ~/.pixel-agents/ both resolve against the home directory.
let tmpHome: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof os>('os');
  return { ...actual, homedir: () => tmpHome };
});

type Message = Record<string, unknown>;

function jsonl(records: object[]): string {
  return records.map((r) => `${JSON.stringify(r)}\n`).join('');
}

const userPrompt = { type: 'message', message: { role: 'user' } };
function assistantStop(stopReason: string) {
  return { type: 'message', message: { role: 'assistant', stopReason } };
}

/** Write an omp transcript into omp's session store under the test home, laid out as omp writes it: a padded
 *  `title` record, then the `session` header, then the records. */
function ompSession(name: string, cwd: string, records: object[]): string {
  const dir = path.join(tmpHome, '.omp', 'agent', 'sessions', `-${path.basename(cwd)}`);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.jsonl`);
  const title = { type: 'title', v: 1, title: name, source: 'auto', pad: ' '.repeat(64) };
  fs.writeFileSync(file, jsonl([title, { type: 'session', id: name, cwd }, ...records]));
  return file;
}

describe('omp formatToolStatus', () => {
  it("reads the agent's own intent line over anything derived from the tool arguments", () => {
    expect(formatToolStatus('bash', { intent: 'Checking test output', command: 'npm test' })).toBe(
      'Checking test output',
    );
  });

  it('truncates a long intent to the status length limit', () => {
    const longIntent = 'i'.repeat(OMP_STATUS_MAX_LENGTH + 20);
    expect(formatToolStatus('read', { intent: longIntent })).toBe(
      `${longIntent.slice(0, OMP_STATUS_MAX_LENGTH)}\u2026`,
    );
  });

  it.each([
    ['read', { path: '/work/a/PLAN.md' }, 'Reading PLAN.md'],
    ['write', { path: '/work/a/out.txt' }, 'Writing out.txt'],
    ['edit', { path: '/work/a/app.ts' }, 'Editing app.ts'],
    ['ast_edit', { path: '/work/a/app.ts' }, 'Editing app.ts'],
  ])('%s without an intent falls back to its file argument', (tool, input, expected) => {
    expect(formatToolStatus(tool, input)).toBe(expected);
  });

  it('read with no path argument still reads as a bare verb', () => {
    expect(formatToolStatus('read', {})).toBe('Reading');
  });

  it.each(['grep', 'glob', 'lsp'])('%s reports a generic search status', (tool) => {
    expect(formatToolStatus(tool, {})).toBe('Searching code');
  });

  it('fetch reports fetching web content', () => {
    expect(formatToolStatus('fetch', {})).toBe('Fetching web content');
  });

  it('web_search reports searching the web', () => {
    expect(formatToolStatus('web_search', {})).toBe('Searching the web');
  });

  it('todo reports planning tasks', () => {
    expect(formatToolStatus('todo', {})).toBe('Planning tasks');
  });

  it.each(['bash', 'eval'])(
    '%s with a command reports it, truncated to the detail length limit',
    (tool) => {
      const longCommand = `echo ${'y'.repeat(OMP_STATUS_DETAIL_MAX_LENGTH)}`;
      expect(formatToolStatus(tool, { command: longCommand })).toBe(
        `Running: ${longCommand.slice(0, OMP_STATUS_DETAIL_MAX_LENGTH)}\u2026`,
      );
    },
  );

  it.each(['bash', 'eval'])('%s with no command reports a generic running status', (tool) => {
    expect(formatToolStatus(tool, {})).toBe('Running a command');
  });

  it('task with a description reports it as a subtask, truncated to the detail length limit', () => {
    const longDescription = 'd'.repeat(OMP_STATUS_DETAIL_MAX_LENGTH + 10);
    expect(formatToolStatus('task', { description: longDescription })).toBe(
      `Subtask: ${longDescription.slice(0, OMP_STATUS_DETAIL_MAX_LENGTH)}\u2026`,
    );
  });

  it('task with no description reports a generic subtask status', () => {
    expect(formatToolStatus('task', {})).toBe('Running subtask');
  });

  it('an unrecognized tool name is shown verbatim, truncated to the status length limit', () => {
    const longToolName = 'custom_tool_name_'.repeat(6);
    expect(formatToolStatus(longToolName, {})).toBe(
      `${longToolName.slice(0, OMP_STATUS_MAX_LENGTH)}\u2026`,
    );
  });
});

describe('omp provider module', () => {
  let store: AgentStateStore;
  let runtime: AgentRuntime | undefined;
  let messages: Message[];

  const ofType = (type: string) => messages.filter((m) => m.type === type);
  const onlyAgentId = (): number => {
    expect(store.size).toBe(1);
    return [...store.keys()][0];
  };

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-omp-'));
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    store = new AgentStateStore();
    messages = [];
    store.on('broadcast', (m) => messages.push(m as Message));
  });

  afterEach(() => {
    runtime?.dispose();
    runtime = undefined;
    vi.useRealTimers();
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('a user prompt after the turn ends brings the agent back to active', () => {
    const file = ompSession('live', '/work/alpha', [userPrompt, assistantStop('stop')]);
    runtime = new AgentRuntime(store, { agents: [ompModule], multiplexers: [] });
    runtime.startModules();
    const id = onlyAgentId();
    expect(ofType('agentStatus').at(-1)).toMatchObject({ id, status: 'waiting' });

    fs.appendFileSync(file, jsonl([userPrompt]));
    vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
    expect(ofType('agentStatus').at(-1)).toMatchObject({ id, status: 'active' });
  });

  it('ends the turn on any assistant stop reason other than tool use, not only "stop"', () => {
    const file = ompSession('live', '/work/beta', [userPrompt]);
    runtime = new AgentRuntime(store, { agents: [ompModule], multiplexers: [] });
    runtime.startModules();
    const id = onlyAgentId();

    fs.appendFileSync(file, jsonl([assistantStop('end_turn')]));
    vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
    expect(ofType('agentStatus').at(-1)).toMatchObject({ id, status: 'waiting' });
  });

  it('ignores unknown or malformed records and keeps reading correctly afterward', () => {
    const file = ompSession('live', '/work/delta', [userPrompt]);
    runtime = new AgentRuntime(store, { agents: [ompModule], multiplexers: [] });
    runtime.startModules();
    const id = onlyAgentId();
    const messagesBefore = messages.length;

    fs.appendFileSync(
      file,
      'not valid json at all\n' +
        jsonl([
          { type: 'unknown_type', foo: 'bar' },
          { type: 'custom', customType: 'unknown_custom_type' },
          // tool_execution_start missing toolCallId
          { type: 'custom', customType: 'tool_execution_start', data: { toolName: 'read' } },
          // tool_execution_start missing toolName
          { type: 'custom', customType: 'tool_execution_start', data: { toolCallId: 'orphan' } },
          // 'toolUse' continues the turn rather than ending it: no event
          assistantStop('toolUse'),
          { type: 'message', message: { role: 'system', content: 'noop' } },
        ]),
    );
    vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
    expect(messages.length).toBe(messagesBefore);

    fs.appendFileSync(
      file,
      jsonl([
        {
          type: 'custom',
          customType: 'tool_execution_start',
          data: { toolCallId: 't1', toolName: 'read', args: { path: '/work/delta/a.md' } },
        },
      ]),
    );
    vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
    expect(ofType('agentToolStart')).toContainEqual(
      expect.objectContaining({ id, status: 'Reading a.md', toolName: 'read' }),
    );
  });

  it('a task tool call reports a Subtask status immediately, since omp runs its sub-agents in their own sessions', () => {
    const file = ompSession('live', '/work/epsilon', [userPrompt]);
    runtime = new AgentRuntime(store, { agents: [ompModule], multiplexers: [] });
    runtime.startModules();
    const id = onlyAgentId();

    fs.appendFileSync(
      file,
      jsonl([
        {
          type: 'custom',
          customType: 'tool_execution_start',
          data: {
            toolCallId: 't1',
            toolName: 'task',
            args: { description: 'Refactor the auth module' },
          },
        },
      ]),
    );
    vi.advanceTimersByTime(SESSION_POLL_INTERVAL_MS);
    expect(ofType('agentToolStart')).toContainEqual(
      expect.objectContaining({
        id,
        status: 'Subtask: Refactor the auth module',
        toolName: 'task',
      }),
    );
  });

  it('two directory entries for the same underlying file, one reached through a symlink, discover as one session', () => {
    const file = ompSession('real', '/work/zeta', [userPrompt]);
    const otherDir = path.join(tmpHome, '.omp', 'agent', 'sessions', '-elsewhere');
    fs.mkdirSync(otherDir, { recursive: true });
    fs.symlinkSync(file, path.join(otherDir, 'real.jsonl'));

    runtime = new AgentRuntime(store, { agents: [ompModule], multiplexers: [] });
    runtime.startModules();

    const id = onlyAgentId();
    expect(store.get(id)?.folderName).toBe('zeta');
  });
});
