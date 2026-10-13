import { expect, test } from '../../../fixtures/standalone';
import {
  notificationPermissionPrompt,
  preToolUseAgent,
  preToolUseBash,
  sessionEndClear,
  sessionStartClear,
  sessionStartStartup,
  subagentStart,
  taskCompleted,
  teammateIdle,
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
  mockClaudeInitRecord,
  spawnExternalClaudeScenario,
  waitForClaudeHookSetup,
} from '../../../helpers/mock-claude';
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
  buildAssistantToolUseRecord,
  buildTeamMetadataRecord,
  seedTeamConfig,
} from '../../../helpers/team';

test.describe('Hooks ON / lifecycle', () => {
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
              __terrariumTestHooks?: {
                getCharacters?: () => Array<{
                  agentName?: string;
                  bubbleType: 'permission' | 'waiting' | null;
                  waitingAwaitingInput?: boolean;
                }>;
              };
            };
            return w.__terrariumTestHooks
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
});
