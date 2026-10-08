import fs from 'node:fs';
import path from 'node:path';

import type { Page } from '@playwright/test';

import { expect, test } from '../../../fixtures/standalone';
import { buildSeedConfig, buildSeedLayout, SEED_AREA_COLOR } from '../../../helpers/layout-seed';
import {
  claudeScenario,
  mockClaudeInitRecord,
  spawnExternalClaudeScenario,
} from '../../../helpers/mock-claude';
import { readAgentSeats, type TestHooksWindow } from '../../../helpers/office';

/**
 * e2e coverage for the folder→area→seat-preference loop.
 *
 * What is observable is the runtime preference itself (OfficeState.findFreeSeat),
 * which reads `areaMappings` from config.json and `areas`/`areaTiles` from the
 * layout. Both are seeded directly.
 *
 * A subfolder's cwd hashes to a DIFFERENT Claude project dir than the one the
 * server tracks for its own `workspaceDir` (server/src/providers/hook/claude/claude.ts),
 * so Watch All Sessions must be on for the periodic global scanner to adopt it
 * (server/src/fileWatcher.ts scanGlobalProjectDirs).
 *
 * Seat-preference is asserted by AREA MEMBERSHIP (the seated agent's area ===
 * the mapped label), which is invariant under findFreeSeat's PC-bias
 * randomness.
 */

const ALPHA = 'alpha';
const BETA = 'beta';
const ENGINEERING = 'Engineering';

/**
 * Spawn an external mock session whose cwd is `<workspaceDir>/<folder>`, so
 * its Claude project-dir basename — and therefore its reported folderName
 * (server/src/fileWatcher.ts folderNameFromProjectDir) — is exactly `folder`.
 * Waits until the office has adopted it (Watch All Sessions must already be
 * on, via `seedConfig`).
 *
 * The init record is padded past `GLOBAL_SCAN_ACTIVE_MIN_SIZE`
 * (server/src/constants.ts, 3KB) — the floor that gates a subfolder's
 * adoption by the global scanner. A real Claude session's transcript clears
 * that floor within its first turn; this one needs an explicit nudge.
 */
const SCAN_PADDING = 'x'.repeat(3_200);

async function spawnFolderAgent(
  page: Page,
  session: { tmpHome: string; workspaceDir: string; mockLogFile: string },
  folder: string,
): Promise<void> {
  const cwd = path.join(session.workspaceDir, folder);
  fs.mkdirSync(cwd, { recursive: true });
  await spawnExternalClaudeScenario({
    tmpHome: session.tmpHome,
    workspaceDir: cwd,
    mockLogFile: session.mockLogFile,
    sessionId: `folder-${folder}-${Date.now().toString()}`,
    scenario: claudeScenario(`external session for folder ${folder}`)
      .withoutAutoInit()
      .at(0)
      .appendJsonl(mockClaudeInitRecord(SCAN_PADDING))
      .holdOpenFor(10_000)
      .build(),
  });
  await page.waitForFunction(
    (name) =>
      ((window as TestHooksWindow).__pixelAgentsTestHooks?.getAgentSeats?.() ?? []).some(
        (a) => a.folderName === name,
      ),
    folder,
    { timeout: 20_000 },
  );
}

test.describe('Areas (folder-mapped agents)', () => {
  /**
   * Three chairs seed three real seats (layoutToSeats, derived from chair
   * furniture: webview-ui/src/office/layout/layoutSerializer.ts). Two fall
   * inside the seeded "Engineering" area. The third is left unzoned so an
   * unmapped folder has somewhere to land that proves it was NOT steered in.
   */
  test.use({
    seedConfig: buildSeedConfig({
      watchAllSessions: true,
      areaMappings: { [ALPHA]: [ENGINEERING] },
    }),
    seedLayout: buildSeedLayout({
      cols: 12,
      rows: 12,
      chairs: [
        { col: 2, row: 2 },
        { col: 4, row: 4 },
        { col: 6, row: 6 },
      ],
      areas: [{ label: ENGINEERING, color: SEED_AREA_COLOR }],
      areaTiles: [
        { col: 2, row: 2, label: ENGINEERING },
        { col: 4, row: 4, label: ENGINEERING },
      ],
    }),
  });

  test('an agent for the MAPPED folder takes a seat inside its area @area:areas', async ({
    page,
    standalone,
  }) => {
    const { narrator } = standalone;
    narrator.step('spawning an external session rooted in the alpha (mapped) folder');
    await spawnFolderAgent(page, standalone, ALPHA);

    narrator.step('expecting the alpha agent to take a seat inside Engineering');
    await page.waitForFunction(
      (folder) =>
        ((window as TestHooksWindow).__pixelAgentsTestHooks?.getAgentSeats?.() ?? []).some(
          (a) => a.folderName === folder && a.seatId !== null,
        ),
      ALPHA,
      { timeout: 20_000 },
    );
    const agentSeats = await readAgentSeats(page);
    const alphaAgent = agentSeats.find((a) => a.folderName === ALPHA);
    expect(alphaAgent?.areaLabel).toBe(ENGINEERING);
    narrator.check(
      'the alpha agent\'s seat is labeled "Engineering" — steered into its mapped area',
    );
  });

  test('an agent for an UNMAPPED folder is not forced into the area @area:areas', async ({
    page,
    standalone,
  }) => {
    const { narrator } = standalone;
    // beta is NOT in areaMappings → Stage 1 is skipped → it lands on an unzoned
    // seat, never inside Engineering.
    narrator.step('spawning an external session rooted in the beta (unmapped) folder');
    await spawnFolderAgent(page, standalone, BETA);

    narrator.step('expecting the unmapped beta agent to land on an unzoned seat');
    await page.waitForFunction(
      (folder) =>
        ((window as TestHooksWindow).__pixelAgentsTestHooks?.getAgentSeats?.() ?? []).some(
          (a) => a.folderName === folder && a.seatId !== null,
        ),
      BETA,
      { timeout: 20_000 },
    );
    const agentSeats = await readAgentSeats(page);
    const betaAgent = agentSeats.find((a) => a.folderName === BETA);
    expect(betaAgent?.areaLabel).not.toBe(ENGINEERING);
    narrator.check(
      'the beta agent\'s seat is NOT "Engineering" — an unmapped folder is not forced in',
    );
  });
});
