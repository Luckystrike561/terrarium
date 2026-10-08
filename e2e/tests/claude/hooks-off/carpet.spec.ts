import fs from 'fs';
import path from 'path';

import { expect, test } from '../../../fixtures/standalone';
import { buildSeedLayout } from '../../../helpers/layout-seed';
import {
  readCarpetJunctionCase,
  readCarpetTiles,
  type TestHooksWindow,
} from '../../../helpers/office';

/**
 * e2e coverage for the carpet system (a tile layer between floor and furniture).
 *
 * Carpet tiles render only on the canvas (no DOM) and the marching-squares
 * autotile case is render-derived (not stored), so assertions read state
 * through window.__pixelAgentsTestHooks.getCarpetTiles() / getCarpetJunctionCase(),
 * the same canvas-state approach the pets fixture uses. The specs seed
 * carpetTiles directly into layout.json and assert the real load/autotile
 * logic reads them correctly.
 *
 * hooks-off lane: carpet has no hook dependency; this is the lighter fixture.
 */

test.describe('Carpet', () => {
  test('carpet sprites load and broadcast to the webview @area:carpet', async ({
    page,
    standalone,
  }) => {
    const { narrator } = standalone;

    // carpetTilesLoaded is sent once after webviewReady — proven via the message log.
    narrator.step('waiting for the carpet sprites to load and broadcast to the webview');
    await page.waitForFunction(() => {
      const log = (window as TestHooksWindow).__pixelAgentsTestHooks?.messageLog ?? [];
      return log.some((m) => m.type === 'carpetTilesLoaded');
    });
    narrator.check('carpetTilesLoaded message received — sprites are ready');
  });

  test.describe('seeded carpet tiles', () => {
    test.use({
      seedLayout: buildSeedLayout({
        cols: 12,
        rows: 12,
        carpetTiles: [
          { col: 4, row: 4, variant: 0 },
          { col: 9, row: 9, variant: 1 },
        ],
      }),
    });

    test('seeded carpetTiles load into the office @area:carpet', async ({ page, standalone }) => {
      const { narrator } = standalone;
      narrator.step('waiting for the two seeded carpet tiles to load');
      await page.waitForFunction(
        () =>
          ((window as TestHooksWindow).__pixelAgentsTestHooks?.getCarpetTiles?.() ?? []).length ===
          2,
        undefined,
        { timeout: 15_000 },
      );
      const tiles = await readCarpetTiles(page);
      expect(tiles).toContainEqual({ col: 4, row: 4, variant: 0 });
      expect(tiles).toContainEqual({ col: 9, row: 9, variant: 1 });
      narrator.check('both seeded carpet tiles round-tripped with their variants');
    });
  });

  // Autotiling: the junction (jx,jy) sees four neighboring tiles, NW=(c,r)=1,
  // NE=(c+1,r)=2, SW=(c,r+1)=8, SE=(c+1,r+1)=4. Each describe below seeds a
  // different neighbor subset and reads the computed bitmask back, proving the
  // case is derived from real neighbor state rather than a fixed value.
  const JUNCTION_COL = 3;
  const JUNCTION_ROW = 3;
  const JX = JUNCTION_COL + 1;
  const JY = JUNCTION_ROW + 1;

  test.describe('autotiling: a single neighbor', () => {
    test.use({
      seedLayout: buildSeedLayout({
        cols: 12,
        rows: 12,
        carpetTiles: [{ col: JUNCTION_COL, row: JUNCTION_ROW, variant: 0 }],
      }),
    });

    test('junction case reflects just the NW neighbor @area:carpet', async ({
      page,
      standalone,
    }) => {
      const { narrator } = standalone;
      narrator.step('waiting for the single seeded (NW) carpet tile to load');
      await page.waitForFunction(
        () =>
          ((window as TestHooksWindow).__pixelAgentsTestHooks?.getCarpetTiles?.() ?? []).length ===
          1,
        undefined,
        { timeout: 15_000 },
      );
      expect(await readCarpetJunctionCase(page, JX, JY, 0)).toBe(1);
      narrator.check('junction bitmask = 1 (NW only)');
    });
  });

  test.describe('autotiling: two neighbors', () => {
    test.use({
      seedLayout: buildSeedLayout({
        cols: 12,
        rows: 12,
        carpetTiles: [
          { col: JUNCTION_COL, row: JUNCTION_ROW, variant: 0 },
          { col: JUNCTION_COL + 1, row: JUNCTION_ROW, variant: 0 },
        ],
      }),
    });

    test('junction case reflects NW + NE neighbors @area:carpet', async ({ page, standalone }) => {
      const { narrator } = standalone;
      narrator.step('waiting for the two seeded (NW + NE) carpet tiles to load');
      await page.waitForFunction(
        () =>
          ((window as TestHooksWindow).__pixelAgentsTestHooks?.getCarpetTiles?.() ?? []).length ===
          2,
        undefined,
        { timeout: 15_000 },
      );
      expect(await readCarpetJunctionCase(page, JX, JY, 0)).toBe(1 | 2);
      narrator.check('junction bitmask = 3 (NW + NE)');
    });
  });

  test.describe('autotiling: fully surrounded', () => {
    test.use({
      seedLayout: buildSeedLayout({
        cols: 12,
        rows: 12,
        carpetTiles: [
          { col: JUNCTION_COL, row: JUNCTION_ROW, variant: 0 },
          { col: JUNCTION_COL + 1, row: JUNCTION_ROW, variant: 0 },
          { col: JUNCTION_COL, row: JUNCTION_ROW + 1, variant: 0 },
          { col: JUNCTION_COL + 1, row: JUNCTION_ROW + 1, variant: 0 },
        ],
      }),
    });

    test('junction case is fully set when all four corners are present @area:carpet', async ({
      page,
      standalone,
    }) => {
      const { narrator } = standalone;
      narrator.step('waiting for all four seeded corner tiles to load');
      await page.waitForFunction(
        () =>
          ((window as TestHooksWindow).__pixelAgentsTestHooks?.getCarpetTiles?.() ?? []).length ===
          4,
        undefined,
        { timeout: 15_000 },
      );
      expect(await readCarpetJunctionCase(page, JX, JY, 0)).toBe(15);
      narrator.check('junction bitmask = 15 — all four corners present');
    });
  });
});

