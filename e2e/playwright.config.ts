import { defineConfig } from '@playwright/test';
import path from 'path';

import { namespaceE2EPath } from './run-config';

process.env['ALLURE_LABEL_epic'] ??= 'e2e';

const artifactsDir = namespaceE2EPath(path.join(__dirname, '../test-results/e2e'));
const allureResultsDir = namespaceE2EPath(path.join(__dirname, '../allure-results/e2e'));
const htmlReportDir = namespaceE2EPath(path.join(__dirname, '../playwright-report/e2e'));

export default defineConfig({
  testDir: path.join(__dirname, 'tests'),
  timeout: 120_000,
  globalSetup: path.join(__dirname, 'global-setup.ts'),
  reporter: [
    ['list'],
    [
      'html',
      {
        // Must be outside outputDir to avoid Playwright clearing artifacts
        outputFolder: htmlReportDir,
        open: 'never',
      },
    ],
    [
      'allure-playwright',
      {
        resultsDir: allureResultsDir,
      },
    ],
  ],
  outputDir: artifactsDir,
  use: {
    video:
      process.env['PIXEL_AGENTS_E2E_ATTACH_VIDEOS_ON_SUCCESS'] === '1' ? 'on' : 'retain-on-failure',
  },
  // Default to one worker locally; CI can override this with --workers.
  workers: 1,
  // Shard distribution at test level (not file level). Without this, Playwright
  // shards by file: hooks-on/lifecycle.spec.ts alone has 22 tests (47% of the
  // suite), so one shard does all the work while another does 2 tests. With
  // fullyParallel, tests are distributed individually → balanced shards.
  // workers=1 still keeps tests sequential within a shard; only the shard
  // assignment strategy changes.
  fullyParallel: true,
  // Retry once for tests that are sensitive to ordering / load (timing-driven
  // assertions about hook + file-watcher races). Tests that pass in isolation
  // but flake under serial load see this; the retry hides true flakes while
  // still surfacing genuinely broken tests.
  retries: 1,
});
