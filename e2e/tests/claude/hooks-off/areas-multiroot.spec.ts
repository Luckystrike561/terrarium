import fs from 'node:fs';
import path from 'node:path';

import type { Page } from '@playwright/test';

import { expect, test } from '../../../fixtures/standalone';
import {
  addArea,
  enterEditMode,
  paintTile,
  readAgentSeats,
  readAreas,
  readAreaTiles,
  readSeats,
  saveLayout,
  selectArea,
  selectAreaTool,
  type TestHooksWindow,
} from '../../../helpers/editor';
import { buildSeedConfig } from '../../../helpers/layout-seed';
import {
  claudeScenario,
  mockClaudeInitRecord,
  spawnExternalClaudeScenario,
} from '../../../helpers/mock-claude';

/**
 * e2e coverage for the Areas editor + the folder→area→seat-preference loop —
 * the lane where the Areas button and the folder-mapping panel are reachable.
 * A folder is only known once SOME agent reports it (`agentFolderNames`,
 * App.tsx), so every
 * test here spawns an external mock-claude session rooted in a named
 * subfolder of the workspace first.
 *
 * A subfolder's cwd hashes to a DIFFERENT Claude project dir than the one the
 * server tracks for its own `workspaceDir` (server/src/providers/hook/claude/claude.ts),
 * so Watch All Sessions must be on for the periodic global scanner to adopt it
 * (server/src/fileWatcher.ts scanGlobalProjectDirs).
 *
 * The bundled default layout (which has seats) loads in every test here;
 * specs discover seat coordinates via the getSeats hook rather than
 * hardcoding layout positions. Seat-preference is asserted by AREA MEMBERSHIP
 * (the seated agent's area === the mapped label), which is invariant under
 * findFreeSeat's PC-bias randomness.
 */

const ALPHA = 'alpha';
const BETA = 'beta';

