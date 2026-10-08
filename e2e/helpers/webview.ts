import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

const WEBVIEW_TIMEOUT_MS = 30_000;

export interface WebviewSettings {
  watchAllSessions?: boolean;
  hooksEnabled?: boolean;
  alwaysShowLabels?: boolean;
  debugView?: boolean;
}

async function setCheckbox(modal: Locator, label: string, checked: boolean): Promise<void> {
  const button = modal.locator('button', { hasText: label });
  await expect(button).toBeVisible({ timeout: WEBVIEW_TIMEOUT_MS });

  const indicator = button.locator('span').last();
  const isChecked = ((await indicator.textContent()) ?? '').trim().toLowerCase() === 'x';
  if (isChecked !== checked) {
    await button.click();
  }
}

export async function openSettingsModal(page: Page): Promise<Locator> {
  const settingsButton = page.locator('button', { hasText: 'Settings' });
  await expect(settingsButton).toBeVisible({ timeout: WEBVIEW_TIMEOUT_MS });
  await settingsButton.click();

  const settingsModal = page
    .locator('div.fixed')
    .filter({ has: page.getByText('Settings', { exact: true }) });
  await expect(settingsModal).toBeVisible({ timeout: WEBVIEW_TIMEOUT_MS });
  return settingsModal;
}

async function closeSettingsModal(settingsModal: Locator): Promise<void> {
  const closeButton = settingsModal.getByRole('button', { name: 'x', exact: true });
  await expect(closeButton).toBeVisible({ timeout: WEBVIEW_TIMEOUT_MS });
  await closeButton.click();
  await expect(settingsModal).toBeHidden({ timeout: WEBVIEW_TIMEOUT_MS });
}

/**
 * Read the checked state of a Settings modal toggle without changing it.
 * Used by the settings-persistence test to assert state survives a page reload.
 */
export async function getSettingChecked(page: Page, label: string): Promise<boolean> {
  const settingsModal = await openSettingsModal(page);
  const button = settingsModal.locator('button', { hasText: label });
  await expect(button).toBeVisible({ timeout: WEBVIEW_TIMEOUT_MS });
  const indicator = button.locator('span').last();
  const checked = ((await indicator.textContent()) ?? '').trim().toLowerCase() === 'x';
  await closeSettingsModal(settingsModal);
  return checked;
}

export async function setSettings(page: Page, settings: WebviewSettings): Promise<void> {
  const settingsModal = await openSettingsModal(page);

  if (settings.watchAllSessions !== undefined) {
    await setCheckbox(settingsModal, 'Watch All Sessions', settings.watchAllSessions);
  }
  if (settings.hooksEnabled !== undefined) {
    await setCheckbox(settingsModal, 'Instant Detection (Hooks)', settings.hooksEnabled);
  }
  if (settings.alwaysShowLabels !== undefined) {
    await setCheckbox(settingsModal, 'Always Show Labels', settings.alwaysShowLabels);
  }
  if (settings.debugView !== undefined) {
    await setCheckbox(settingsModal, 'Debug View', settings.debugView);
  }

  await closeSettingsModal(settingsModal);

  // Allow the server to process settings updates before the test continues.
  await page.waitForTimeout(500);
}

/**
 * Enable Watch All Sessions so hooks-only external sessions are adopted.
 * (Always Show Labels and hooks are already on via the fixture-seeded
 * config.json and the product default.)
 */
export async function configureHookServerTestSettings(page: Page): Promise<void> {
  await setSettings(page, {
    watchAllSessions: true,
  });
}
