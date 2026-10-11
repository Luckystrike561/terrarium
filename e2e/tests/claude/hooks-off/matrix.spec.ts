import type { Page } from '@playwright/test';

import { test } from '../../../fixtures/standalone';
import {
  INLINE_TEAMMATE_ALIAS,
  INLINE_TEAMMATE_ROLE,
  TMUX_TEAMMATE_ALIAS,
  uniqueTeamName,
  withInlineTeammateSession,
  withTmuxTeammateSession,
} from '../../../helpers/lifecycle';
import { claudeScenario, spawnExternalClaudeScenario } from '../../../helpers/mock-claude';
import {
  expectNoOverlayWithTexts,
  expectOverlayCount,
  expectOverlayVisible,
  expectOverlayVisibleWithTexts,
} from '../../../helpers/office';
import {
  buildAssistantToolUseRecord,
  buildAsyncAgentLaunchResultRecord,
  buildTeamMetadataRecord,
  buildTurnDurationRecord,
  buildUserToolResultRecord,
  seedTeamConfig,
} from '../../../helpers/team';
import { buildHooksOffSeedConfig } from '../../../helpers/layout-seed';

async function expectLeadActivity(page: Page, text: string): Promise<void> {
  await expectOverlayVisibleWithTexts(page, ['LEAD', text]);
  await expectNoOverlayWithTexts(page, [INLINE_TEAMMATE_ROLE, text]);
}

async function expectTeammateActivity(page: Page, text: string): Promise<void> {
  await expectOverlayVisibleWithTexts(page, [INLINE_TEAMMATE_ROLE, text]);
  await expectNoOverlayWithTexts(page, ['LEAD', text]);
}

async function expectExternalAgentAdoption(page: Page): Promise<void> {
  await expectOverlayCount(page, 1, 10_000);
}

