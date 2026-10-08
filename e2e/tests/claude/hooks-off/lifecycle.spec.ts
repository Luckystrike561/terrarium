import { expect, test } from '../../../fixtures/standalone';
import {
  INLINE_TEAMMATE_ALIAS,
  INLINE_TEAMMATE_ROLE,
  uniqueTeamName,
  withInlineTeammateSession,
} from '../../../helpers/lifecycle';
import { claudeScenario, spawnExternalClaudeScenario } from '../../../helpers/mock-claude';
import {
  closeAgentFromOverlay,
  expectNoOverlay,
  expectNoOverlayWithTexts,
  expectOverlayCount,
  expectOverlayVisible,
  expectOverlayVisibleWithTexts,
  expectSingleAgentOverlay,
  readAgentOverlayIds,
} from '../../../helpers/office';
import {
  buildAssistantToolUseBatchRecord,
  buildAssistantToolUseRecord,
  buildTeamConfig,
  buildTeamMetadataRecord,
  buildTurnDurationRecord,
  buildUserToolResultBatchRecord,
  buildUserToolResultRecord,
  seedTeamConfig,
} from '../../../helpers/team';
import { setSettings } from '../../../helpers/webview';

const PARALLEL_PARENT_TOOL_ID = 'toolu-b5-parent';

