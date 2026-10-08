import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '../../fixtures/standalone';
import { preToolUseBash, sessionStartStartup } from '../../helpers/hooks';
import {
  claudeScenario,
  spawnExternalClaudeScenario,
  waitForClaudeHookSetup,
} from '../../helpers/mock-claude';
import { expectNoOverlay, expectOverlayCount, expectOverlayVisible } from '../../helpers/office';
import { launchStandalone } from '../../helpers/standalone';
import { setSettings } from '../../helpers/webview';

function hookDrivenScenario(name: string, command: string) {
  return claudeScenario(name)
    .at(50)
    .emitHook(
      sessionStartStartup('{{sessionId}}', '{{cwd}}', '{{transcriptPath}}') as Record<
        string,
        unknown
      >,
    )
    .at(100)
    .emitHook(preToolUseBash('{{sessionId}}', command) as Record<string, unknown>)
    .exitAt(500)
    .build();
}

test.describe('Standalone / multi-server hooks', () => {
  test('two standalone servers sharing one HOME stay hook-driven without cross-contamination @area:standalone', async ({
    page,
    standalone,
  }) => {
    await setSettings(page, {
      alwaysShowLabels: true,
      hooksEnabled: true,
      watchAllSessions: false,
      debugView: false,
    });

    const page2 = await page.context().newPage();
    const second = await launchStandalone(page2, { homeDir: standalone.tmpHome });
    try {
      await setSettings(page2, {
        alwaysShowLabels: true,
        hooksEnabled: true,
        watchAllSessions: false,
        debugView: false,
      });
      await standalone.drainMessages();
      await second.drainMessages();
      await waitForClaudeHookSetup(standalone.tmpHome);

      const registryDir = path.join(standalone.tmpHome, '.pixel-agents', 'servers');
      await expect
        .poll(
          () => {
            try {
              return fs.readdirSync(registryDir).filter((file) => file.endsWith('.json')).length;
            } catch {
              return 0;
            }
          },
          { message: 'Expected two standalone registry entries' },
        )
        .toBe(2);

      const firstSessionId = 'multi-server-first-owned';
      const firstCommand = 'npm run first-owned';
      await spawnExternalClaudeScenario({
        tmpHome: standalone.tmpHome,
        workspaceDir: standalone.workspaceDir,
        mockLogFile: standalone.mockLogFile,
        sessionId: firstSessionId,
        scenario: hookDrivenScenario('multi-server first-owned session', firstCommand),
      });

      await expectOverlayVisible(page, `Running: ${firstCommand}`);
      await page2.waitForTimeout(500);
      await expectNoOverlay(page2, `Running: ${firstCommand}`);

      const secondSessionId = 'multi-server-second-owned';
      const secondCommand = 'npm run second-owned';
      await spawnExternalClaudeScenario({
        tmpHome: standalone.tmpHome,
        workspaceDir: second.workspaceDir,
        mockLogFile: standalone.mockLogFile,
        sessionId: secondSessionId,
        scenario: hookDrivenScenario('multi-server second-owned session', secondCommand),
      });

      await expectOverlayVisible(page2, `Running: ${secondCommand}`);
      await page.waitForTimeout(500);
      await expectNoOverlay(page, `Running: ${secondCommand}`);

      await expectOverlayCount(page, 1);
      await expectOverlayCount(page2, 1);
    } finally {
      await second.cleanup();
      await page2.close();
    }
  });
});