test.describe('Hooks OFF / matrix', () => {
  test.use({ seedConfig: buildHooksOffSeedConfig() });

  test('external basic spawn adopted via JSONL polling @area:matrix', async ({
    page,
    standalone,
  }) => {
    const { tmpHome, workspaceDir, mockLogFile, narrator } = standalone;
    const sessionId = 'hooks-off-external-basic-session';

    await spawnExternalClaudeScenario({
      tmpHome,
      workspaceDir,
      mockLogFile,
      sessionId,
      scenario: claudeScenario('external basic spawn hooks off')
        .at(6_000)
        .appendJsonl(
          buildAssistantToolUseRecord('toolu-a8-task', 'Task', {
            description: 'External research',
          }),
        )
        .at(8_500)
        .appendJsonl(buildUserToolResultRecord('toolu-a8-task'))
        .at(9_000)
        .appendJsonl(buildTurnDurationRecord())
        .holdOpenFor(12_000)
        .build(),
    });

    narrator.step('waiting for the 3s external scanner to adopt the session');
    await expectExternalAgentAdoption(page);
    narrator.check('external session adopted (count → 1)');
    narrator.step('expecting the scripted Task to surface a Subtask');
    await expectOverlayVisible(page, 'Subtask: External research', 10_000);
    narrator.check('"Subtask: External research" appears');
    await expectOverlayCount(page, 2, 10_000);
    narrator.check('subtask on screen alongside the lead (count → 2)');
    narrator.step('waiting for the tool_result + turn_duration to retire the subtask');
    await expectOverlayCount(page, 1, 12_000);
    narrator.check('subtask despawned — count back to 1');
  });

  test('external inline teammate adopted via JSONL polling @area:matrix', async ({
    page,
    standalone,
  }) => {
    const { tmpHome, workspaceDir, mockLogFile, narrator } = standalone;
    const teamName = uniqueTeamName('hooks-off-external-inline');
    const sessionId = 'hooks-off-external-inline-session';

    narrator.step('seeding the team config: a lead plus a web-researcher teammate');
    seedTeamConfig(tmpHome, teamName, ['lead', INLINE_TEAMMATE_ROLE]);
    await spawnExternalClaudeScenario({
      tmpHome,
      workspaceDir,
      mockLogFile,
      sessionId,
      scenario: withInlineTeammateSession(claudeScenario('external inline teammate hooks off'))
        .at(5_000)
        .appendJsonl(buildTeamMetadataRecord(teamName))
        .at(6_500)
        .appendJsonl(buildTeamMetadataRecord(teamName, INLINE_TEAMMATE_ROLE), {
          session: INLINE_TEAMMATE_ALIAS,
        })
        .at(8_500)
        .appendJsonl(
          buildAssistantToolUseRecord('toolu-a10-lead-bash', 'Bash', {
            command: 'npm test',
          }),
        )
        .at(9_500)
        .appendJsonl(
          buildAssistantToolUseRecord('toolu-a10-teammate-search', 'WebSearch', {
            query: 'pixel agents',
          }),
          { session: INLINE_TEAMMATE_ALIAS },
        )
        .holdOpenFor(14_000)
        .build(),
    });

    narrator.step('waiting for the external scanner to adopt the session');
    await expectExternalAgentAdoption(page);
    narrator.check('external lead adopted (count → 1)');
    await expectOverlayVisibleWithTexts(page, ['LEAD'], 10_000);
    narrator.check('the LEAD character renders');
    narrator.step('expecting the web-researcher teammate from JSONL team-metadata');
    await expectOverlayCount(page, 2, 12_000);
    await expectOverlayVisibleWithTexts(page, [INLINE_TEAMMATE_ROLE]);
    narrator.check('web-researcher teammate joined — 2 characters in the office');
    await expectLeadActivity(page, 'Running: npm test');
    narrator.check('"Running: npm test" on the lead only');
    await expectTeammateActivity(page, 'Searching the web');
    narrator.check('"Searching the web" on the teammate only');
  });

  test('external tmux teammate adopted via JSONL polling @area:matrix', async ({
    page,
    standalone,
  }) => {
    const { tmpHome, workspaceDir, mockLogFile, narrator } = standalone;
    const teamName = uniqueTeamName('hooks-off-external-tmux');
    const sessionId = 'hooks-off-external-tmux-session';

    narrator.step('seeding the team config: a lead plus a web-researcher teammate');
    seedTeamConfig(tmpHome, teamName, ['lead', INLINE_TEAMMATE_ROLE]);
    await spawnExternalClaudeScenario({
      tmpHome,
      workspaceDir,
      mockLogFile,
      sessionId,
      scenario: withTmuxTeammateSession(claudeScenario('external tmux teammate hooks off'))
        .at(5_000)
        .appendJsonl(buildTeamMetadataRecord(teamName))
        .at(6_500)
        .appendJsonl(
          buildAssistantToolUseRecord('toolu-a12-team-spawn', 'Agent', {
            description: 'Delegate research',
            run_in_background: true,
          }),
        )
        .at(7_000)
        .appendJsonl(buildAsyncAgentLaunchResultRecord('toolu-a12-team-spawn'))
        .at(8_000)
        .appendJsonl(buildTeamMetadataRecord(teamName, INLINE_TEAMMATE_ROLE), {
          session: TMUX_TEAMMATE_ALIAS,
        })
        .at(10_000)
        .appendJsonl(
          buildAssistantToolUseRecord('toolu-a12-lead-bash', 'Bash', {
            command: 'npm test',
          }),
        )
        .at(10_000)
        .appendJsonl(
          buildAssistantToolUseRecord('toolu-a12-teammate-search', 'WebSearch', {
            query: 'pixel agents',
          }),
          { session: TMUX_TEAMMATE_ALIAS },
        )
        .holdOpenFor(15_000)
        .build(),
    });

    narrator.step('waiting for the external scanner to adopt the session');
    await expectExternalAgentAdoption(page);
    narrator.check('external lead adopted (count → 1)');
    await expectOverlayVisibleWithTexts(page, ['LEAD'], 10_000);
    narrator.check('the LEAD character renders');
    narrator.step('waiting for the run_in_background Agent to surface a Subtask');
    await expectOverlayVisible(page, 'Subtask: Delegate research', 10_000);
    narrator.check('"Subtask: Delegate research" appears');
    await expectOverlayCount(page, 2, 12_000);
    await expectOverlayVisibleWithTexts(page, [INLINE_TEAMMATE_ROLE]);
    narrator.check('web-researcher teammate present — 2 characters in the office');
    await expectLeadActivity(page, 'Running: npm test');
    narrator.check('the lead owns "Running: npm test" only');
    await expectTeammateActivity(page, 'Searching the web');
    narrator.check('the separate tmux teammate owns "Searching the web" only');
  });
});
