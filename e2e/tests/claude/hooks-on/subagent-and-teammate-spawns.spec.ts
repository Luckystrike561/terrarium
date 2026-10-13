import { expect, test } from '../../../fixtures/standalone';
import {
  preToolUseAgent,
  sessionEndExit,
  sessionStartStartup,
  subagentStart,
} from '../../../helpers/hooks';
import {
  INLINE_TEAMMATE_ALIAS,
  INLINE_TEAMMATE_ROLE,
  SECOND_TEAMMATE_ALIAS,
  SECOND_TEAMMATE_ROLE,
  uniqueTeamName,
  withInlineTeammateSession,
  withInlineTeammateSessions,
} from '../../../helpers/lifecycle';
import {
  claudeScenario,
  spawnExternalClaudeScenario,
  waitForClaudeHookSetup,
} from '../../../helpers/mock-claude';
import {
  expectNoOverlay,
  expectNoOverlayWithTexts,
  expectOverlayCount,
  expectOverlayVisible,
  expectOverlayVisibleWithTexts,
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

const PARALLEL_PARENT_TOOL_ID = 'toolu-b5-parent';

test.describe('Hooks ON / lifecycle', () => {
  test('three parallel Task subagents in one turn render distinct sub-characters @area:lifecycle', async ({
    page,
    standalone,
  }) => {
    const { tmpHome, workspaceDir, mockLogFile, narrator } = standalone;
    const sessionId = 'parallel-subagents-session';

    await waitForClaudeHookSetup(tmpHome);
    narrator.step('arranging one turn with three parallel Task tool_uses');
    await spawnExternalClaudeScenario({
      tmpHome,
      workspaceDir,
      mockLogFile,
      sessionId,
      scenario: claudeScenario('three parallel Task subagents in one turn')
        .at(200)
        .emitHook(
          sessionStartStartup(sessionId, '{{cwd}}', '{{transcriptPath}}') as Record<
            string,
            unknown
          >,
        )
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

    narrator.step('waiting for all three parallel Subtask sub-characters to appear');
    await expectOverlayVisible(page, 'Subtask: Parallel task 3');
    await expectOverlayVisible(page, 'Parallel task 1');
    await expectOverlayVisible(page, 'Parallel task 2');
    await expectOverlayVisible(page, 'Parallel task 3');
    await expectOverlayCount(page, 4, 10_000);
    expect(await readAgentOverlayIds(page)).toHaveLength(4);
    narrator.check('parent + 3 subtasks on screen (count → 4)');

    narrator.step('after the batched tool_results + turn_duration, the subtasks should collapse');
    await expectOverlayCount(page, 1, 16_000);
    narrator.check('everything collapses back to just the parent (count → 1)');
  });

  test('inline teammate removed from team config disappears within one second @area:lifecycle', async ({
    page,
    standalone,
  }) => {
    const { tmpHome, workspaceDir, mockLogFile, narrator } = standalone;
    const sessionId = 'teammate-removal-session';
    const teamName = uniqueTeamName('teammate-removal');
    narrator.step('seeding a team config with a lead + one inline teammate');
    const configPath = seedTeamConfig(tmpHome, teamName, ['lead', INLINE_TEAMMATE_ROLE]);

    await waitForClaudeHookSetup(tmpHome);
    narrator.step('the scenario rewrites the config to lead-only at t+8s');
    await spawnExternalClaudeScenario({
      tmpHome,
      workspaceDir,
      mockLogFile,
      sessionId,
      scenario: withInlineTeammateSession(claudeScenario('inline teammate removed from config'))
        .at(300)
        .emitHook(
          sessionStartStartup(sessionId, '{{cwd}}', '{{transcriptPath}}') as Record<
            string,
            unknown
          >,
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
            query: 'terrarium lifecycle regressions',
          }),
          { session: INLINE_TEAMMATE_ALIAS },
        )
        .at(8_000)
        .writeJson(configPath, buildTeamConfig(['lead']))
        .holdOpenFor(14_000)
        .build(),
    });

    await expectOverlayVisibleWithTexts(page, [INLINE_TEAMMATE_ROLE], 10_000);
    await expectOverlayVisible(page, 'Searching the web');
    await expectOverlayCount(page, 2, 10_000);
    narrator.check('lead + teammate on screen; teammate shows "Searching the web" (count 2)');

    narrator.step('waiting for the 1s config poll to drop the removed teammate');
    await expectOverlayCount(page, 1, 12_000);
    await expectNoOverlayWithTexts(page, [INLINE_TEAMMATE_ROLE], 2_000);
    narrator.check('teammate gone within a second (count 2 → 1)');

    // Stability check: after cascade removal, the teammate must not reappear
    // (zombie cleanup race). Polling alone cannot test this; we have to wait.
    narrator.step('holding to confirm the teammate never reappears');
    await page.waitForTimeout(8_000);
    await expectOverlayCount(page, 1);
    await expectNoOverlayWithTexts(page, [INLINE_TEAMMATE_ROLE], 2_000);
    narrator.check('teammate stays gone through the stability window (count 1)');
  });

  test('lead SessionEnd cascade-removes active inline teammates @area:lifecycle', async ({
    page,
    standalone,
  }) => {
    const { tmpHome, workspaceDir, mockLogFile, narrator } = standalone;
    const teamName = uniqueTeamName('lead-cascade-hooks-on');

    narrator.step('seeding a team of lead + two inline teammates');
    seedTeamConfig(tmpHome, teamName, ['lead', INLINE_TEAMMATE_ROLE, SECOND_TEAMMATE_ROLE]);
    await waitForClaudeHookSetup(tmpHome);
    await spawnExternalClaudeScenario({
      tmpHome,
      workspaceDir,
      mockLogFile,
      sessionId: 'lead-cascade-session-hooks-on',
      scenario: withInlineTeammateSessions(claudeScenario('lead SessionEnd cascade hooks on'), [
        { alias: INLINE_TEAMMATE_ALIAS, role: INLINE_TEAMMATE_ROLE },
        { alias: SECOND_TEAMMATE_ALIAS, role: SECOND_TEAMMATE_ROLE },
      ])
        .at(200)
        .emitHook(
          sessionStartStartup(
            'lead-cascade-session-hooks-on',
            '{{cwd}}',
            '{{transcriptPath}}',
          ) as Record<string, unknown>,
        )
        .at(900)
        .emitHook(
          preToolUseAgent('lead-cascade-session-hooks-on', 'Delegate teammates') as Record<
            string,
            unknown
          >,
        )
        .at(1_100)
        .appendJsonl(buildTeamMetadataRecord(teamName))
        .at(1_300)
        .appendJsonl(buildTeamMetadataRecord(teamName, INLINE_TEAMMATE_ROLE), {
          session: INLINE_TEAMMATE_ALIAS,
        })
        .at(1_300)
        .appendJsonl(buildTeamMetadataRecord(teamName, SECOND_TEAMMATE_ROLE), {
          session: SECOND_TEAMMATE_ALIAS,
        })
        .at(1_500)
        .emitHook(
          subagentStart('lead-cascade-session-hooks-on', INLINE_TEAMMATE_ROLE) as Record<
            string,
            unknown
          >,
        )
        .at(2_200)
        .appendJsonl(
          buildAssistantToolUseRecord('toolu-b7-search', 'WebSearch', {
            query: 'terrarium cascade removal',
          }),
          { session: INLINE_TEAMMATE_ALIAS },
        )
        .at(2_400)
        .appendJsonl(
          buildAssistantToolUseRecord('toolu-b7-review', 'Bash', {
            command: 'npm run review',
          }),
          { session: SECOND_TEAMMATE_ALIAS },
        )
        .at(5_000)
        .emitHook(sessionEndExit('lead-cascade-session-hooks-on') as Record<string, unknown>)
        .holdOpenFor(8_000)
        .build(),
    });

    narrator.step('waiting for the lead + both teammates on screen (count → 3)');
    await expectOverlayCount(page, 3, 12_000);
    await expectOverlayVisibleWithTexts(page, [INLINE_TEAMMATE_ROLE]);
    await expectOverlayVisibleWithTexts(page, [SECOND_TEAMMATE_ROLE]);
    narrator.check('lead + both teammates on screen, each mid-tool (count 3)');

    narrator.step('lead emits SessionEnd — the whole trio should cascade away');
    await expectOverlayCount(page, 0, 8_000);
    narrator.check('closing the lead cascades: all three gone (count → 0)');
  });

  test('external basic subagent with run_in_background routes to basic path @area:lifecycle', async ({
    page,
    standalone,
  }) => {
    const { tmpHome, workspaceDir, mockLogFile, narrator } = standalone;

    await waitForClaudeHookSetup(tmpHome);
    await spawnExternalClaudeScenario({
      tmpHome,
      workspaceDir,
      mockLogFile,
      sessionId: 'external-background-subagent-hooks-on',
      scenario: claudeScenario('external basic background subagent hooks on')
        .at(200)
        .emitHook(
          sessionStartStartup(
            'external-background-subagent-hooks-on',
            '{{cwd}}',
            '{{transcriptPath}}',
          ) as Record<string, unknown>,
        )
        .at(900)
        .emitHook(
          preToolUseAgent(
            'external-background-subagent-hooks-on',
            'Background basic subtask',
          ) as Record<string, unknown>,
        )
        .at(1_100)
        .appendJsonl(
          buildAssistantToolUseRecord('toolu-b8-agent', 'Agent', {
            description: 'Background basic subtask',
            run_in_background: true,
          }),
        )
        .at(1_500)
        .emitHook(
          subagentStart('external-background-subagent-hooks-on', 'general-purpose') as Record<
            string,
            unknown
          >,
        )
        .at(4_500)
        .appendJsonl(buildUserToolResultRecord('toolu-b8-agent'))
        .at(4_900)
        .appendJsonl(buildTurnDurationRecord())
        .holdOpenFor(7_000)
        .build(),
    });

    narrator.step('waiting for a basic Subtask sub-character (run_in_background, no team)');
    await expectOverlayVisible(page, 'Subtask: Background basic subtask');
    await expectOverlayCount(page, 1, 10_000);
    await expectNoOverlay(page, 'general-purpose', 2_000);
    narrator.check(
      'basic "Subtask: Background basic subtask" shown; no "general-purpose" teammate overlay',
    );
    // Stability check: a misrouted SubagentStart could spawn a teammate-style
    // overlay seconds later (the lead has no teamName, so this is the regression).
    narrator.step('holding to confirm no teammate overlay spawns late');
    await page.waitForTimeout(5_000);
    await expectOverlayCount(page, 1);
    narrator.check('still just the basic subtask (count 1) — runInBackground gate holds');
  });
});