const DEFAULT_LAYOUT_PATH = path.join(
  __dirname,
  '../../../../webview-ui/public/assets/default-layout-3.json',
);

/** A valid furniture type from the bundled default layout (for the surface-placement seed). */
function firstDefaultFurnitureType(): string {
  const parsed = JSON.parse(fs.readFileSync(DEFAULT_LAYOUT_PATH, 'utf8')) as {
    furniture?: Array<{ type: string }>;
  };
  const type = parsed.furniture?.[0]?.type;
  if (!type)
    throw new Error('No furniture in bundled default layout to seed surface-placement test');
  return type;
}

// Seed the surface-placement test with a carpet + furniture sharing tile (3,3).
test.describe('Carpet surface placement (seeded)', () => {
  test.use({
    seedLayout: (() => {
      const layout = buildSeedLayout({
        cols: 12,
        rows: 12,
        carpetTiles: [{ col: 3, row: 3, variant: 0 }],
      });
      layout.furniture = [{ uid: 'seed-desk', type: firstDefaultFurnitureType(), col: 3, row: 3 }];
      return layout;
    })(),
  });

  test('a seeded carpet coexists with furniture on the same tile @area:carpet', async ({
    page,
    standalone,
  }) => {
    const { narrator } = standalone;
    narrator.step('loading a seeded layout with carpet + furniture sharing tile (3,3)');
    // Carpet tile (3,3) loaded.
    await page.waitForFunction(
      () => {
        const tiles = (window as TestHooksWindow).__pixelAgentsTestHooks?.getCarpetTiles?.() ?? [];
        return tiles.some((t) => t.col === 3 && t.row === 3);
      },
      undefined,
      { timeout: 15_000 },
    );
    narrator.check('carpet tile present at (3,3) after load');
    // Furniture also present (not blocked by the carpet).
    const furnitureCount = await page.evaluate(
      () => (window as TestHooksWindow).__pixelAgentsTestHooks?.getFurnitureCount?.() ?? 0,
    );
    expect(furnitureCount).toBeGreaterThanOrEqual(1);
    narrator.check('furniture also survived — at least one item on the same tile');
  });
});
