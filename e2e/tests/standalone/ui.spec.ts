import path from 'node:path';

import { expect, test } from '../../fixtures/standalone';
import { sendHookEvent, sessionStartStartup } from '../../helpers/hooks';
import {
  closeAgentFromOverlay,
  expectOverlayCount,
  expectOverlayVisible,
} from '../../helpers/office';
import { openSettingsModal, setSettings } from '../../helpers/webview';

// The DebugView diagnostics block polls every 2s (see DebugView.tsx); allow a
// few polling rounds plus IPC/render slop.
const DIAGNOSTICS_POLL_TIMEOUT_MS = 15_000;
// onReloadAssets does its filesystem work after the externalAssetDirectoriesUpdated
// reply, so the re-broadcast lands slightly later than the dir-list update.
const ASSET_RELOAD_TIMEOUT_MS = 15_000;
// WebSocketTransport reconnects with capped exponential backoff (up to 4s);
// allow a couple of retry cycles for the state to settle both ways.
const CONNECTION_STATE_TIMEOUT_MS = 15_000;

test.describe('Standalone / UI', () => {
  test('closeAgent despawns the character @area:standalone', async ({ page, standalone }) => {
    await setSettings(page, {
      alwaysShowLabels: true,
      hooksEnabled: true,
      watchAllSessions: true,
      debugView: false,
    });
    await standalone.drainMessages();

    const sessionId = 'standalone-close-agent-session';
    const filePath = path.join(standalone.workspaceDir, 'close-agent.ts');

    await sendHookEvent(
      standalone.hookServerConfig,
      sessionStartStartup(sessionId, standalone.workspaceDir),
    );
    await sendHookEvent(standalone.hookServerConfig, {
      session_id: sessionId,
      hook_event_name: 'PreToolUse',
      tool_name: 'Read',
      tool_input: { file_path: filePath },
    });

    await expectOverlayCount(page, 1);
    await expectOverlayVisible(page, 'Reading close-agent.ts');
    await standalone.drainMessages();

    await closeAgentFromOverlay(page, { text: 'Reading close-agent.ts' });

    await expectOverlayCount(page, 0);
    const messages = await standalone.drainMessages();
    expect(messages.some((message) => message.type === 'agentClosed')).toBe(true);
  });

  test('Debug View renders JSONL diagnostics in standalone @area:standalone', async ({
    page,
    standalone,
  }) => {
    await setSettings(page, {
      debugView: true,
      hooksEnabled: true,
      watchAllSessions: true,
      alwaysShowLabels: true,
    });

    const sessionId = 'standalone-debug-view-session';
    const filePath = path.join(standalone.workspaceDir, 'debug-view.ts');

    await sendHookEvent(
      standalone.hookServerConfig,
      sessionStartStartup(sessionId, standalone.workspaceDir),
    );
    await sendHookEvent(standalone.hookServerConfig, {
      session_id: sessionId,
      hook_event_name: 'PreToolUse',
      tool_name: 'Read',
      tool_input: { file_path: filePath },
    });

    // Presence of the diagnostics block (either branch) is the proof that the
    // agentDiagnostics reply reached the webview via transport.onMessage; do
    // not assert a specific jsonlExists branch (a hook-only session may or may
    // not have a materialized transcript file).
    await expect(page.getByText(/JSONL (connected|not found)/)).toBeVisible({
      timeout: DIAGNOSTICS_POLL_TIMEOUT_MS,
    });
  });

  test('adding an external asset directory triggers a live asset reload @area:standalone', async ({
    page,
    standalone,
  }) => {
    const modal = await openSettingsModal(page);
    await standalone.drainMessages();

    await modal
      .locator('input[placeholder="Absolute asset directory path"]')
      .fill(standalone.workspaceDir);
    await modal.locator('button', { hasText: 'Add' }).click();

    // getByTitle matches the title attribute literally; a raw CSS
    // [title="..."] selector would mis-parse the backslashes in a Windows path
    // as CSS escapes and never match its own title.
    await expect(modal.getByTitle(standalone.workspaceDir, { exact: true })).toBeVisible();

    // Light depth: prove the onReloadAssets re-broadcast fired, not a
    // character-count delta (no fixture PNGs staged in workspaceDir).
    await expect
      .poll(
        async () => {
          const messages = await standalone.drainMessages();
          return messages.some((message) => message.type === 'characterSpritesLoaded');
        },
        { timeout: ASSET_RELOAD_TIMEOUT_MS },
      )
      .toBe(true);
  });

  test('ConnectionIndicator appears when the WebSocket connection drops @area:standalone', async ({
    page,
    standalone,
  }) => {
    await standalone.drainMessages();

    // Settle wait before the negative assertion (office.ts wait-strategy
    // convention): give the runtime a chance to render the indicator wrongly
    // before checking absence.
    await page.waitForTimeout(500);
    await expect(page.getByText(/Reconnecting|Disconnected/)).toHaveCount(0);

    // Fallback for assumption A1: `page.context().setOffline(true)` does not
    // reliably close an already-open WebSocket on this Chromium build (verified
    // empirically — the indicator never appeared). Stopping the real host
    // process closes the socket from the server side instead.
    await standalone.stopHost();
    await expect(page.getByText(/Reconnecting|Disconnected/)).toBeVisible({
      timeout: CONNECTION_STATE_TIMEOUT_MS,
    });

    await standalone.startHost();
    await expect(page.getByText(/Reconnecting|Disconnected/)).toHaveCount(0, {
      timeout: CONNECTION_STATE_TIMEOUT_MS,
    });
  });
});
