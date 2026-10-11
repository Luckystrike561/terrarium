import fs from 'fs';
import path from 'path';

import { expect, test } from '../../../fixtures/standalone';
import {
  idlePrompt,
  notificationPermissionPrompt,
  permissionRequest,
  preToolUseAgent,
  preToolUseBash,
  sendHookEvent,
  sessionEndClear,
  sessionEndExit,
  sessionEndResume,
  sessionStartClear,
  sessionStartResume,
  sessionStartStartup,
  subagentStart,
  taskCompleted,
  teammateIdle,
} from '../../../helpers/hooks';
import {
  INLINE_TEAMMATE_ALIAS,
  INLINE_TEAMMATE_ROLE,
  uniqueTeamName,
  withInlineTeammateSession,
  withInlineTeammateSessions,
} from '../../../helpers/lifecycle';
import {
  claudeScenario,
  mockClaudeInitRecord,
  spawnExternalClaudeScenario,
  waitForClaudeHookSetup,
} from '../../../helpers/mock-claude';
import {
  closeAgentFromOverlay,
  expectAgentOverlayGone,
  expectNoOverlay,
  expectNoOverlayWithTexts,
  expectOverlayCount,
  expectOverlayVisible,
  expectOverlayVisibleForAgent,
  expectOverlayVisibleWithTexts,
  expectSingleAgentOverlay,
  getOverlayByAgentId,
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
  getClaudeProjectDir,
  seedTeamConfig,
} from '../../../helpers/team';

const PARALLEL_PARENT_TOOL_ID = 'toolu-b5-parent';
const SECOND_TEAMMATE_ALIAS = 'reviewer';
const SECOND_TEAMMATE_ROLE = 'reviewer';

function otherOverlayId(ids: number[], knownId: number): number {
  const otherId = ids.find((id) => id !== knownId);
  if (otherId === undefined) {
    throw new Error(`Expected an overlay id other than ${knownId}, got ${JSON.stringify(ids)}`);
  }
  return otherId;
}

