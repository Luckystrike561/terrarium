import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentEvent, ModuleHost, RunningAgentModule } from '../../core/src/provider.js';
import { startClaudeModule } from '../src/providers/claude/claudeRunningModule.js';
import { getSessionDirs } from '../src/providers/claude/claudeVocabulary.js';
import {
  EXTERNAL_SCAN_INTERVAL_MS,
  FILE_WATCHER_POLL_INTERVAL_MS,
} from '../src/providers/claude/constants.js';

// Claude's own discovery resolves project dirs against the home directory.
let tmpHome: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpHome };
});

type Recorded = { sessionId: string; event: AgentEvent };

function jsonl(records: object[]): string {
  return records.map((r) => `${JSON.stringify(r)}\n`).join('');
}

const SESSION_1 = '11111111-1111-1111-1111-111111111111'; // adopted on startup (already live)
const SESSION_2 = '22222222-2222-2222-2222-222222222222'; // teammate, self-identifies via record tags
const SESSION_3 = '33333333-3333-3333-3333-333333333333'; // restored, never discovered

describe('ClaudeRunningModule: discovery -> bridge pipeline', () => {
  let workspaceDir: string;
  let projectDir: string;
  let file1: string;
  let file2: string;
  let file3: string;
  let cwdSpy: MockInstance<typeof process.cwd>;
  let recorded: Recorded[];
  let host: ModuleHost;
  let runningModule: RunningAgentModule | undefined;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-claude-running-'));
    workspaceDir = path.join(tmpHome, 'workspace');
    projectDir = getSessionDirs(workspaceDir)[0];
    fs.mkdirSync(projectDir, { recursive: true });

    file1 = path.join(projectDir, `${SESSION_1}.jsonl`);
    file2 = path.join(projectDir, `${SESSION_2}.jsonl`);
    file3 = path.join(projectDir, `${SESSION_3}.jsonl`);

    // Scenario 1/5 fixtures must exist BEFORE the module starts: file1 simulates an
    // already-running session the project scan discovers, file3 simulates one that
    // is seeded but never touched again (never adopted by discovery).
    fs.writeFileSync(file1, jsonl([{ type: 'system', subtype: 'init' }]));
    fs.writeFileSync(file3, jsonl([{ type: 'system', subtype: 'init' }]));

    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(workspaceDir);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });

    recorded = [];
    host = {
      emit: (sessionId, event) => recorded.push({ sessionId, event }),
      log: () => {},
    };
  });

  afterEach(() => {
    runningModule?.stop();
    runningModule = undefined;
    vi.useRealTimers();
    cwdSpy.mockRestore();
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('adopts a live session on startup, tracks its tools and turn end, discovers a teammate, restores an undiscovered session, and ends a dismissed one', async () => {
    runningModule = startClaudeModule(host);

    // ── 1. A pre-existing, still-active session is discovered on startup ──
    // ensureProjectScan only SEEDS pre-existing files (so a historic transcript
    // isn't resurrected); a session that is actually still running keeps writing,
    // which the external scanner reads as a changed mtime -- one tick to notice
    // the change, a second to adopt now that the file is no longer "seeded".
    const bumpedMtime = new Date(Date.now() + 10_000);
    fs.utimesSync(file1, bumpedMtime, bumpedMtime);
    await vi.advanceTimersByTimeAsync(EXTERNAL_SCAN_INTERVAL_MS); // notices the mtime change
    await vi.advanceTimersByTimeAsync(EXTERNAL_SCAN_INTERVAL_MS); // adopts

    const sessionStart1 = recorded.find(
      (r) => r.sessionId === 'claude-1' && r.event.kind === 'sessionStart',
    );
    expect(sessionStart1?.event).toMatchObject({
      kind: 'sessionStart',
      live: true,
      sessionRef: SESSION_1,
    });

    // ── 2. A tool_use record shows up as a toolShown event ──
    fs.appendFileSync(
      file1,
      jsonl([
        {
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/x.ts' } }],
          },
        },
      ]),
    );
    await vi.advanceTimersByTimeAsync(FILE_WATCHER_POLL_INTERVAL_MS);

    const toolShown = recorded.find(
      (r) => r.sessionId === 'claude-1' && r.event.kind === 'toolShown',
    );
    expect(toolShown?.event).toMatchObject({ kind: 'toolShown', toolId: 't1', toolName: 'Read' });

    // ── 3. A turn_duration record clears tools and marks the agent waiting ──
    fs.appendFileSync(file1, jsonl([{ type: 'system', subtype: 'turn_duration' }]));
    await vi.advanceTimersByTimeAsync(FILE_WATCHER_POLL_INTERVAL_MS);

    const claude1Events = recorded.filter((r) => r.sessionId === 'claude-1').map((r) => r.event);
    expect(claude1Events).toContainEqual(expect.objectContaining({ kind: 'toolsCleared' }));
    expect(claude1Events).toContainEqual(
      expect.objectContaining({ kind: 'statusChanged', status: 'waiting' }),
    );

    // ── 4. A teammate's own announced session self-identifies via record tags ──
    // file2 has no team tags yet, so the external scanner (its lead isn't tagged
    // either, at this point) adopts it as a plain session -- exactly how newer
    // harnesses' implicit teammates are first seen, before their tags land.
    fs.writeFileSync(file2, jsonl([{ type: 'system', subtype: 'init' }]));
    await vi.advanceTimersByTimeAsync(EXTERNAL_SCAN_INTERVAL_MS);
    expect(
      recorded.find((r) => r.sessionId === 'claude-2' && r.event.kind === 'sessionStart'),
    ).toBeTruthy();

    // Tag the lead first, so linkTeammates has an untagged-agentName lead to link to.
    fs.appendFileSync(
      file1,
      jsonl([
        { type: 'user', message: { role: 'user', content: 'continuing' }, teamName: 'team-x' },
      ]),
    );
    await vi.advanceTimersByTimeAsync(FILE_WATCHER_POLL_INTERVAL_MS);

    // Tag the teammate's own session: it links to the lead and the bridge emits teamChanged.
    fs.appendFileSync(
      file2,
      jsonl([
        {
          type: 'user',
          message: { role: 'user', content: 'ok' },
          teamName: 'team-x',
          agentName: 'scout',
        },
      ]),
    );
    await vi.advanceTimersByTimeAsync(FILE_WATCHER_POLL_INTERVAL_MS);

    const teamChanged = recorded.find(
      (r) => r.sessionId === 'claude-2' && r.event.kind === 'teamChanged',
    );
    expect(teamChanged?.event).toMatchObject({
      kind: 'teamChanged',
      team: expect.objectContaining({
        teamName: 'team-x',
        agentName: 'scout',
        leadSessionId: 'claude-1',
      }),
    });

    // ── 5. restoreSession resumes an undiscovered session at EOF, with no history replay ──
    const beforeRestore = recorded.length;
    runningModule.restoreSession!({
      sessionRef: SESSION_3,
      team: undefined,
      backgroundToolIds: [],
    });
    const restoreEvents = recorded.slice(beforeRestore);

    expect(restoreEvents).toHaveLength(1);
    expect(restoreEvents[0]).toMatchObject({
      sessionId: 'claude-3',
      event: { kind: 'sessionStart', sessionRef: SESSION_3 },
    });
    expect(restoreEvents.some((r) => r.event.kind === 'toolShown')).toBe(false);

    // ── 6. dismissSession ends the character ──
    const beforeDismiss = recorded.length;
    runningModule.dismissSession!('claude-1');
    const dismissEvents = recorded.slice(beforeDismiss);

    expect(dismissEvents).toContainEqual({
      sessionId: 'claude-1',
      event: { kind: 'sessionEnd', reason: 'exit' },
    });
  });

  it('links a teammate adopted and tagged before its lead once the lead is tagged', async () => {
    runningModule = startClaudeModule(host);
    const bumpedMtime = new Date(Date.now() + 10_000);
    fs.utimesSync(file1, bumpedMtime, bumpedMtime);
    await vi.advanceTimersByTimeAsync(EXTERNAL_SCAN_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(EXTERNAL_SCAN_INTERVAL_MS);
    fs.writeFileSync(file2, jsonl([{ type: 'system', subtype: 'init' }]));
    await vi.advanceTimersByTimeAsync(EXTERNAL_SCAN_INTERVAL_MS);
    expect(
      recorded.find((r) => r.sessionId === 'claude-2' && r.event.kind === 'sessionStart'),
    ).toBeTruthy();

    fs.appendFileSync(
      file2,
      jsonl([
        {
          type: 'user',
          message: { role: 'user', content: 'ok' },
          teamName: 'team-x',
          agentName: 'scout',
        },
      ]),
    );
    await vi.advanceTimersByTimeAsync(FILE_WATCHER_POLL_INTERVAL_MS);
    const beforeLeadTag = recorded.length;

    fs.appendFileSync(
      file1,
      jsonl([
        { type: 'user', message: { role: 'user', content: 'continuing' }, teamName: 'team-x' },
      ]),
    );
    await vi.advanceTimersByTimeAsync(FILE_WATCHER_POLL_INTERVAL_MS);

    const teammateTeam = recorded
      .slice(beforeLeadTag)
      .find((r) => r.sessionId === 'claude-2' && r.event.kind === 'teamChanged');
    expect(teammateTeam?.event).toMatchObject({
      kind: 'teamChanged',
      team: expect.objectContaining({
        teamName: 'team-x',
        agentName: 'scout',
        isTeamLead: false,
        leadSessionId: 'claude-1',
      }),
    });
  });
});