/** Enter the Areas editor and add + select an area in one go. */
async function startArea(page: Page, label: string): Promise<void> {
  await enterEditMode(page);
  await selectAreaTool(page);
  await addArea(page, label);
  await selectArea(page, label);
}

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
  test.use({ seedConfig: buildSeedConfig({ watchAllSessions: true }) });

  test('painting an area labels tiles in the layout @area:areas', async ({ page, standalone }) => {
    const { narrator } = standalone;
    narrator.step('spawning an external session rooted in the alpha folder');
    await spawnFolderAgent(page, standalone, ALPHA);

    narrator.step('opening the Areas editor and adding an "Engineering" area');
    await startArea(page, 'Engineering');

    // Paint over real (floor) seat tiles discovered from the layout — area
    // painting is gated to non-VOID/non-WALL tiles (useEditorActions.ts).
    const seats = await readSeats(page);
    const targets = seats.slice(0, 2);
    expect(targets.length).toBeGreaterThan(0);
    narrator.step('painting Engineering over two real seat tiles');
    for (const s of targets) {
      await paintTile(page, s.col, s.row);
    }

    await page.waitForFunction(
      (n) =>
        ((window as TestHooksWindow).__pixelAgentsTestHooks?.getAreaTiles?.() ?? []).length >= n,
      targets.length,
      { timeout: 10_000 },
    );
    const areaTiles = await readAreaTiles(page);
    for (const s of targets) {
      expect(areaTiles).toContainEqual({ col: s.col, row: s.row, label: 'Engineering' });
    }
    narrator.check('both painted tiles are labeled "Engineering"');
  });

  test('areas can be added and removed @area:areas', async ({ page, standalone }) => {
    const { narrator } = standalone;
    narrator.step('spawning an external session rooted in the alpha folder');
    await spawnFolderAgent(page, standalone, ALPHA);

    narrator.step('opening the layout editor → Areas tool');
    await enterEditMode(page);
    await selectAreaTool(page);

    narrator.step('adding a "Design" area');
    await addArea(page, 'Design');
    await page.waitForFunction(
      () =>
        ((window as TestHooksWindow).__pixelAgentsTestHooks?.getAreas?.() ?? []).some(
          (a) => a.label === 'Design',
        ),
      undefined,
      { timeout: 10_000 },
    );
    expect(await readAreas(page)).toContainEqual(expect.objectContaining({ label: 'Design' }));
    narrator.check('"Design" appears in the areas list');

    // Remove it via the card's × button.
    narrator.step('removing "Design" with its card\'s × button');
    await page.locator('button[title="Remove area"]').first().click();
    await page.waitForFunction(
      () =>
        !((window as TestHooksWindow).__pixelAgentsTestHooks?.getAreas?.() ?? []).some(
          (a) => a.label === 'Design',
        ),
      undefined,
      { timeout: 10_000 },
    );
    narrator.check('"Design" is gone from the areas list');
  });

  test('a folder can be mapped to an area and the mapping persists @area:areas', async ({
    page,
    standalone,
  }) => {
    const { narrator } = standalone;
    narrator.step('spawning an external session rooted in the alpha folder');
    await spawnFolderAgent(page, standalone, ALPHA);

    narrator.step('opening the layout editor → Areas tool');
    await enterEditMode(page);
    await selectAreaTool(page);
    narrator.step('adding an "Engineering" area');
    await addArea(page, 'Engineering');

    // Open the area card's "Add folder…" menu and map the alpha folder.
    narrator.step('opening Engineering\'s "Map a folder…" menu and picking alpha');
    await page.locator('button[title*="Map a folder"]').first().click();
    await page.getByRole('button', { name: ALPHA, exact: true }).click();

    await page.waitForFunction(
      (folder) => {
        const m = (window as TestHooksWindow).__pixelAgentsTestHooks?.getAreaMappings?.() ?? {};
        return (m[folder] ?? []).includes('Engineering');
      },
      ALPHA,
      { timeout: 10_000 },
    );
    narrator.check('the alpha folder now maps to "Engineering"');
  });

  /**
   * Seat-preference relies on a PERSISTED area; the mapping is seeded so
   * Stage 1 has labels, and the spawn that follows is the same live
   * OfficeState the editor painted into, so no reload is needed.
   */
  test.describe('seat preference (alpha → Engineering)', () => {
    test.use({
      seedConfig: buildSeedConfig({
        watchAllSessions: true,
        areaMappings: { [ALPHA]: ['Engineering'] },
      }),
    });

    /** Spawn a throwaway agent to open the Areas gate, then add
     *  "Engineering", paint it over some real (free) seats, and save. */
    async function paintAndSaveEngineering(
      page: Page,
      session: { tmpHome: string; workspaceDir: string; mockLogFile: string },
    ): Promise<void> {
      await spawnFolderAgent(page, session, 'gate');
      await startArea(page, 'Engineering');
      const seats = await readSeats(page);
      const targetSeats = seats.filter((s) => !s.assigned).slice(0, 3);
      expect(targetSeats.length).toBeGreaterThan(0);
      for (const seat of targetSeats) {
        await paintTile(page, seat.col, seat.row);
      }
      await page.waitForFunction(
        (n) =>
          ((window as TestHooksWindow).__pixelAgentsTestHooks?.getAreaTiles?.() ?? []).length >= n,
        targetSeats.length,
        { timeout: 10_000 },
      );
      await saveLayout(page);
    }

    test('an agent for the MAPPED folder takes a seat inside its area @area:areas', async ({
      page,
      standalone,
    }) => {
      const { narrator } = standalone;
      narrator.step('spawning a throwaway agent to open the Areas gate, then painting Engineering');
      await paintAndSaveEngineering(page, standalone);

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
      expect(alphaAgent?.areaLabel).toBe('Engineering');
      narrator.check(
        'the alpha agent\'s seat is labeled "Engineering" — steered into its mapped area',
      );
    });

    test('an agent for an UNMAPPED folder is not forced into the area @area:areas', async ({
      page,
      standalone,
    }) => {
      const { narrator } = standalone;
      narrator.step('spawning a throwaway agent to open the Areas gate, then painting Engineering');
      await paintAndSaveEngineering(page, standalone);

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
      expect(betaAgent?.areaLabel).not.toBe('Engineering');
      narrator.check(
        'the beta agent\'s seat is NOT "Engineering" — an unmapped folder is not forced in',
      );
    });
  });
});
