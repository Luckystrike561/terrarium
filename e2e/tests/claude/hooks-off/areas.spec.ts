import { expect, test } from '../../../fixtures/standalone';
import { buildSeedConfig, buildSeedLayout, SEED_AREA_COLOR } from '../../../helpers/layout-seed';
import { readAreas, readAreaTiles, type TestHooksWindow } from '../../../helpers/office';

/**
 * Standalone e2e coverage for Areas with no agent folders in play.
 *
 * What is observable is the data path itself: a seeded layout's `areas` /
 * `areaTiles` round-trip into OfficeState, and the seeded Show Areas state
 * drives the effective overlay gate. Area overlay/labels are canvas-only, so
 * this asserts state, not pixels (the same tradeoff the pets fixture makes).
 * The folder-mapping half (seat preference) lives in areas-multiroot.spec.ts.
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
});
