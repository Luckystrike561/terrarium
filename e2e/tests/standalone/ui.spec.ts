import path from 'node:path';

import { expect, test } from '../../fixtures/standalone';
import { sendHookEvent, sessionStartStartup } from '../../helpers/hooks';
import {
  closeAgentFromOverlay,
  expectOverlayCount,
  expectOverlayVisible,
} from '../../helpers/office';

// WebSocketTransport reconnects with capped exponential backoff (up to 4s);
// allow a couple of retry cycles for the state to settle both ways.
const CONNECTION_STATE_TIMEOUT_MS = 15_000;

test.describe('Standalone / UI', () => {
  test('closeAgent despawns the character @area:standalone', async ({ page, standalone }) => {
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
