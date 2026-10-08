import type { Page } from '@playwright/test';

import { test } from '../../../fixtures/standalone';
import { buildSeedLayout } from '../../../helpers/layout-seed';

/**
 * e2e coverage for the animated pet system.
 *
 * Pets render only on the canvas (no DOM nodes) and the heart bubble is pure
 * runtime state that is never persisted, so the live assertions read pet state
 * through `window.__pixelAgentsTestHooks.getPets()` / `.petClick()` — the same
 * state-driving approach `selectAgent` uses for characters (see
 * webview-ui/src/testHooks.ts and the comment on closeAgentFromOverlay in
 * e2e/helpers/office.ts). Pets spawn at a random walkable tile, so tests never
 * compute screen coordinates; they read pet ids/state back instead.
 *
 * A pet enters the office only via `layout.pets`, so these specs seed it
 * directly.
 *
 * These tests have no hook dependency; they live under hooks-off purely
 * because that is the lighter fixture path (no hook-server wait).
 */

interface PetSnapshot {
  id: string;
  name: string;
  petType: number;
  state: 'idle' | 'walk' | 'follow';
  x: number;
  y: number;
  bubbleType: 'heart' | null;
}

interface PetTestHooks {
  getPets?: () => PetSnapshot[];
  petClick?: (petId: string) => void;
  messageLog?: Array<{ type: string }>;
}

type PetWindow = Window & { __pixelAgentsTestHooks?: PetTestHooks };

/** Point-in-time snapshot of every live pet, read from the test hook. */
async function readPets(page: Page): Promise<PetSnapshot[]> {
  return page.evaluate(() => {
    const w = window as PetWindow;
    return w.__pixelAgentsTestHooks?.getPets?.() ?? [];
  });
}

/** Toggle a pet's heart bubble exactly as a canvas click would. */
async function petClick(page: Page, petId: string): Promise<void> {
  await page.evaluate((id) => {
    (window as PetWindow).__pixelAgentsTestHooks?.petClick?.(id);
  }, petId);
}

test.describe('Pets', () => {
  test('pet sprites load and broadcast to the webview @area:pets', async ({ page, standalone }) => {
    const { narrator } = standalone;

    // The petSpritesLoaded broadcast is sent once after webviewReady. Proven
    // delivered via the message log (records every received message type).
    narrator.step('waiting for the pet sprites to broadcast to the webview');
    await page.waitForFunction(() => {
      const w = window as PetWindow;
      const log = w.__pixelAgentsTestHooks?.messageLog ?? [];
      return log.some((m) => m.type === 'petSpritesLoaded');
    });
    narrator.check('petSpritesLoaded reached the client — pet assets delivered');
  });

  test.describe('a seeded pet', () => {
    test.use({
      seedLayout: buildSeedLayout({ pets: [{ id: 'seed-pet-claudio', petType: 0 }] }),
    });

    test('loads from the seeded layout and survives a page reload @area:pets', async ({
      page,
      standalone,
    }) => {
      const { narrator } = standalone;

      narrator.step('waiting for the seeded pet to load');
      await page.waitForFunction(() => {
        const pets = (window as PetWindow).__pixelAgentsTestHooks?.getPets?.() ?? [];
        return pets.length === 1 && pets[0]?.petType === 0;
      });
      narrator.check('one pet loaded from the seeded layout (getPets → 1, petType 0)');

      narrator.step('reloading the page: the pet must rehydrate from disk');
      await standalone.reloadPage();
      await page.waitForFunction(
        () => ((window as PetWindow).__pixelAgentsTestHooks?.getPets?.() ?? []).length === 1,
        undefined,
        { timeout: 15_000 },
      );
      narrator.check('fresh page shows the pet again, persisted across the reload');
    });

    test('clicking a pet shows a heart bubble that auto-dismisses and dismisses on re-click @area:pets', async ({
      page,
      standalone,
    }) => {
      const { narrator } = standalone;

      narrator.step('waiting for the seeded pet to load');
      await page.waitForFunction(
        () => ((window as PetWindow).__pixelAgentsTestHooks?.getPets?.() ?? []).length === 1,
      );
      const pets = await readPets(page);
      const petId = pets[0]!.id;
      narrator.check('pet loaded (getPets → 1)');

      // Click → heart bubble appears.
      narrator.step('clicking the pet — heart bubble should appear');
      await petClick(page, petId);
      await page.waitForFunction((id) => {
        const p = ((window as PetWindow).__pixelAgentsTestHooks?.getPets?.() ?? []).find(
          (x) => x.id === id,
        );
        return p?.bubbleType === 'heart';
      }, petId);
      narrator.check('heart bubble showing (bubbleType = heart)');

      // It auto-dismisses after WAITING_BUBBLE_DURATION_SEC (2s); the rAF loop
      // nulls bubbleType once the timer elapses. Timeout sits above 2s.
      narrator.step('waiting for the 2s auto-dismiss timer, no clicks');
      await page.waitForFunction(
        (id) => {
          const p = ((window as PetWindow).__pixelAgentsTestHooks?.getPets?.() ?? []).find(
            (x) => x.id === id,
          );
          return p?.bubbleType === null;
        },
        petId,
        { timeout: 6_000 },
      );
      narrator.check('bubble auto-dismissed on its own (bubbleType = null)');

      // The 1s assertion below completes before the 2s auto-dismiss timer, so
      // a cleared bubble can only be the click-dismiss path.
      narrator.step('clicking again — heart bubble re-appears');
      await petClick(page, petId);
      await page.waitForFunction((id) => {
        const p = ((window as PetWindow).__pixelAgentsTestHooks?.getPets?.() ?? []).find(
          (x) => x.id === id,
        );
        return p?.bubbleType === 'heart';
      }, petId);
      narrator.check('heart bubble showing again');

      narrator.step('clicking while showing — must dismiss fast, not wait out the 2s timer');
      await petClick(page, petId);
      await page.waitForFunction(
        (id) => {
          const p = ((window as PetWindow).__pixelAgentsTestHooks?.getPets?.() ?? []).find(
            (x) => x.id === id,
          );
          return p?.bubbleType === null;
        },
        petId,
        { timeout: 1_000 },
      );
      narrator.check('bubble cleared within 1s of the click — fast-dismiss path confirmed');
    });
  });
});
