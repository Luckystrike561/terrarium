import { expect, test } from '../../../fixtures/standalone';
import {
  enterEditMode,
  readAreas,
  readAreaTiles,
  type TestHooksWindow,
} from '../../../helpers/editor';
import { buildSeedConfig, buildSeedLayout, SEED_AREA_COLOR } from '../../../helpers/layout-seed';

/**
 * Standalone e2e coverage for Areas with no agent folders in play.
 *
 * The Areas EDITOR (paint tool, CRUD, folder mapping) is gated on
 * `areasAvailable` (App.tsx): a layout with areas already defined, or at least
 * one agent folder name seen this session (`agentFolderNames`, populated as
 * external sessions are adopted) — the folder-mapping half is covered in
 * areas-multiroot.spec.ts. What a session with no agents CAN verify:
 *   - seeded area data loads into OfficeState (areas + areaTiles round-trip), and
 *   - the seeded showAreas state drives the effective overlay gate, and
 *   - the Areas tool button is correctly hidden with no areas and no folders.
 * Area overlay/labels are canvas-only, so we assert state, not pixels (the same
 * tradeoff the pets fixture makes).
 */

test.describe('Areas (no agent folders)', () => {
  test.describe('seeded area data + show-areas state', () => {
    test.use({
      seedConfig: buildSeedConfig({ showAreas: true }),
      seedLayout: buildSeedLayout({
        cols: 10,
        rows: 10,
        areas: [{ label: 'Engineering', color: SEED_AREA_COLOR }],
        areaTiles: [
          { col: 2, row: 2, label: 'Engineering' },
          { col: 3, row: 2, label: 'Engineering' },
        ],
      }),
    });

    test('seeded areas + areaTiles load and showAreas is effective @area:areas', async ({
      page,
      standalone,
    }) => {
      const { narrator } = standalone;

      narrator.step('layout seeded with one "Engineering" area (two tiles) and showAreas on');

      // Area definitions + painted tiles survive the layout load.
      narrator.step('waiting for the seeded "Engineering" area to load into the office');
      await page.waitForFunction(
        () => ((window as TestHooksWindow).__pixelAgentsTestHooks?.getAreas?.() ?? []).length === 1,
        undefined,
        { timeout: 15_000 },
      );
      const areas = await readAreas(page);
      expect(areas).toContainEqual({ label: 'Engineering', color: SEED_AREA_COLOR });
      narrator.check(`the "Engineering" area round-tripped (color ${SEED_AREA_COLOR})`);

      const areaTiles = await readAreaTiles(page);
      expect(areaTiles).toContainEqual({ col: 2, row: 2, label: 'Engineering' });
      expect(areaTiles).toContainEqual({ col: 3, row: 2, label: 'Engineering' });
      narrator.check('both painted tiles present — (2,2) and (3,2)');

      // The seeded showAreas:true makes the overlay gate effective.
      const showAreas = await page.evaluate(
        () => (window as TestHooksWindow).__pixelAgentsTestHooks?.getShowAreas?.() ?? false,
      );
      expect(showAreas).toBe(true);
      narrator.check('seeded showAreas:true is effective — the overlay gate is on');
    });
  });

  test('the Areas tool button is hidden when no areas and no agent folders @area:areas', async ({
    page,
    standalone,
  }) => {
    const { narrator } = standalone;
    narrator.step('opening the layout editor with no layout areas and no agents spawned');
    await enterEditMode(page);
    // No seeded areas and no agent has ever reported a folder name → the
    // Areas button is gated off.
    await expect(page.locator('button[title*="Define folder-bound areas"]')).toHaveCount(0);
    narrator.check('no Areas tool button — the tool is gated on having something to map');
  });

  test.describe('seeded areas layout (positive gate)', () => {
    test.use({
      seedLayout: buildSeedLayout({
        areas: [{ label: 'Engineering', color: SEED_AREA_COLOR }],
        areaTiles: [{ col: 2, row: 2, label: 'Engineering' }],
      }),
    });

    test('the Areas tool button is visible with a seeded areas layout @area:areas', async ({
      page,
      standalone,
    }) => {
      const { narrator } = standalone;
      narrator.step('opening the seeded layout editor to check the Areas tool gate');
      await enterEditMode(page);
      // areasAvailable is (layout.areas?.length ?? 0) > 0 || agentFolderNames.length > 0,
      // so a seeded layout with an area makes the button visible with no agents at all.
      await expect(page.locator('button[title*="Define folder-bound areas"]')).toHaveCount(1);
      narrator.check('the Areas tool button is visible because the seeded layout has an area');
    });
  });
});
