import fs from 'node:fs';
import path from 'node:path';

import type { Page, TestInfo } from '@playwright/test';
import { expect, test as base } from '@playwright/test';

import { applyAllureLabels } from '../helpers/allure-labels';
import type { TestHooksWindow } from '../helpers/editor';
import { killTrackedExternalProcesses } from '../helpers/mock-claude';
import { launchStandalone, type StandaloneSession } from '../helpers/standalone';
import {
  clearNarrationContext,
  getExternalNarrationLogPath,
  getTestNarrationLogPath,
  setNarrationContext,
  type TestNarrator,
} from '../helpers/test-narration';

export interface StandaloneContext extends StandaloneSession {
  page: Page;
  /** Writes the `[test]` step/check log attached to failing tests. Cosmetic
   *  only: never gate an action or assertion on it. */
  narrator: TestNarrator;
}

async function attachTextFileIfExists(
  testInfo: TestInfo,
  name: string,
  filePath: string,
  contentType: string,
): Promise<void> {
  try {
    if (!fs.existsSync(filePath)) return;
    await testInfo.attach(name, {
      body: fs.readFileSync(filePath, 'utf8'),
      contentType,
    });
  } catch {
    // Attachment failures are non-fatal in teardown.
  }
}

async function attachText(
  testInfo: TestInfo,
  name: string,
  body: string,
  contentType: string,
): Promise<void> {
  try {
    if (body.length === 0) return;
    await testInfo.attach(name, {
      body,
      contentType,
    });
  } catch {
    // Attachment failures are non-fatal in teardown.
  }
}

async function attachFailureArtifacts(
  testInfo: TestInfo,
  page: Page,
  standalone: StandaloneSession,
): Promise<void> {
  const { tmpHome, mockLogFile } = standalone;
  const mockDir = path.join(tmpHome, '.claude-mock');
  await attachText(testInfo, 'standalone-host-log', standalone.getHostLogs(), 'text/plain');
  await attachTextFileIfExists(testInfo, 'mock-claude-invocations', mockLogFile, 'text/plain');
  await attachTextFileIfExists(
    testInfo,
    'mock-claude-actions',
    path.join(mockDir, 'actions.log'),
    'text/plain',
  );
  await attachTextFileIfExists(
    testInfo,
    'test-narration',
    getTestNarrationLogPath(tmpHome),
    'text/plain',
  );
  await attachTextFileIfExists(
    testInfo,
    'external-sessions',
    getExternalNarrationLogPath(tmpHome),
    'text/plain',
  );
  await attachTextFileIfExists(
    testInfo,
    'server-json',
    path.join(tmpHome, '.pixel-agents', 'server.json'),
    'application/json',
  );
  await attachTextFileIfExists(
    testInfo,
    'pixel-agents-debug-log',
    path.join(tmpHome, '.pixel-agents', 'debug.log'),
    'text/plain',
  );
  try {
    const messageLog = await page.evaluate(
      () => (window as TestHooksWindow).__pixelAgentsTestHooks?.messageLog ?? null,
    );
    if (messageLog) {
      await attachText(
        testInfo,
        'webview-message-log',
        JSON.stringify(messageLog, null, 2),
        'application/json',
      );
    }
  } catch {
    // Page already closed — non-fatal in teardown.
  }
  try {
    const screenshotPath = testInfo.outputPath('final-screenshot.png');
    await page.screenshot({ path: screenshotPath });
    await testInfo.attach('final-screenshot', {
      path: screenshotPath,
      contentType: 'image/png',
    });
  } catch {
    // Screenshot failures are non-fatal in teardown.
  }
}

export const test = base.extend<{
  standalone: StandaloneContext;
  _allureLabels: void;
  /** Seed a granted Claude hooksConsent entry in the isolated HOME (default). The
   *  consent specs opt out via `test.use({ seedHooksConsent: false })` so the
   *  first-run Intro shows — they are the only ones that want it. */
  seedHooksConsent: boolean;
  /** Pre-seed `~/.pixel-agents/config.json` (replaces the baseline). */
  seedConfig: unknown;
  /** Pre-seed `~/.pixel-agents/layout.json` (must carry a high layoutRevision). */
  seedLayout: unknown;
  /** Pre-seed `~/.claude/settings.json` (e.g. an existing hook install). */
  seedClaudeSettings: unknown;
}>({
  seedHooksConsent: [true, { option: true }],
  seedConfig: [undefined, { option: true }],
  seedLayout: [undefined, { option: true }],
  seedClaudeSettings: [undefined, { option: true }],
  // Auto-fixture: tag every test with Allure epic + feature derived from its
  // @area: annotation and enclosing describe path. Runs before standalone.
  _allureLabels: [
    async ({}, use, testInfo) => {
      await applyAllureLabels(testInfo);
      await use();
    },
    { auto: true },
  ],
  standalone: async (
    { page, seedHooksConsent, seedConfig, seedLayout, seedClaudeSettings },
    use,
    testInfo,
  ) => {
    const standalone = await launchStandalone(page, {
      seedHooksConsent,
      seedConfig,
      seedLayout,
      seedClaudeSettings,
    });

    try {
      const narrator = setNarrationContext(standalone.tmpHome);
      await use({ ...standalone, page, narrator });
    } finally {
      if (testInfo.status !== testInfo.expectedStatus) {
        await attachFailureArtifacts(testInfo, page, standalone);
      }
      clearNarrationContext();
      // Kill leaked mock-claude processes BEFORE the HOME they write into is
      // deleted, so they do not accumulate across the suite.
      await killTrackedExternalProcesses();
      await standalone.cleanup();
    }
  },
});

export { expect };
