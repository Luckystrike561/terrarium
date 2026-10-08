import type { Locator, Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

import { expect, test } from '../../../fixtures/standalone';
import { dismissFirstRunTooltips } from '../../../helpers/editor';

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
 * Placement itself goes through the REAL UI path: clicking the Pets-tab
 * carousel button → onPetToggle → handlePetToggle → applyEdit. Only the
 * canvas-only interactions (hit-test geometry of getPetAt) are bypassed.
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

const PETS_CAROUSEL = '[data-testid="pets-carousel"]';

/** Enter edit mode and open the Pets tab; returns the carousel locator. */
async function openPetsTab(page: Page): Promise<Locator> {
  await dismissFirstRunTooltips(page);
  await page.locator('button[title="Edit office layout"]').click();
  await page.locator('button[title="Place pets"]').click();
  const carousel = page.locator(PETS_CAROUSEL);
  await expect(carousel).toBeVisible({ timeout: 15_000 });
  return carousel;
}

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
  test('pet sprites load, broadcast, and expose manifest names in the editor @area:pets', async ({
    page,
    standalone,
  }) => {
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

    // The two bundled pets (claudio, gitcat) render as carousel thumbnails in
    // alphabetical order, each titled with its manifest `name`. Asserting the
    // count + both names covers "loaded" and "manifest names" together.
    narrator.step('opening the layout editor → Pets tab');
    const carousel = await openPetsTab(page);
    await expect(carousel.locator('button')).toHaveCount(2);
    narrator.check('carousel has exactly 2 pet thumbnails');
    await expect(carousel.locator('button[title="Claudio"]')).toBeVisible();
    await expect(carousel.locator('button[title="Gitcat"]')).toBeVisible();
    narrator.check('thumbnails titled "Claudio" and "Gitcat" — manifest names surfaced');
  });

  test('placing a pet toggles it on/off and persists across a page reload @area:pets', async ({
    page,
    standalone,
  }) => {
    const { tmpHome, narrator } = standalone;

    narrator.step('opening the layout editor → Pets tab');
    const carousel = await openPetsTab(page);
    const claudio = carousel.locator('button[title="Claudio"]');
    const gitcat = carousel.locator('button[title="Gitcat"]');

    // Toggle ON: clicking the carousel button drives the real placement path.
    narrator.step('clicking Claudio — placing the pet');
    await claudio.click();
    await page.waitForFunction(() => {
      const pets = (window as PetWindow).__pixelAgentsTestHooks?.getPets?.() ?? [];
      return pets.length === 1 && pets[0]?.petType === 0;
    });
    narrator.check('one pet on the canvas (getPets → 1, petType claudio)');

    // Toggle OFF: clicking the same (now-active) button removes it.
    narrator.step('clicking Claudio again — removing the pet');
    await claudio.click();
    await page.waitForFunction(
      () => ((window as PetWindow).__pixelAgentsTestHooks?.getPets?.() ?? []).length === 0,
    );
    narrator.check('canvas empty again (getPets → 0)');

    // Place both pets, then persist via the EditActionBar Save button.
    narrator.step('placing both pets — Claudio, then Gitcat');
    await claudio.click();
    await page.waitForFunction(
      () => ((window as PetWindow).__pixelAgentsTestHooks?.getPets?.() ?? []).length === 1,
    );
    await gitcat.click();
    await page.waitForFunction(
      () => ((window as PetWindow).__pixelAgentsTestHooks?.getPets?.() ?? []).length === 2,
    );
    narrator.check('two pets on the canvas (getPets → 2)');

    narrator.step('clicking Save — persisting the layout to disk');
    const saveBtn = page.locator('button', { hasText: 'Save' });
    await expect(saveBtn).toBeVisible({ timeout: 5_000 });
    await saveBtn.click();

    // The save round-trips through layoutPersistence to ~/.pixel-agents/layout.json
    // (under the fixture's isolated HOME). Pets are opaque pass-through server-side.
    const layoutPath = path.join(tmpHome, '.pixel-agents', 'layout.json');
    await expect
      .poll(
        () => {
          if (!fs.existsSync(layoutPath)) return -1;
          try {
            const parsed = JSON.parse(fs.readFileSync(layoutPath, 'utf8')) as {
              pets?: unknown[];
            };
            return Array.isArray(parsed.pets) ? parsed.pets.length : -1;
          } catch {
            return -1;
          }
        },
        { timeout: 10_000 },
      )
      .toBe(2);
    narrator.check('~/.pixel-agents/layout.json contains 2 pets');

    // Reload the page and confirm the pets rehydrate from disk.
    narrator.step('reloading the page — pets must rehydrate from disk');
    await standalone.reloadPage();
    await page.waitForFunction(
      () => ((window as PetWindow).__pixelAgentsTestHooks?.getPets?.() ?? []).length === 2,
      undefined,
      { timeout: 15_000 },
    );
    narrator.check('fresh page shows 2 pets again — persisted across the reload');
  });

  test('clicking a pet shows a heart bubble that auto-dismisses and dismisses on re-click @area:pets', async ({
    page,
    standalone,
  }) => {
    const { narrator } = standalone;

    // Place one pet through the editor, then read its id back (spawn tile is
    // random, so the id is the only stable handle).
    narrator.step('placing one pet (Claudio) via the editor');
    const carousel = await openPetsTab(page);
    await carousel.locator('button[title="Claudio"]').click();
    await page.waitForFunction(
      () => ((window as PetWindow).__pixelAgentsTestHooks?.getPets?.() ?? []).length === 1,
    );
    const pets = await readPets(page);
    const petId = pets[0]!.id;
    narrator.check('pet placed (getPets → 1)');

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