test.describe('Hooks OFF / lifecycle', () => {
  test('heuristic late --resume after stale cleanup prevents zombie agents @area:lifecycle', async ({
    page,
    standalone,
  }) => {
    const { tmpHome, workspaceDir, mockLogFile, narrator } = standalone;

    narrator.step(
      'enabling Watch All Sessions + hooks OFF so an external session is adopted via polling',
    );
    await setSettings(page, {
      watchAllSessions: true,
      hooksEnabled: false,
    });

    await spawnExternalClaudeScenario({
      tmpHome,
      workspaceDir,
      mockLogFile,
      sessionId: 'late-resume-old-session',
      scenario: claudeScenario('late resume after stale cleanup hooks off old')
        .at(5_000)
        .appendJsonl(
          buildAssistantToolUseRecord('toolu-b4-before', 'Bash', {
            command: 'npm run before-resume',
          }),
        )
        .at(6_500)
        .deletePath('{{transcriptPath}}')
        .holdOpenFor(10_000)
        .build(),
    });

    narrator.step('waiting for the external tool "npm run before-resume" to render');
    await expectOverlayVisible(page, 'Running: npm run before-resume');
    const oldAgentId = await expectSingleAgentOverlay(page);
    narrator.check('external character adopted — "Running: npm run before-resume"');

    narrator.step('its transcript was deleted — the stale checker should remove it (up to 45s)');
    await expectOverlayCount(page, 0, 45_000);
    narrator.check('character gone — stale cleanup fired, no zombie left behind');

    narrator.step('a much later resume session starts — waiting for "npm run late-resume"');
    await spawnExternalClaudeScenario({
      tmpHome,
      workspaceDir,
      mockLogFile,
      sessionId: 'late-resume-new-session',
      scenario: claudeScenario('late resume after stale cleanup hooks off new')
        .at(5_000)
        .appendJsonl(
          buildAssistantToolUseRecord('toolu-b4-late', 'Bash', {
            command: 'npm run late-resume',
          }),
        )
        .holdOpenFor(12_000)
        .build(),
    });

    await expectOverlayVisible(page, 'Running: npm run late-resume', 12_000);
    const [newAgentId] = await readAgentOverlayIds(page);
    expect(newAgentId).toBeDefined();
    expect(newAgentId).not.toBe(oldAgentId);
    narrator.check('fresh character with a NEW id — the resume did not resurrect the old one');
  });

  test('three parallel Task subagents in one turn render distinct sub-characters via polling @area:lifecycle', async ({
    page,
    standalone,
  }) => {
    const { tmpHome, workspaceDir, mockLogFile, narrator } = standalone;

    narrator.step('hooks OFF — three parallel Task subagents detected by JSONL polling alone');
    await setSettings(page, {
      watchAllSessions: true,
      hooksEnabled: false,
    });

    narrator.step(
      'arranging one batch record with three Task tool_uses, then results + turn_duration',
    );
    await spawnExternalClaudeScenario({
      tmpHome,
      workspaceDir,
      mockLogFile,
      sessionId: 'parallel-subagents-external',
      scenario: claudeScenario('three parallel Task subagents in one turn hooks off external')
        .at(2_500)
        .appendJsonl(
          buildAssistantToolUseBatchRecord([
            {
              toolId: `${PARALLEL_PARENT_TOOL_ID}-1`,
              toolName: 'Task',
              input: { description: 'Parallel task 1' },
            },
            {
              toolId: `${PARALLEL_PARENT_TOOL_ID}-2`,
              toolName: 'Task',
              input: { description: 'Parallel task 2' },
            },
            {
              toolId: `${PARALLEL_PARENT_TOOL_ID}-3`,
              toolName: 'Task',
              input: { description: 'Parallel task 3' },
            },
          ]),
        )
        .at(9_000)
        .appendJsonl(
          buildUserToolResultBatchRecord([
            { toolUseId: `${PARALLEL_PARENT_TOOL_ID}-1` },
            { toolUseId: `${PARALLEL_PARENT_TOOL_ID}-2` },
            { toolUseId: `${PARALLEL_PARENT_TOOL_ID}-3` },
          ]),
        )
        .at(10_200)
        .appendJsonl(buildTurnDurationRecord())
        .holdOpenFor(13_000)
        .build(),
    });

    narrator.step('waiting for all three Subtask sub-characters to appear');
    await expectOverlayVisible(page, 'Subtask: Parallel task 3', 12_000);
    await expectOverlayVisible(page, 'Parallel task 1');
    await expectOverlayVisible(page, 'Parallel task 2');
    await expectOverlayVisible(page, 'Parallel task 3');
    await expectOverlayCount(page, 4, 10_000);
    expect(await readAgentOverlayIds(page)).toHaveLength(4);
    narrator.check('all three parallel tasks render — count 4 (lead + 3 subtasks)');

    narrator.step('after the tool_results + turn_duration, the subtasks should collapse');
    await expectOverlayCount(page, 1, 16_000);
    narrator.check('back to a single character — count 1');
  });

  test('inline teammate removed from team config disappears within one second via polling @area:lifecycle', async ({
    page,
    standalone,
  }) => {
    const { tmpHome, workspaceDir, mockLogFile, narrator } = standalone;
    const teamName = uniqueTeamName('teammate-removal-hooks-off');
    narrator.step('seeding a team config: lead + one inline teammate');
    const configPath = seedTeamConfig(tmpHome, teamName, ['lead', INLINE_TEAMMATE_ROLE]);

    narrator.step('hooks OFF — teammate lifecycle driven by JSONL metadata + 1s config polling');
    await setSettings(page, {
      watchAllSessions: true,
      hooksEnabled: false,
    });

    narrator.step(
      'arranging: teammate joins and searches the web, then config is rewritten to lead-only at t+8s',
    );
    await spawnExternalClaudeScenario({
      tmpHome,
      workspaceDir,
      mockLogFile,
      sessionId: 'teammate-removal-external',
      scenario: withInlineTeammateSession(
        claudeScenario('inline teammate removed from config hooks off external'),
      )
        .at(500)
        .appendJsonl(buildTeamMetadataRecord(teamName))
        .at(1_500)
        .appendJsonl(buildTeamMetadataRecord(teamName, INLINE_TEAMMATE_ROLE), {
          session: INLINE_TEAMMATE_ALIAS,
        })
        .at(2_500)
        .appendJsonl(
          buildAssistantToolUseRecord('toolu-b6-teammate-search', 'WebSearch', {
            query: 'pixel agents lifecycle regressions',
          }),
          { session: INLINE_TEAMMATE_ALIAS },
        )
        .at(8_000)
        .writeJson(configPath, buildTeamConfig(['lead']))
        .holdOpenFor(14_000)
        .build(),
    });

    narrator.step('waiting for the external scanner to adopt the lead session');
    await expectOverlayVisibleWithTexts(page, ['LEAD'], 10_000);
    narrator.check('the LEAD character renders');

    narrator.step('waiting for the teammate to be discovered from the team metadata');
    await expectOverlayVisibleWithTexts(page, [INLINE_TEAMMATE_ROLE], 10_000);
    await expectOverlayVisible(page, 'Searching the web');
    await expectOverlayCount(page, 2, 10_000);
    narrator.check('teammate present and "Searching the web" — count 2');

    narrator.step('config now lead-only — the 1s poll should drop the teammate');
    await expectOverlayCount(page, 1, 12_000);
    await expectNoOverlayWithTexts(page, [INLINE_TEAMMATE_ROLE], 2_000);
    narrator.check('teammate gone within a second — back to count 1');

    narrator.step('holding through an 8s stability window — the teammate must stay gone');
    await page.waitForTimeout(8_000);
    await expectOverlayCount(page, 1);
    await expectNoOverlayWithTexts(page, [INLINE_TEAMMATE_ROLE], 2_000);
    narrator.check('still count 1 after 8s — teammate did not flicker back');
  });

  test('close via X prevents re-adoption of old JSONL during dismissal cooldown via polling @area:lifecycle', async ({
    page,
    standalone,
  }) => {
    const { tmpHome, workspaceDir, mockLogFile, narrator } = standalone;

    narrator.step('enabling Watch All Sessions + hooks OFF — external session adopted via polling');
    await setSettings(page, {
      watchAllSessions: true,
      hooksEnabled: false,
    });

    await spawnExternalClaudeScenario({
      tmpHome,
      workspaceDir,
      mockLogFile,
      sessionId: 'dismissal-cooldown-old-session',
      scenario: claudeScenario('dismissal cooldown hooks off old session')
        .at(5_000)
        .appendJsonl(
          buildAssistantToolUseRecord('toolu-b12-old-live', 'Bash', {
            command: 'npm run old-live',
          }),
        )
        .at(12_000)
        .appendJsonl(
          buildAssistantToolUseRecord('toolu-b12-old-stale', 'Bash', {
            command: 'npm run old-stale',
          }),
        )
        .holdOpenFor(16_000)
        .build(),
    });

    narrator.step('waiting for the external agent to show "npm run old-live"');
    await expectOverlayVisible(page, 'Running: npm run old-live');
    const oldAgentId = await expectSingleAgentOverlay(page);
    narrator.check('external character adopted — "Running: npm run old-live"');
    await closeAgentFromOverlay(page, { agentId: oldAgentId });
    await expectOverlayCount(page, 0, 8_000);
    narrator.check('character dismissed — count 0');

    narrator.step('a new session starts — its JSONL should get a fresh character');
    await spawnExternalClaudeScenario({
      tmpHome,
      workspaceDir,
      mockLogFile,
      sessionId: 'dismissal-cooldown-new-session',
      scenario: claudeScenario('dismissal cooldown hooks off new session')
        .at(5_000)
        .appendJsonl(
          buildAssistantToolUseRecord('toolu-b12-new-live', 'Bash', {
            command: 'npm run reopened',
          }),
        )
        .holdOpenFor(12_000)
        .build(),
    });

    await expectOverlayVisible(page, 'Running: npm run reopened', 12_000);
    await expectOverlayCount(page, 1);
    const [newAgentId] = await readAgentOverlayIds(page);
    expect(newAgentId).toBeDefined();
    expect(newAgentId).not.toBe(oldAgentId);
    narrator.check('new character with a NEW id — the dismissed session was not re-adopted');

    narrator.step('the dismissed file keeps growing — holding across several 3s scanner ticks');
    await page.waitForTimeout(8_000);
    await expectNoOverlay(page, 'Running: npm run old-stale', 2_000);
    await expectOverlayCount(page, 1);
    narrator.check('"npm run old-stale" never re-adopted — still count 1');
  });

  test('external basic subagent with run_in_background but no teamName routes to basic path @area:lifecycle', async ({
    page,
    standalone,
  }) => {
    const { tmpHome, workspaceDir, mockLogFile, narrator } = standalone;

    narrator.step('enabling Watch All Sessions + hooks OFF — a team-less lead read from JSONL');
    await setSettings(page, {
      watchAllSessions: true,
      hooksEnabled: false,
    });

    await spawnExternalClaudeScenario({
      tmpHome,
      workspaceDir,
      mockLogFile,
      sessionId: 'external-basic-background-subagent',
      scenario: claudeScenario('external basic subagent no teamName hooks off')
        .at(1_000)
        .appendJsonl(
          buildAssistantToolUseRecord('toolu-b8-off-agent', 'Agent', {
            description: 'Background basic subtask',
            run_in_background: true,
          }),
        )
        .at(4_500)
        .appendJsonl(buildUserToolResultRecord('toolu-b8-off-agent'))
        .at(4_900)
        .appendJsonl(buildTurnDurationRecord())
        .holdOpenFor(8_000)
        .build(),
    });

    narrator.step(
      'waiting for the run_in_background Agent to render as a basic Subtask (20s window)',
    );
    await expectOverlayVisible(page, 'Subtask: Background basic subtask', 20_000);
    await expectOverlayCount(page, 1, 10_000);
    await expectNoOverlay(page, 'general-purpose', 2_000);
    narrator.check(
      '"Subtask: Background basic subtask" renders — no "general-purpose" teammate ghost',
    );

    narrator.step('holding to be sure no late fire misroutes it to the teammate path');
    await page.waitForTimeout(5_000);
    await expectOverlayCount(page, 1);
    await expectNoOverlay(page, 'general-purpose', 2_000);
    narrator.check('still count 1, still no "general-purpose" ghost');
  });

  test('agentToolsClear fires at turn end via turn_duration JSONL record @area:cross-cutting', async ({
    page,
    standalone,
  }) => {
    const { tmpHome, workspaceDir, mockLogFile, narrator } = standalone;

    narrator.step('hooks OFF — turn-end clear exercised through the JSONL parser path');
    await setSettings(page, {
      watchAllSessions: true,
      hooksEnabled: false,
    });

    // Cross-cutting invariant from the manual F5 matrix: when a turn ends
    // (turn_duration record), all active tool overlays must clear back to "Idle".
    // The test runs in hooks-off so it exercises the JSONL parser path; a regression
    // here would leave a ghost "Running: ..." overlay even after the turn ended.
    narrator.step('arranging: a Bash tool, then tool_result + a turn_duration record');
    await spawnExternalClaudeScenario({
      tmpHome,
      workspaceDir,
      mockLogFile,
      sessionId: 'turn-end-agent-tools-clear-external',
      scenario: claudeScenario('turn-end agentToolsClear external')
        .at(1_000)
        .appendJsonl(buildAssistantToolUseRecord('toolu-c4-bash', 'Bash', { command: 'npm test' }))
        .at(3_000)
        .appendJsonl(buildUserToolResultRecord('toolu-c4-bash'))
        .at(3_500)
        .appendJsonl(buildTurnDurationRecord())
        .holdOpenFor(8_000)
        .build(),
    });

    narrator.step('waiting for the active tool overlay');
    await expectOverlayVisible(page, 'Running: npm test', 10_000);
    narrator.check('"Running: npm test" while the tool is active');

    narrator.step('after the turn_duration, the overlay must revert to Idle');
    await expectOverlayVisible(page, 'Idle', 8_000);
    await expectNoOverlay(page, 'Running: npm test', 2_000);
    narrator.check('overlay back to "Idle" — no ghost "Running: npm test" left behind');
  });

  // Heuristic permission and text-idle timers are cancelled when an agent
  // is closed via the overlay X.
  //
  // Invariant: closing an agent must cancel its in-flight 7s permission and
  // 5s text-idle heuristic timers. If a timer fires after close and the
  // server unconditionally broadcasts `agentToolPermission` (or
  // `agentStatus: waiting`) for the gone agent, the webview's handler runs
  // playPermissionSound() / playDoneSound() (see
  // webview-ui/src/hooks/useExtensionMessages.ts), which our
  // notificationSound.ts instrumentation records in
  // window.__pixelAgentsTestHooks.playedSounds.
  //
  // This catches "hard" leaks (broadcast despite missing agent). "Soft" leaks
  // (timer fires but its callback no-ops because internal state is gone) are
  // invisible from the browser — they require server instrumentation and are
  // out of scope here.
  test('heuristic permission timer is cancelled when an agent is closed via overlay @area:cross-cutting', async ({
    page,
    standalone,
  }) => {
    const { tmpHome, workspaceDir, mockLogFile, narrator } = standalone;

    narrator.step(
      'enabling Watch All Sessions + hooks OFF — external agent runs a tool that never replies',
    );
    await setSettings(page, {
      watchAllSessions: true,
      hooksEnabled: false,
    });

    await spawnExternalClaudeScenario({
      tmpHome,
      workspaceDir,
      mockLogFile,
      sessionId: 'heuristic-timer-cancellation',
      scenario: claudeScenario('heuristic timer cancellation on close hooks off')
        .at(2_500)
        .appendJsonl(
          buildAssistantToolUseRecord('toolu-c7', 'Bash', {
            command: 'npm test',
          }),
        )
        .holdOpenFor(20_000)
        .build(),
    });

    narrator.step(
      'waiting for the external agent whose Bash tool would arm the 7s permission timer',
    );
    await expectOverlayCount(page, 1, 12_000);
    await expectOverlayVisible(page, 'Running: npm test');
    const [agentId] = await readAgentOverlayIds(page);
    narrator.check('external character present — "Running: npm test"');

    await closeAgentFromOverlay(page, { agentId });
    await expectOverlayCount(page, 0, 8_000);
    narrator.check('agent closed — count 0');

    narrator.step('resetting the recorded-sounds log so only post-close sounds count');
    await page.evaluate(() => {
      const w = window as Window & {
        __pixelAgentsTestHooks?: { playedSounds?: unknown[] };
      };
      if (w.__pixelAgentsTestHooks) w.__pixelAgentsTestHooks.playedSounds = [];
    });

    narrator.step('waiting out the 7s timer window — a leaked timer would fire a bubble/sound now');
    await page.waitForTimeout(9_000);

    await expectOverlayCount(page, 0);
    const playedKinds = await page.evaluate(() => {
      const w = window as Window & {
        __pixelAgentsTestHooks?: { playedSounds?: Array<{ kind: string }> };
      };
      return (w.__pixelAgentsTestHooks?.playedSounds ?? []).map((s) => s.kind);
    });
    expect(playedKinds).not.toContain('permission');
    expect(playedKinds).not.toContain('done');
    narrator.check('count still 0 and no "permission"/"done" sound recorded — timer was cancelled');
  });

  // Sub-agent permission bubble fires when a sub-agent runs a non-exempt
  // tool with no follow-up data for ~5s. The heuristic permission timer is
  // active for sub-agents in hooks-OFF mode (same path as parent agents).
  //
  // Trigger sequence:
  // 1. Lead session does Task tool_use -> sub-character appears.
  // 2. A progress record arrives with a sub-agent tool_use for a non-exempt
  //    tool (Bash). transcriptParser registers the sub-tool and starts the
  //    permission timer.
  // 3. ~5s with no further sub-agent data -> permission bubble appears on
  //    both lead and sub-character.
  test('sub-agent permission bubble fires on stalled non-exempt sub-tool via heuristic timer @area:cross-cutting', async ({
    page,
    standalone,
  }) => {
    const { tmpHome, workspaceDir, mockLogFile, narrator } = standalone;

    narrator.step('hooks OFF — sub-agent permission handled by the heuristic timer');
    await setSettings(page, {
      watchAllSessions: true,
      hooksEnabled: false,
    });

    const parentToolId = 'toolu-c14-task';
    const subToolId = 'toolu-c14-bash-sub';

    narrator.step('arranging: a Task, then a sub-agent Bash that stalls with no further data');
    await spawnExternalClaudeScenario({
      tmpHome,
      workspaceDir,
      mockLogFile,
      sessionId: 'sub-agent-permission-bubble-external',
      scenario: claudeScenario('sub-agent permission bubble hooks off external')
        .at(2_000)
        .appendJsonl(
          buildAssistantToolUseRecord(parentToolId, 'Task', {
            description: 'permission subtask',
          }),
        )
        .at(3_000)
        .appendJsonl({
          type: 'progress',
          parentToolUseID: parentToolId,
          data: {
            type: 'agent_progress',
            message: {
              type: 'assistant',
              message: {
                content: [
                  {
                    type: 'tool_use',
                    id: subToolId,
                    name: 'Bash',
                    input: { command: 'npm test' },
                  },
                ],
              },
            },
          },
        })
        // Hold open WAY past the 5s heuristic permission timer so the bubble
        // has time to appear before mock-claude exits.
        .holdOpenFor(15_000)
        .build(),
    });

    // Sub-character appears once the Task tool_use is parsed.
    narrator.step('waiting for the Subtask sub-character to appear');
    await expectOverlayCount(page, 2, 12_000);
    await expectOverlayVisible(page, 'Subtask: permission subtask');
    narrator.check('"Subtask: permission subtask" on screen — count 2');

    // The "Subtask: permission subtask" overlay above already resolves the
    // moment the Task tool_use is parsed (scenario t=2s), but the heuristic
    // permission timer only starts when the sub-tool tool_use lands in the
    // progress record (scenario t=3s). The timer is PERMISSION_TIMER_DELAY_MS
    // (7s), and broadcast-to-DOM takes another ~300ms (transport + React
    // render). So this wait must cover: 1s scenario gap + 7s timer + slop.
    narrator.step('waiting out the 7s permission timer for the stalled sub-tool (~8–10s)');
    await expectOverlayVisible(page, 'Needs approval', 10_000);
    narrator.check('"Needs approval" bubble fired on the stalled sub-tool');
  });
});
