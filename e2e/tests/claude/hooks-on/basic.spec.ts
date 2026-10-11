import { expect, test } from '../../../fixtures/standalone';
import {
  permissionRequest,
  preToolUseBash,
  sessionEndExit,
  sessionStartStartup,
  stop,
} from '../../../helpers/hooks';
import {
  claudeScenario,
  spawnExternalClaudeScenario,
  waitForClaudeHookSetup,
} from '../../../helpers/mock-claude';
import {
  expectContextGauge,
  expectOverlayCount,
  expectOverlayVisible,
  getContextGauges,
} from '../../../helpers/office';
import {
  buildAssistantToolUseRecord,
  buildAssistantUsageRecord,
  buildUserToolResultRecord,
} from '../../../helpers/team';

test.describe('Hooks ON / spawn paths', () => {
  test('external session spawns agent and Task subagent appears then despawns @area:spawn', async ({
    page,
    standalone,
  }) => {
    const { tmpHome, workspaceDir, mockLogFile, narrator } = standalone;
    const sessionId = 'external-basic-spawn-session';

    // Sub-character appears on Task tool_use and despawns on tool_result.
    // Task subagent lifecycle is JSONL-driven even in hooks-on mode
    // (transcriptParser routes Task/Agent tool events through JSONL
    // regardless of hookDelivered). Both records are appended by the mock's
    // own scheduler (mocking rule 1): the Subtask phase stays open from
    // t+5s to t+13s — a wide window for the polling assertions below, same
    // shape as the matrix "external basic spawn" scenario.
    narrator.step('arming the mock: spawn a Task subtask at t+5s, close it at t+13s');
    await waitForClaudeHookSetup(tmpHome);
    await spawnExternalClaudeScenario({
      tmpHome,
      workspaceDir,
      mockLogFile,
      sessionId,
      scenario: claudeScenario('external basic spawn')
        .at(200)
        .emitHook(
          sessionStartStartup(sessionId, '{{cwd}}', '{{transcriptPath}}') as Record<
            string,
            unknown
          >,
        )
        .at(5_000)
        .appendJsonl(
          buildAssistantToolUseRecord('toolu-subagent-spawn', 'Task', {
            description: 'spawned subtask',
          }),
        )
        .at(7_000)
        .appendJsonl(buildAssistantUsageRecord(90_000))
        .at(13_000)
        .appendJsonl(buildUserToolResultRecord('toolu-subagent-spawn'))
        .holdOpenFor(15_000)
        .build(),
    });

    await expectOverlayCount(page, 1);
    narrator.check('the lead character is on screen — one agent, no subtask yet');

    narrator.step('waiting for the t+5s Task tool_use to spawn a "Subtask" character');
    await expectOverlayCount(page, 2);
    await expectOverlayVisible(page, 'Subtask: spawned subtask');
    narrator.check('"Subtask: spawned subtask" overlay up — count 1 → 2');

    // The agent is on no team, so this also pins that the context gauge is not
    // a teams feature. 90k of an Opus 5 window is 9%; reading 45% would mean
    // the runtime fell back to assuming a 200k window.
    narrator.step("waiting for the t+7s usage record to fill the agent's context gauge");
    await expectContextGauge(page, 9);
    await expect(getContextGauges(page)).toHaveCount(1);
    narrator.check('the agent shows a 9% context gauge; the subtask has none');

    narrator.step('waiting for the t+13s tool_result — the subtask should despawn');
    await expectOverlayCount(page, 1);
    narrator.check('count back to 1 after the tool_result');
  });

  // Phase widths are deliberate. An early scenario-driven version (emissions at
  // 200ms/2s/3.2s/4.4s/6s) flaked reliably under full-suite load: the phases
  // were so narrow that a late-starting assertion missed its state entirely —
  // e.g. the "Idle" label only renders after the ~2s green-checkmark fade
  // (ToolOverlay's done-marker), so a sub-2s gap after Stop starves it of a
  // window. The 3.5–5s phases below give every assertion seconds of slack
  // against scheduler drift AND keep each state on screen long enough to be
  // seen in the review videos.
  test('external Claude session adopted via hook confirmation lifecycle @area:spawn', async ({
    page,
    standalone,
  }) => {
    const { tmpHome, workspaceDir, mockLogFile, narrator } = standalone;

    narrator.step('waiting for the hook install to be ready');
    await waitForClaudeHookSetup(tmpHome);
    const sessionId = 'external-hook-session';

    await spawnExternalClaudeScenario({
      tmpHome,
      workspaceDir,
      mockLogFile,
      sessionId,
      scenario: claudeScenario('external hook-driven session adoption')
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
        .at(8_500)
        .emitHook(stop(sessionId) as Record<string, unknown>)
        .at(13_500)
        .emitHook(sessionEndExit(sessionId) as Record<string, unknown>)
        .holdOpenFor(15_500)
        .build(),
    });

    // 1. PreToolUseBash (t+0.7s) confirms the session; agent appears with bash status.
    narrator.step('waiting for the t+0.7s PreToolUse(Bash) to confirm the session');
    await expectOverlayCount(page, 1);
    await expectOverlayVisible(page, 'Running: npm test');
    narrator.check('the external agent appeared — "Running: npm test"');

    // 2. PermissionRequest (t+4.5s) → "Needs approval"
    narrator.step('waiting for the t+4.5s PermissionRequest');
    await expectOverlayVisible(page, 'Needs approval');
    narrator.check('"Needs approval" bubble on the agent');

    // 3. Stop (t+8.5s) → finished turn shows ONLY the checkmark; the "Idle" label
    //    surfaces once the checkmark fades (~2s later). The 5s gap before
    //    SessionEnd is what guarantees "Idle" gets a visible window.
    narrator.step('waiting for the t+8.5s Stop — checkmark, then "Idle" after the fade');
    await expectOverlayVisible(page, 'Idle');
    narrator.check('turn finished — "Idle" after the green checkmark fades');

    // 4. SessionEnd(exit) (t+13.5s) → agent is removed.
    narrator.step('waiting for the t+13.5s SessionEnd to remove the agent');
    await expectOverlayCount(page, 0);
    narrator.check('the agent is gone — count back to 0');
  });
});