test.describe('Hooks ON / lifecycle', () => {
  test('/clear reassigns the same character to the new JSONL @area:lifecycle', async ({
    page,
    standalone,
  }) => {
    const { tmpHome, workspaceDir, mockLogFile, narrator } = standalone;
    const sessionId = 'clear-reassign-session';

    await waitForClaudeHookSetup(tmpHome);
    narrator.step(
      'arranging a /clear — old session ends, a new one runs "npm test", a stale tool hits the old JSONL',
    );
    await spawnExternalClaudeScenario({
      tmpHome,
      workspaceDir,
      mockLogFile,
      sessionId,
      scenario: claudeScenario('/clear reassignment')
        .defineSession('replacement', '{{sessionId}}-clear')
        .at(200)
        .emitHook(
          sessionStartStartup(sessionId, '{{cwd}}', '{{transcriptPath}}') as Record<
            string,
            unknown
          >,
        )
        .at(700)
        .emitHook(preToolUseBash(sessionId, 'npm run before-clear') as Record<string, unknown>)
        .at(3_500)
        .emitHook(sessionEndClear(sessionId) as Record<string, unknown>)
        .at(3_600)
        .appendJsonl(mockClaudeInitRecord('mock-claude-clear-ready'), {
          session: 'replacement',
        })
        .at(3_800)
        .emitHook(
          sessionStartClear(
            '{{sessions.replacement.sessionId}}',
            '{{cwd}}',
            '{{sessions.replacement.transcriptPath}}',
          ) as Record<string, unknown>,
        )
        .at(4_200)
        .emitHook(
          preToolUseBash('{{sessions.replacement.sessionId}}', 'npm test') as Record<
            string,
            unknown
          >,
        )
        .at(4_800)
        .emitHook(preToolUseBash(sessionId, 'npm run stale') as Record<string, unknown>)
        .holdOpenFor(7_000)
        .build(),
    });

    await expectOverlayVisible(page, 'Running: npm run before-clear');
    const originalAgentId = await expectSingleAgentOverlay(page);
    narrator.check('one character on screen before the /clear');

    narrator.step('waiting for the reassigned character to run the new session');
    await expectOverlayVisible(page, 'Running: npm test');
    await expectOverlayCount(page, 1);
    expect(await readAgentOverlayIds(page)).toEqual([originalAgentId]);
    narrator.check('same character shows "Running: npm test" — reassigned, count still 1');

    await page.waitForTimeout(500);
    await expectNoOverlay(page, 'Running: npm run stale');
    expect(await readAgentOverlayIds(page)).toEqual([originalAgentId]);
    narrator.check('stale "npm run stale" never rendered; same single character throughout');
  });

  // The scripted scenario simulates the SAME live claude process firing
  // SessionEnd(resume) then SessionStart(resume) with a new session id within
  // milliseconds, so the grace window reassigns the existing character.
  // `claude --resume` from a fresh process (old process gone, new one arrives
  // later) is the "after the grace window expires" test below.
  test('/resume reassigns the same agent within the grace window @area:lifecycle', async ({
    page,
    standalone,
  }) => {
    const { tmpHome, workspaceDir, mockLogFile, narrator } = standalone;
    const sessionId = 'resume-grace-session';

    await waitForClaudeHookSetup(tmpHome);
    narrator.step('arranging a /resume — session ends then restarts inside the 2s grace window');
    await spawnExternalClaudeScenario({
      tmpHome,
      workspaceDir,
      mockLogFile,
      sessionId,
      scenario: claudeScenario('/resume reassignment')
        .defineSession('replacement', '{{sessionId}}-resume')
        .at(200)
        .emitHook(
          sessionStartStartup(sessionId, '{{cwd}}', '{{transcriptPath}}') as Record<
            string,
            unknown
          >,
        )
        .at(700)
        .emitHook(
          preToolUseBash(sessionId, 'npm run before-resume-grace') as Record<string, unknown>,
        )
        .at(3_500)
        .emitHook(sessionEndResume(sessionId) as Record<string, unknown>)
        .at(3_600)
        .appendJsonl(mockClaudeInitRecord('mock-claude-resume-ready'), {
          session: 'replacement',
        })
        .at(3_800)
        .emitHook(
          sessionStartResume(
            '{{sessions.replacement.sessionId}}',
            '{{cwd}}',
            '{{sessions.replacement.transcriptPath}}',
          ) as Record<string, unknown>,
        )
        .at(4_200)
        .emitHook(
          preToolUseBash('{{sessions.replacement.sessionId}}', 'npm test') as Record<
            string,
            unknown
          >,
        )
        .at(4_800)
        .emitHook(preToolUseBash(sessionId, 'npm run stale') as Record<string, unknown>)
        .holdOpenFor(9_000)
        .build(),
    });

    await expectOverlayVisible(page, 'Running: npm run before-resume-grace');
    const originalAgentId = await expectSingleAgentOverlay(page);
    narrator.check('one character on screen before the /resume');

    narrator.step('waiting for the resumed session to reuse the same character');
    await expectOverlayVisible(page, 'Running: npm test');
    await expectOverlayCount(page, 1);
    expect(await readAgentOverlayIds(page)).toEqual([originalAgentId]);
    narrator.check('same character shows "Running: npm test" within the grace window');

    // Settling wait: give the runtime a chance to wrongly attach the stale tool
    // to the resumed agent before asserting absence.
    await page.waitForTimeout(500);
    await expectNoOverlay(page, 'Running: npm run stale');
    narrator.check('stale "npm run stale" never attaches to the resumed agent');

    // Wait past the 2s resume grace window for the new tool to take effect.
    // expectOverlayVisible polls until the assertion holds; bumping the timeout
    // covers grace expiry + post-grace tool propagation.
    narrator.step('rechecking after the 2s grace window has expired');
    await expectOverlayVisible(page, 'Running: npm test', 5_000);
    await expectOverlayCount(page, 1);
    expect(await readAgentOverlayIds(page)).toEqual([originalAgentId]);
    narrator.check('still the same single character past the grace window');
  });

  test('/clear edge case with a sibling agent in the same projectDir @area:lifecycle', async ({
    page,
    standalone,
  }) => {
    const { tmpHome, workspaceDir, mockLogFile, narrator } = standalone;
    const mainSessionId = 'clear-edge-main-session';

    await waitForClaudeHookSetup(tmpHome);
    narrator.step('arranging a /clear on the main agent while a sibling shares its project dir');
    await spawnExternalClaudeScenario({
      tmpHome,
      workspaceDir,
      mockLogFile,
      sessionId: mainSessionId,
      scenario: claudeScenario('/clear edge with sibling agent')
        .defineSession('replacement', '{{sessionId}}-clear')
        .at(200)
        .emitHook(
          sessionStartStartup(mainSessionId, '{{cwd}}', '{{transcriptPath}}') as Record<
            string,
            unknown
          >,
        )
        .at(700)
        .emitHook(
          preToolUseBash(mainSessionId, 'npm run before-sibling-clear') as Record<string, unknown>,
        )
        .at(7_000)
        .emitHook(sessionEndClear(mainSessionId) as Record<string, unknown>)
        .at(7_100)
        .appendJsonl(mockClaudeInitRecord('mock-claude-sibling-clear-ready'), {
          session: 'replacement',
        })
        .at(7_300)
        .emitHook(
          sessionStartClear(
            '{{sessions.replacement.sessionId}}',
            '{{cwd}}',
            '{{sessions.replacement.transcriptPath}}',
          ) as Record<string, unknown>,
        )
        .at(7_600)
        .emitHook(
          preToolUseBash('{{sessions.replacement.sessionId}}', 'npm run cleared') as Record<
            string,
            unknown
          >,
        )
        .at(8_100)
        .emitHook(preToolUseBash(mainSessionId, 'npm run stale') as Record<string, unknown>)
        .holdOpenFor(12_000)
        .build(),
    });

    await expectOverlayVisible(page, 'Running: npm run before-sibling-clear');
    const mainAgentId = await expectSingleAgentOverlay(page);
    narrator.check('main agent on screen before the /clear (count 1)');

    await spawnExternalClaudeScenario({
      tmpHome,
      workspaceDir,
      mockLogFile,
      sessionId: 'sibling-clear-edge',
      scenario: claudeScenario('sibling external session')
        .at(200)
        .emitHook(
          sessionStartStartup('sibling-clear-edge', '{{cwd}}', '{{transcriptPath}}') as Record<
            string,
            unknown
          >,
        )
        .at(1_000)
        .emitHook(
          preToolUseBash('sibling-clear-edge', 'npm run sibling') as Record<string, unknown>,
        )
        .holdOpenFor(12_000)
        .build(),
    });

    narrator.step('waiting for both agents on screen (count → 2)');
    await expectOverlayCount(page, 2, 12_000);
    const externalAgentId = otherOverlayId(await readAgentOverlayIds(page), mainAgentId);
    narrator.check('two characters share the same project dir');

    await expectOverlayVisibleForAgent(page, externalAgentId, 'Running: npm run sibling');
    await expectOverlayVisibleForAgent(page, mainAgentId, 'Running: npm run cleared', 12_000);
    await expectNoOverlay(page, 'Running: npm run stale');
    expect(await readAgentOverlayIds(page)).toEqual([mainAgentId, externalAgentId]);
    narrator.check(
      'sibling keeps "npm run sibling", main reassigns to "npm run cleared", stale never appears',
    );
  });

  test('--resume after the grace window expires cleans up the old agent @area:lifecycle', async ({
    page,
    standalone,
  }) => {
    const { tmpHome, workspaceDir, mockLogFile, narrator } = standalone;

    await waitForClaudeHookSetup(tmpHome);
    await spawnExternalClaudeScenario({
      tmpHome,
      workspaceDir,
      mockLogFile,
      sessionId: 'late-resume-old-session-hooks-on',
      scenario: claudeScenario('--resume after grace expires hooks on')
        .defineSession('replacement', 'late-resume-new-session-hooks-on')
        .at(200)
        .emitHook(
          sessionStartStartup(
            'late-resume-old-session-hooks-on',
            '{{cwd}}',
            '{{transcriptPath}}',
          ) as Record<string, unknown>,
        )
        .at(900)
        .emitHook(
          preToolUseBash('late-resume-old-session-hooks-on', 'npm run before-resume') as Record<
            string,
            unknown
          >,
        )
        .at(2_200)
        .emitHook(sessionEndResume('late-resume-old-session-hooks-on') as Record<string, unknown>)
        .at(4_800)
        .appendJsonl(mockClaudeInitRecord('mock-claude-late-resume-ready'), {
          session: 'replacement',
        })
        .at(5_000)
        .emitHook(
          sessionStartResume(
            '{{sessions.replacement.sessionId}}',
            '{{cwd}}',
            '{{sessions.replacement.transcriptPath}}',
          ) as Record<string, unknown>,
        )
        .at(5_300)
        .emitHook(
          preToolUseBash('{{sessions.replacement.sessionId}}', 'npm run late-resume') as Record<
            string,
            unknown
          >,
        )
        .holdOpenFor(9_000)
        .build(),
    });

    narrator.step('waiting for the pre-resume tool to render');
    await expectOverlayVisible(page, 'Running: npm run before-resume');
    const oldAgentId = await expectSingleAgentOverlay(page);
    narrator.check('old character shows "Running: npm run before-resume"');

    narrator.step('resume arrives AFTER the grace window — the old character should be cleaned up');
    // Id-scoped on purpose: the replacement session renders ~700ms after the
    // grace-expiry removal, so a global count-0 assertion has to catch a sub-
    // second all-gone window that slow CI runners poll right past (macOS CI
    // failed exactly this way). The contract is "the OLD character goes away".
    await expectAgentOverlayGone(page, oldAgentId, 8_000);
    narrator.check('old character removed');
    await expectOverlayVisible(page, 'Running: npm run late-resume', 10_000);
    await expectOverlayCount(page, 1);
    const [newAgentId] = await readAgentOverlayIds(page);
    expect(newAgentId).toBeDefined();
    expect(newAgentId).not.toBe(oldAgentId);
    // The old agent must be GONE, not reassigned: a reassignment would have kept
    // oldAgentId on the surviving character (that is the within-grace behavior, and
    // the id check above would catch it), a zombie would leave two overlays.
    // Asserted on the end state rather than on a transient count of 0 — the cleanup
    // and the replacement's adoption land within a few hundred ms of each other, so
    // polling for the empty office in between is a coin flip.
    await expect(getOverlayByAgentId(page, oldAgentId)).toHaveCount(0);
    narrator.check('late-resumed session gets a NEW character; the old one is gone');
  });

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
            query: 'pixel agents lifecycle regressions',
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
            query: 'pixel agents cascade removal',
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

  test('lead permission_prompt routes bubble to teammate not lead when teammates exist @area:lifecycle', async ({
    page,
    standalone,
  }) => {
    const { tmpHome, workspaceDir, mockLogFile, narrator } = standalone;
    const teamName = uniqueTeamName('teammate-permission-hooks-on');

    narrator.step('seeding a team of lead + one inline teammate');
    seedTeamConfig(tmpHome, teamName, ['lead', INLINE_TEAMMATE_ROLE]);
    await waitForClaudeHookSetup(tmpHome);
    await spawnExternalClaudeScenario({
      tmpHome,
      workspaceDir,
      mockLogFile,
      sessionId: 'teammate-permission-session-hooks-on',
      scenario: withInlineTeammateSession(claudeScenario('teammate permission routing hooks on'))
        .at(200)
        .emitHook(
          sessionStartStartup(
            'teammate-permission-session-hooks-on',
            '{{cwd}}',
            '{{transcriptPath}}',
          ) as Record<string, unknown>,
        )
        .at(900)
        .emitHook(
          preToolUseAgent(
            'teammate-permission-session-hooks-on',
            'Delegate teammate work',
          ) as Record<string, unknown>,
        )
        .at(1_100)
        .appendJsonl(buildTeamMetadataRecord(teamName))
        .at(1_300)
        .appendJsonl(buildTeamMetadataRecord(teamName, INLINE_TEAMMATE_ROLE), {
          session: INLINE_TEAMMATE_ALIAS,
        })
        .at(1_500)
        .emitHook(
          subagentStart('teammate-permission-session-hooks-on', INLINE_TEAMMATE_ROLE) as Record<
            string,
            unknown
          >,
        )
        .at(2_200)
        .appendJsonl(
          buildAssistantToolUseRecord('toolu-b9-search', 'WebSearch', {
            query: 'permission routing',
          }),
          { session: INLINE_TEAMMATE_ALIAS },
        )
        .at(3_500)
        .emitHook(
          notificationPermissionPrompt('teammate-permission-session-hooks-on') as Record<
            string,
            unknown
          >,
        )
        .at(5_200)
        .emitHook(
          taskCompleted('teammate-permission-session-hooks-on', INLINE_TEAMMATE_ROLE) as Record<
            string,
            unknown
          >,
        )
        .holdOpenFor(8_000)
        .build(),
    });

    narrator.step('waiting for the teammate on screen doing the WebSearch');
    await expectOverlayVisibleWithTexts(page, [INLINE_TEAMMATE_ROLE], 12_000);
    narrator.check('teammate is up and working');

    narrator.step(
      'a permission_prompt arrives on the LEAD — the bubble should land on the working teammate',
    );
    await expectOverlayVisibleWithTexts(page, [INLINE_TEAMMATE_ROLE, 'Needs approval'], 8_000);
    await expectNoOverlayWithTexts(page, ['LEAD', 'Needs approval']);
    narrator.check('"Needs approval" is on the teammate; the lead has no bubble');

    narrator.step('waiting for the teammate to finish its task');
    await expectNoOverlayWithTexts(page, [INLINE_TEAMMATE_ROLE, 'Needs approval'], 8_000);
    narrator.check('bubble clears when the teammate completes');
  });

  test('TeammateIdle marks only the targeted teammate done and leaves lead unchanged @area:lifecycle', async ({
    page,
    standalone,
  }) => {
    const { tmpHome, workspaceDir, mockLogFile, narrator } = standalone;
    const teamName = uniqueTeamName('targeted-teammate-idle-hooks-on');

    narrator.step('seeding a team of lead + two inline teammates');
    seedTeamConfig(tmpHome, teamName, ['lead', INLINE_TEAMMATE_ROLE, SECOND_TEAMMATE_ROLE]);
    await waitForClaudeHookSetup(tmpHome);
    await spawnExternalClaudeScenario({
      tmpHome,
      workspaceDir,
      mockLogFile,
      sessionId: 'targeted-teammate-idle-session-hooks-on',
      scenario: withInlineTeammateSessions(claudeScenario('targeted teammate idle hooks on'), [
        { alias: INLINE_TEAMMATE_ALIAS, role: INLINE_TEAMMATE_ROLE },
        { alias: SECOND_TEAMMATE_ALIAS, role: SECOND_TEAMMATE_ROLE },
      ])
        .at(200)
        .emitHook(
          sessionStartStartup(
            'targeted-teammate-idle-session-hooks-on',
            '{{cwd}}',
            '{{transcriptPath}}',
          ) as Record<string, unknown>,
        )
        .at(900)
        .emitHook(
          preToolUseAgent(
            'targeted-teammate-idle-session-hooks-on',
            'Delegate teammates',
          ) as Record<string, unknown>,
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
          subagentStart('targeted-teammate-idle-session-hooks-on', INLINE_TEAMMATE_ROLE) as Record<
            string,
            unknown
          >,
        )
        .at(2_200)
        .appendJsonl(
          buildAssistantToolUseRecord('toolu-b10-search', 'WebSearch', {
            query: 'specific teammate idle',
          }),
          { session: INLINE_TEAMMATE_ALIAS },
        )
        .at(2_400)
        .appendJsonl(
          buildAssistantToolUseRecord('toolu-b10-review', 'Bash', {
            command: 'npm run reviewer',
          }),
          { session: SECOND_TEAMMATE_ALIAS },
        )
        .at(4_000)
        .emitHook(
          teammateIdle('targeted-teammate-idle-session-hooks-on', INLINE_TEAMMATE_ROLE) as Record<
            string,
            unknown
          >,
        )
        .holdOpenFor(8_000)
        .build(),
    });

    narrator.step('waiting for the lead + two teammates on screen (count → 3)');
    await expectOverlayCount(page, 3, 12_000);
    narrator.check('lead + two teammates on screen (count 3)');

    narrator.step('a TeammateIdle hook targets only the first teammate and marks it Done');
    await expect
      .poll(
        async () =>
          page.evaluate((agentName) => {
            const w = window as Window & {
              __pixelAgentsTestHooks?: {
                getCharacters?: () => Array<{
                  agentName?: string;
                  bubbleType: 'permission' | 'waiting' | null;
                  waitingAwaitingInput?: boolean;
                }>;
              };
            };
            return w.__pixelAgentsTestHooks
              ?.getCharacters?.()
              .find((ch) => ch.agentName === agentName);
          }, INLINE_TEAMMATE_ROLE),
        { timeout: 8_000 },
      )
      .toMatchObject({ bubbleType: 'waiting', waitingAwaitingInput: false });
    await expectOverlayVisibleWithTexts(page, [SECOND_TEAMMATE_ROLE, 'Running: npm run reviewer']);
    await expectNoOverlayWithTexts(page, [INLINE_TEAMMATE_ROLE, 'Waiting for input']);
    await expectNoOverlayWithTexts(page, [SECOND_TEAMMATE_ROLE, 'Waiting for input']);
    await expectNoOverlayWithTexts(page, ['LEAD', 'Waiting for input']);
    narrator.check(
      'first teammate exposes the Done checkmark; second still "Running: npm run reviewer"; lead unaffected',
    );
  });

  test('rapid /clear then new tool within 500ms lands on the reassigned agent @area:lifecycle', async ({
    page,
    standalone,
  }) => {
    const { tmpHome, workspaceDir, mockLogFile, narrator } = standalone;
    const sessionId = 'rapid-clear-session';

    await waitForClaudeHookSetup(tmpHome);
    narrator.step(
      'arranging a time-compressed /clear — end, restart, fresh tool + a ghost tool all within ~500ms',
    );
    await spawnExternalClaudeScenario({
      tmpHome,
      workspaceDir,
      mockLogFile,
      sessionId,
      scenario: claudeScenario('rapid clear then new tool under 500ms')
        .defineSession('replacement', '{{sessionId}}-clear-fast')
        .at(200)
        .emitHook(
          sessionStartStartup(sessionId, '{{cwd}}', '{{transcriptPath}}') as Record<
            string,
            unknown
          >,
        )
        .at(700)
        .emitHook(
          preToolUseBash(sessionId, 'npm run before-rapid-clear') as Record<string, unknown>,
        )
        .at(3_500)
        .emitHook(sessionEndClear(sessionId) as Record<string, unknown>)
        .at(3_600)
        .appendJsonl(mockClaudeInitRecord('mock-claude-clear-fast-ready'), {
          session: 'replacement',
        })
        .at(3_650)
        .emitHook(
          sessionStartClear(
            '{{sessions.replacement.sessionId}}',
            '{{cwd}}',
            '{{sessions.replacement.transcriptPath}}',
          ) as Record<string, unknown>,
        )
        .at(3_775)
        .emitHook(
          preToolUseBash('{{sessions.replacement.sessionId}}', 'npm run fresh') as Record<
            string,
            unknown
          >,
        )
        .at(3_925)
        .emitHook(preToolUseBash(sessionId, 'npm run ghost') as Record<string, unknown>)
        .holdOpenFor(7_000)
        .build(),
    });

    await expectOverlayVisible(page, 'Running: npm run before-rapid-clear');
    const originalAgentId = await expectSingleAgentOverlay(page);
    narrator.check('one character before the rapid /clear');

    narrator.step('waiting for the reassigned character to land on the fresh tool');
    await expectOverlayVisible(page, 'Running: npm run fresh');
    await expectOverlayCount(page, 1);
    expect(await readAgentOverlayIds(page)).toEqual([originalAgentId]);
    narrator.check('same character shows "Running: npm run fresh", count 1');

    await page.waitForTimeout(750);
    await expectNoOverlay(page, 'Running: npm run ghost');
    expect(await readAgentOverlayIds(page)).toEqual([originalAgentId]);
    narrator.check('ghost "npm run ghost" never renders; id unchanged');
  });

  test('close via X prevents re-adoption of old JSONL during dismissal cooldown @area:lifecycle', async ({
    page,
    standalone,
  }) => {
    const { tmpHome, workspaceDir, mockLogFile, narrator } = standalone;

    await waitForClaudeHookSetup(tmpHome);
    await spawnExternalClaudeScenario({
      tmpHome,
      workspaceDir,
      mockLogFile,
      sessionId: 'dismissal-cooldown-old-session-hooks-on',
      scenario: claudeScenario(' dismissal cooldown hooks on old session')
        .at(200)
        .emitHook(
          sessionStartStartup(
            'dismissal-cooldown-old-session-hooks-on',
            '{{cwd}}',
            '{{transcriptPath}}',
          ) as Record<string, unknown>,
        )
        .at(900)
        .emitHook(
          preToolUseBash('dismissal-cooldown-old-session-hooks-on', 'npm run old-live') as Record<
            string,
            unknown
          >,
        )
        .at(7_000)
        .appendJsonl(
          buildAssistantToolUseRecord('toolu-b12-old-stale', 'Bash', {
            command: 'npm run old-stale',
          }),
        )
        .holdOpenFor(12_000)
        .build(),
    });

    narrator.step('waiting for the external agent to be active');
    await expectOverlayVisible(page, 'Running: npm run old-live');
    const oldAgentId = await expectSingleAgentOverlay(page);
    narrator.check('external agent shows "Running: npm run old-live"');
    await closeAgentFromOverlay(page, { agentId: oldAgentId });
    await expectOverlayCount(page, 0, 8_000);
    narrator.check('agent removed after the "×" (count → 0)');

    await spawnExternalClaudeScenario({
      tmpHome,
      workspaceDir,
      mockLogFile,
      sessionId: 'dismissal-cooldown-new-session-hooks-on',
      scenario: claudeScenario(' dismissal cooldown hooks on new session')
        .at(200)
        .emitHook(
          sessionStartStartup(
            'dismissal-cooldown-new-session-hooks-on',
            '{{cwd}}',
            '{{transcriptPath}}',
          ) as Record<string, unknown>,
        )
        .at(900)
        .emitHook(
          preToolUseBash('dismissal-cooldown-new-session-hooks-on', 'npm run reopened') as Record<
            string,
            unknown
          >,
        )
        .holdOpenFor(8_000)
        .build(),
    });

    narrator.step('waiting for the fresh external session to appear');
    await expectOverlayVisible(page, 'Running: npm run reopened', 10_000);
    await expectOverlayCount(page, 1);
    const [newAgentId] = await readAgentOverlayIds(page);
    expect(newAgentId).not.toBe(oldAgentId);
    narrator.check('the fresh session gets a NEW character (count 1)');

    // Stability check: the closed JSONL must NOT be re-adopted during the 3-min
    // cooldown. 4s is enough to cover several scanner ticks.
    narrator.step(
      'holding while the dismissed JSONL gets a late stale write that must not be re-adopted',
    );
    await page.waitForTimeout(4_000);
    await expectNoOverlay(page, 'Running: npm run old-stale', 2_000);
    await expectOverlayCount(page, 1);
    narrator.check('closed JSONL never re-adopted during cooldown; count stays 1');
  });

  // verify playDoneSound() fires on agentStatus: 'waiting'.
  // The webview's notificationSound.ts records every invocation into
  // window.__pixelAgentsTestHooks.playedSounds (a test-only marker). We
  // trigger waiting state by sending an idle_prompt notification hook (the
  // same hook path the spawn-paths test uses to surface "Might be waiting for
  // input") and assert the sound was dispatched.
  test('done sound chime fires on agentStatus waiting @area:cross-cutting', async ({
    page,
    standalone,
  }) => {
    const { tmpHome, workspaceDir, mockLogFile, hookServerConfig, narrator } = standalone;

    await waitForClaudeHookSetup(tmpHome);
    const sessionId = 'done-chime-session';

    await spawnExternalClaudeScenario({
      tmpHome,
      workspaceDir,
      mockLogFile,
      scenario: claudeScenario('done sound chime smoke').holdOpenFor(3_000).build(),
      sessionId,
    });

    const projectDir = getClaudeProjectDir(tmpHome, workspaceDir);
    const transcriptPath = path.join(projectDir, `${sessionId}.jsonl`);

    // SessionStart registers the session with the hook server so that the next
    // event (PreToolUseBash) drives the agent visible rather than landing in the
    // pre-registration buffer.
    await sendHookEvent(
      hookServerConfig,
      sessionStartStartup(sessionId, workspaceDir, transcriptPath),
    );

    // Drive the agent active first (so the waiting transition is a real state
    // change rather than a no-op on a never-active agent).
    await sendHookEvent(hookServerConfig, preToolUseBash(sessionId, 'npm test'));
    await expectOverlayCount(page, 1);
    await expectOverlayVisible(page, 'Running: npm test');
    narrator.check('external agent active — "Running: npm test"');

    // Reset the marker AFTER active-state dispatch so we only capture sounds
    // triggered by the idle_prompt under test.
    await page.evaluate(() => {
      const w = window as Window & {
        __pixelAgentsTestHooks?: { playedSounds?: unknown[] };
      };
      if (w.__pixelAgentsTestHooks) w.__pixelAgentsTestHooks.playedSounds = [];
    });

    narrator.step('sending an idle_prompt to flip the agent to waiting');
    await sendHookEvent(hookServerConfig, idlePrompt(sessionId));
    await expectOverlayVisible(page, 'Waiting for input');
    narrator.check('overlay shows "Waiting for input"');

    narrator.step(
      'checking a "done" chime was dispatched (test hook — the chime is not audible in the video)',
    );
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const w = window as Window & {
              __pixelAgentsTestHooks?: { playedSounds?: Array<{ kind: string }> };
            };
            return (w.__pixelAgentsTestHooks?.playedSounds ?? []).map((s) => s.kind);
          }),
        { timeout: 5_000 },
      )
      .toContain('done');
    narrator.check('playedSounds contains a "done" entry');
  });

  // verify restored agents skip the matrix-rain spawn animation.
  //
  // Invariant: characters created from the existingAgents payload pass
  // skipSpawnEffect=true. If someone drops that arg, restored agents would
  // briefly show matrixEffect='spawn' for ~300ms (the matrix rain animation),
  // regressing the "instant restore" UX.
  //
  // Trigger: reload the page while the server (and its registered agent) keeps
  // running. The reload re-mounts the SPA, sends a fresh webviewReady, and the
  // server unconditionally resends existingAgents on every webviewReady.
  //
  // Observable: window.__pixelAgentsTestHooks.getCharacters() (exposed from
  // App.tsx) returns a snapshot of character.matrixEffect. The addAgentLog
  // captures matrixEffect AT addAgent time (synchronous inside the wrapper),
  // immune to the ~300ms matrix-effect lifetime race a snapshot read would hit.
  test('restored agents skip the matrix spawn animation @area:cross-cutting', async ({
    page,
    standalone,
  }) => {
    const { tmpHome, workspaceDir, mockLogFile, narrator } = standalone;
    const sessionId = 'restore-skip-spawn-session';

    await waitForClaudeHookSetup(tmpHome);
    narrator.step('spawning an agent, then reloading the page to force a fresh restore');
    await spawnExternalClaudeScenario({
      tmpHome,
      workspaceDir,
      mockLogFile,
      sessionId,
      scenario: claudeScenario('restored agents skip spawn effect')
        .at(200)
        .emitHook(
          sessionStartStartup(sessionId, '{{cwd}}', '{{transcriptPath}}') as Record<
            string,
            unknown
          >,
        )
        .at(700)
        .emitHook(preToolUseBash(sessionId, 'npm test') as Record<string, unknown>)
        .holdOpenFor(20_000)
        .build(),
    });

    await expectOverlayCount(page, 1);
    narrator.check('one agent after the initial spawn');

    // Let the original spawn animation finish so we don't confuse it with
    // the post-restore observation (matrix effect lives ~300ms; 800ms cushion).
    await page.waitForTimeout(800);

    narrator.step('reloading the page to restore existingAgents against the still-running server');
    await standalone.reloadPage();

    // The fresh page has an empty addAgentLog. Wait until restoreAgents has
    // run (existingAgents → layoutLoaded → addAgent), then read the log.
    narrator.step(
      'the whole signal is a test-hook read: every restored agent must skip the spawn effect',
    );
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const w = window as Window & {
              __pixelAgentsTestHooks?: { addAgentLog?: unknown[] };
            };
            return w.__pixelAgentsTestHooks?.addAgentLog?.length ?? 0;
          }),
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);

    const log = await page.evaluate(() => {
      const w = window as Window & {
        __pixelAgentsTestHooks?: {
          addAgentLog?: Array<{
            id: number;
            skipSpawnEffect: boolean | undefined;
            matrixEffectAtCreation: string | null;
          }>;
        };
      };
      return w.__pixelAgentsTestHooks?.addAgentLog ?? [];
    });

    // Every addAgent call against this fresh page comes from the restore path
    // (there's no agentCreated message between page load and our read).
    // Each must have skipSpawnEffect=true and matrixEffect=null at creation.
    expect(log.length).toBeGreaterThan(0);
    for (const entry of log) {
      expect(entry.skipSpawnEffect).toBe(true);
      expect(entry.matrixEffectAtCreation).toBeNull();
    }
    narrator.check('every restored agent created with skipSpawnEffect=true and no matrix effect');
  });

  // verify formatToolStatus produces the right overlay text for every
  // PreToolUse'd tool, not just Bash. Every other e2e test fires Bash and
  // asserts "Running: npm test"; the 9 other tool-name branches in
  // claudeModule.formatToolStatus had zero direct coverage prior to this.
  //
  // Each entry below maps a hook payload (tool_name + tool_input) to the
  // expected overlay text. If formatToolStatus regresses, this test catches
  // it. The agent stays the same throughout; each PreToolUse swaps the
  // active tool text, and PostToolUse clears it before the next.
  test('tool status text matches every PreToolUse tool name @area:cross-cutting', async ({
    page,
    standalone,
  }) => {
    const { tmpHome, workspaceDir, mockLogFile, narrator } = standalone;

    await waitForClaudeHookSetup(tmpHome);
    const sessionId = 'tool-status-matrix-session';

    // Task / Agent tools follow the sub-character code path (covered by the basic-spawn test)
    // and don't change the parent overlay text — they're excluded here.
    // WebSearch returns "Searching the web" but is covered implicitly by
    // the same code branch as Glob/Grep; one Search variant is enough.
    type ToolCase = { toolName: string; toolInput: Record<string, unknown>; expectedText: string };
    const cases: ToolCase[] = [
      { toolName: 'Read', toolInput: { file_path: '/x/foo.ts' }, expectedText: 'Reading foo.ts' },
      { toolName: 'Edit', toolInput: { file_path: '/x/bar.ts' }, expectedText: 'Editing bar.ts' },
      { toolName: 'Write', toolInput: { file_path: '/x/baz.ts' }, expectedText: 'Writing baz.ts' },
      { toolName: 'Glob', toolInput: { pattern: '**/*.ts' }, expectedText: 'Searching files' },
      { toolName: 'Grep', toolInput: { pattern: 'foo' }, expectedText: 'Searching code' },
      {
        toolName: 'WebFetch',
        toolInput: { url: 'https://x' },
        expectedText: 'Fetching web content',
      },
    ];

    // Scenario-driven with 3s per tool phase: each PostToolUse clears the prior
    // tool, the paired PreToolUse 150ms later swaps in the next one, and the 3s
    // phase keeps every label on screen long enough for the run video AND gives
    // the polling assertions seconds of slack. The first Bash phase runs
    // t+0.7s→5s because the external session needs a moment to be adopted
    // before assertions start.
    const scenarioBuilder = claudeScenario('tool status text matrix')
      .at(200)
      .emitHook(
        sessionStartStartup(sessionId, '{{cwd}}', '{{transcriptPath}}') as Record<string, unknown>,
      )
      .at(700)
      .emitHook(preToolUseBash(sessionId, 'npm test') as Record<string, unknown>);
    const CASE_BASE_MS = 5_000;
    const CASE_PHASE_MS = 3_000;
    cases.forEach((c, index) => {
      const atMs = CASE_BASE_MS + index * CASE_PHASE_MS;
      scenarioBuilder
        .at(atMs)
        .emitHook({ session_id: sessionId, hook_event_name: 'PostToolUse' })
        .at(atMs + 150)
        .emitHook({
          session_id: sessionId,
          hook_event_name: 'PreToolUse',
          tool_name: c.toolName,
          tool_input: c.toolInput,
        });
    });
    const sessionEndAtMs = CASE_BASE_MS + cases.length * CASE_PHASE_MS + 500;
    scenarioBuilder
      .at(sessionEndAtMs)
      .emitHook(sessionEndExit(sessionId) as Record<string, unknown>)
      .holdOpenFor(sessionEndAtMs + 2_000);

    await spawnExternalClaudeScenario({
      tmpHome,
      workspaceDir,
      mockLogFile,
      scenario: scenarioBuilder.build(),
      sessionId,
    });

    await expectOverlayCount(page, 1);
    await expectOverlayVisible(page, 'Running: npm test');
    narrator.check('agent active — "Running: npm test"');

    narrator.step('cycling through Read, Edit, Write, Glob, Grep, WebFetch — one tool every 3s');
    for (const c of cases) {
      await expectOverlayVisible(page, c.expectedText);
    }
    narrator.check(
      'each tool shows its exact status: Reading foo.ts, Editing bar.ts, Writing baz.ts, Searching files/code, Fetching web content',
    );

    narrator.step('waiting for SessionEnd to remove the character');
    await expectOverlayCount(page, 0);
    narrator.check('SessionEnd removes the character (count → 0)');
  });

  // verify playPermissionSound fires on agentToolPermission.
  // Companion to the done-sound test (which fires on agentStatus: waiting) — same
  // playedSounds instrumentation, just the other sound function.
  test('permission sound chime fires on agentToolPermission @area:cross-cutting', async ({
    page,
    standalone,
  }) => {
    const { tmpHome, workspaceDir, mockLogFile, hookServerConfig, narrator } = standalone;

    await waitForClaudeHookSetup(tmpHome);
    const sessionId = 'permission-chime-session';

    await spawnExternalClaudeScenario({
      tmpHome,
      workspaceDir,
      mockLogFile,
      scenario: claudeScenario('permission sound chime smoke').holdOpenFor(3_000).build(),
      sessionId,
    });

    const projectDir = getClaudeProjectDir(tmpHome, workspaceDir);
    const transcriptPath = path.join(projectDir, `${sessionId}.jsonl`);
    await sendHookEvent(
      hookServerConfig,
      sessionStartStartup(sessionId, workspaceDir, transcriptPath),
    );
    await sendHookEvent(hookServerConfig, preToolUseBash(sessionId, 'npm test'));
    await expectOverlayCount(page, 1);
    narrator.check('external agent active');

    // Reset the marker right before the action under test, so any earlier
    // sounds (none expected from the spawn, but defensive) are ignored.
    await page.evaluate(() => {
      const w = window as Window & {
        __pixelAgentsTestHooks?: { playedSounds?: unknown[] };
      };
      if (w.__pixelAgentsTestHooks) w.__pixelAgentsTestHooks.playedSounds = [];
    });

    narrator.step('sending a permissionRequest hook to raise the approval bubble');
    await sendHookEvent(hookServerConfig, permissionRequest(sessionId));
    await expectOverlayVisible(page, 'Needs approval');
    narrator.check('"Needs approval" bubble is visible');

    narrator.step(
      'checking a "permission" chime was dispatched (test hook — not audible in the video)',
    );
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const w = window as Window & {
              __pixelAgentsTestHooks?: { playedSounds?: Array<{ kind: string }> };
            };
            return (w.__pixelAgentsTestHooks?.playedSounds ?? []).map((s) => s.kind);
          }),
        { timeout: 5_000 },
      )
      .toContain('permission');
    narrator.check('playedSounds contains a "permission" entry');
  });

  // The server installs the pixel-agents hook into ~/.claude/settings.json on
  // startup. Historical bugs around clobbering pre-existing third-party hook
  // entries make this a real bug surface; unit tests cover the installer with
  // mocked fs, this e2e covers the actual install landing on disk.
  //
  // These helpers match our hook entries on the script name alone
  // ('claude-hook.js' or the legacy 'pixel-agents-hook.js'), which is fine
  // here: every command the installer writes contains the full path.

  interface ClaudeHookSettings {
    hooks?: Record<string, Array<{ matcher?: string; hooks: Array<{ command: string }> }>>;
  }

  function readClaudeSettings(tmpHome: string): ClaudeHookSettings {
    const p = path.join(tmpHome, '.claude', 'settings.json');
    if (!fs.existsSync(p)) return {};
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      return {};
    }
  }

  function pixelAgentsHookPresent(settings: ClaudeHookSettings, eventName: string): boolean {
    const entries = settings.hooks?.[eventName] ?? [];
    for (const entry of entries) {
      for (const h of entry.hooks ?? []) {
        if (h.command?.includes('claude-hook.js') || h.command?.includes('pixel-agents-hook.js')) {
          return true;
        }
      }
    }
    return false;
  }

  // the server installs the pixel-agents hook on startup with the default
  // hooksEnabled=true. Sanity check — if this fails, claudeHookInstaller never
  // ran, and every other hooks-on test is operating against an empty
  // settings.json (i.e., hooks are silently no-op'd).
  test('pixel-agents hook is installed in settings.json on server startup @area:cross-cutting', async ({
    standalone,
  }) => {
    const { tmpHome, narrator } = standalone;

    narrator.step('reading ~/.claude/settings.json after startup — the hook must be installed');
    await waitForClaudeHookSetup(tmpHome);
    const settings = readClaudeSettings(tmpHome);

    // installHooks writes entries for every hook event the provider supports.
    // SessionStart and PreToolUse are the load-bearing ones; if those are present,
    // installation succeeded.
    expect(pixelAgentsHookPresent(settings, 'SessionStart')).toBe(true);
    expect(pixelAgentsHookPresent(settings, 'PreToolUse')).toBe(true);
    narrator.check(
      '~/.claude/settings.json has the pixel-agents hook under both SessionStart and PreToolUse',
    );
  });

  // A fresh PreToolUse clears any stale "Needs approval" bubble unless the new
  // tool itself requests permission — otherwise the bubble would linger across
  // tool transitions inside the same session.
  test('permission bubble auto-clears when a fresh PreToolUse arrives @area:cross-cutting', async ({
    page,
    standalone,
  }) => {
    const { tmpHome, workspaceDir, mockLogFile, narrator } = standalone;

    await waitForClaudeHookSetup(tmpHome);
    const sessionId = 'permission-bubble-clear-session';

    // Scenario-driven with ~4s phases: every state is visible in the run video.
    await spawnExternalClaudeScenario({
      tmpHome,
      workspaceDir,
      mockLogFile,
      sessionId,
      scenario: claudeScenario('permission bubble auto-clear')
        .at(200)
        .emitHook(
          sessionStartStartup(sessionId, '{{cwd}}', '{{transcriptPath}}') as Record<
            string,
            unknown
          >,
        )
        .at(700)
        .emitHook(preToolUseBash(sessionId, 'npm test') as Record<string, unknown>)
        .at(4_500)
        .emitHook(permissionRequest(sessionId) as Record<string, unknown>)
        // Fresh PreToolUse without permissionActive must clear the bubble and
        // swap the overlay text to the new tool's status string.
        .at(8_500)
        .emitHook({ session_id: sessionId, hook_event_name: 'PostToolUse' })
        .at(8_650)
        .emitHook({
          session_id: sessionId,
          hook_event_name: 'PreToolUse',
          tool_name: 'Read',
          tool_input: { file_path: '/x/foo.ts' },
        })
        .holdOpenFor(13_000)
        .build(),
    });

    await expectOverlayCount(page, 1);
    await expectOverlayVisible(page, 'Running: npm test');
    narrator.check('agent active — "Running: npm test"');

    await expectOverlayVisible(page, 'Needs approval');
    narrator.check('"Needs approval" bubble is up');

    narrator.step('a fresh PreToolUse(Read) arrives, as if the user approved in the terminal');
    await expectOverlayVisible(page, 'Reading foo.ts');
    await expectNoOverlay(page, 'Needs approval', 2_000);
    narrator.check('overlay swaps to "Reading foo.ts"; the stale approval bubble is gone');
  });
});
