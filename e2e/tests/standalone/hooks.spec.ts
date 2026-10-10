import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '../../fixtures/standalone';
import {
  ourHookEvents,
  sendHookEvent,
  sessionEndExit,
  sessionStartStartup,
} from '../../helpers/hooks';
import { advanceIntroToConsentStep, finishIntro } from '../../helpers/intro';
import { expectOverlayCount, expectOverlayVisible } from '../../helpers/office';
import type { RecordedServerMessage } from '../../helpers/standalone';

test.describe('Standalone / hooks', () => {
  test('propagates hook-driven lifecycle into the browser UI @area:standalone', async ({
    page,
    standalone,
  }) => {
    await standalone.drainMessages();

    const sessionId = 'standalone-hooks-test-session';
    const filePath = path.join(standalone.workspaceDir, 'demo.ts');

    await sendHookEvent(
      standalone.hookServerConfig,
      sessionStartStartup(sessionId, standalone.workspaceDir),
    );
    // Settle wait before the negative assertion: SessionStart only stages a
    // pending session, so no overlay should appear. Without the wait,
    // toHaveCount(0) passes instantly just because the overlay has not been
    // created yet, which would not actually prove SessionStart stays invisible.
    // See e2e/helpers/office.ts wait-strategy conventions (negative assertion).
    await page.waitForTimeout(500);
    await expectOverlayCount(page, 0);

    await sendHookEvent(standalone.hookServerConfig, {
      session_id: sessionId,
      hook_event_name: 'PreToolUse',
      tool_name: 'Read',
      tool_input: { file_path: filePath },
    });

    await expectOverlayCount(page, 1);
    await expectOverlayVisible(page, 'Reading demo.ts');
    const preToolMessages = await standalone.drainMessages();
    const toolStart = preToolMessages.find(
      (message): message is RecordedServerMessage & { type: 'agentToolStart' } =>
        message.type === 'agentToolStart',
    );
    expect(preToolMessages.some((message) => message.type === 'agentCreated')).toBe(true);
    expect(toolStart).toBeTruthy();
    expect(
      preToolMessages.some(
        (message) => message.type === 'agentStatus' && message.status === 'active',
      ),
    ).toBe(true);

    await sendHookEvent(standalone.hookServerConfig, {
      session_id: sessionId,
      hook_event_name: 'PermissionRequest',
    });
    await expectOverlayVisible(page, 'Needs approval');
    const permissionMessages = await standalone.drainMessages();
    expect(permissionMessages.some((message) => message.type === 'agentToolPermission')).toBe(true);

    await sendHookEvent(standalone.hookServerConfig, {
      session_id: sessionId,
      hook_event_name: 'PostToolUse',
    });
    const postToolMessages = await standalone.drainMessages();
    expect(
      postToolMessages.some(
        (message) =>
          message.type === 'agentToolDone' &&
          message.toolId === toolStart?.toolId &&
          message.id === toolStart?.id,
      ),
    ).toBe(true);
    await expectOverlayVisible(page, 'Needs approval');

    await sendHookEvent(standalone.hookServerConfig, {
      session_id: sessionId,
      hook_event_name: 'Notification',
      notification_type: 'idle_prompt',
    });
    await expectOverlayVisible(page, 'Waiting for input');
    const notificationMessages = await standalone.drainMessages();
    expect(notificationMessages.some((message) => message.type === 'agentToolsClear')).toBe(true);
    expect(
      notificationMessages.some(
        (message) => message.type === 'agentStatus' && message.status === 'waiting',
      ),
    ).toBe(true);

    await sendHookEvent(standalone.hookServerConfig, sessionEndExit(sessionId));
    await expectOverlayCount(page, 0);
    const sessionEndMessages = await standalone.drainMessages();
    expect(sessionEndMessages.some((message) => message.type === 'agentClosed')).toBe(true);
  });
});

/**
 * The standalone consent path end to end. The fixture normally seeds a granted Claude consent; these opt out, so the
 * CLI starts with nothing installed and the server asks over the tokened /ws handshake. The full Intro flow — the
 * tour, the disclosure, and every button's on-disk consequence — is pinned in claude/hooks-on/consent.spec.ts; the
 * pins here are the standalone-only half: the token boundary.
 */
test.describe('Standalone / hooks consent', () => {
  test.use({ seedHooksConsent: false });

  function readConsentFrom(tmpHome: string): boolean {
    try {
      const raw = fs.readFileSync(path.join(tmpHome, '.pixel-agents', 'config.json'), 'utf8');
      const consent = (JSON.parse(raw) as { hooksConsent?: Record<string, string> }).hooksConsent;
      return consent?.claude === 'granted';
    } catch {
      return false;
    }
  }

  function ourHookEventCount(tmpHome: string): number {
    return ourHookEvents(tmpHome).length;
  }

  // The token boundary, at the browser level: a bare-URL session still watches
  // the office but is never asked — its answer would be ignored
  // (server/__tests__/httpServerWs.test.ts pins the wire half), so showing it
  // the dialog would be a lie.
  test('an untokened spectator page never sees the consent dialog @area:standalone', async ({
    page,
    standalone,
  }) => {
    void standalone;
    const bareUrl = new URL(page.url());
    bareUrl.search = '';

    const spectator = await page.context().newPage();
    try {
      await spectator.goto(bareUrl.toString());
      await expect(spectator.locator('canvas')).toBeVisible({
        timeout: 30_000,
      });
      // Settle before the negative assertion: the dialog, were it coming,
      // rides the webviewReady handshake that just completed.
      await spectator.waitForTimeout(2_000);
      await expect(spectator.getByRole('dialog')).toHaveCount(0);
    } finally {
      await spectator.close();
    }
  });

  // Declining the first-run Intro leaves nothing installed: the Settings
  // panel is gone, so Not Now is the only outcome of a dismissed ask until
  // the Intro itself returns on a later load.
  test('declining the first-run Intro installs nothing @area:standalone', async ({
    page,
    standalone,
  }) => {
    const settingsPath = path.join(standalone.tmpHome, '.claude', 'settings.json');

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await advanceIntroToConsentStep(dialog);
    await dialog.getByRole('button', { name: 'Not Now' }).click();
    await finishIntro(dialog);
    await page.waitForTimeout(1_000);

    expect(fs.existsSync(settingsPath)).toBe(false);
    expect(readConsentFrom(standalone.tmpHome)).toBe(false);
    expect(ourHookEventCount(standalone.tmpHome)).toBe(0);
  });
});
