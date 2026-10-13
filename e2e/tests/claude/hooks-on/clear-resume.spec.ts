import { expect, test } from '../../../fixtures/standalone';
import {
  preToolUseBash,
  sessionEndClear,
  sessionEndResume,
  sessionStartClear,
  sessionStartResume,
  sessionStartStartup,
} from '../../../helpers/hooks';
import {
  claudeScenario,
  mockClaudeInitRecord,
  spawnExternalClaudeScenario,
  waitForClaudeHookSetup,
} from '../../../helpers/mock-claude';
import {
  expectAgentOverlayGone,
  expectNoOverlay,
  expectOverlayCount,
  expectOverlayVisible,
  expectOverlayVisibleForAgent,
  expectSingleAgentOverlay,
  getOverlayByAgentId,
  readAgentOverlayIds,
} from '../../../helpers/office';

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
});
