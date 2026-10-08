import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { TestInfo } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { applyAllureLabels } from '../../helpers/allure-labels';
import {
  expectOverlayCount,
  expectOverlayVisible,
  expectOverlayVisibleForAgent,
  selectCharacter,
} from '../../helpers/office';
import type { RecordedServerMessage } from '../../helpers/standalone';
import { launchStandalone } from '../../helpers/standalone';
import { setSettings } from '../../helpers/webview';

/**
 * omp has no hook API: the process boundary it crosses is its own session
 * store, `~/.omp/agent/sessions/<dir>/<session>.jsonl`, an append-only
 * transcript. The test writes there exactly what a running omp appends, with
 * no herdr socket anywhere.
 */

function jsonl(...records: object[]): string {
  return records.map((record) => `${JSON.stringify(record)}\n`).join('');
}

test.beforeEach(async ({}, testInfo: TestInfo) => {
  await applyAllureLabels(testInfo);
});

test.describe('Standalone / omp provider', () => {
  test('omp: a running session appears with its tool activity and goes idle when its turn ends, with no herdr @area:standalone', async ({
    page,
  }) => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-omp-e2e-home-'));
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-omp-e2e-workspace-'));
    const sessionDir = path.join(tmpHome, '.omp', 'agent', 'sessions', '-work-zeta');
    const sessionFile = path.join(sessionDir, 'session.jsonl');

    const standalone = await launchStandalone(page, {
      homeDir: tmpHome,
      workspaceDir,
      provider: 'omp',
    });
    try {
      await setSettings(page, { alwaysShowLabels: true });
      await standalone.drainMessages();

      // omp starts a session in another terminal: header, then the user's prompt.
      fs.mkdirSync(sessionDir, { recursive: true });
      fs.writeFileSync(
        sessionFile,
        jsonl(
          { type: 'session', cwd: '/work/zeta' },
          { type: 'message', message: { role: 'user' } },
        ),
      );
      await expectOverlayCount(page, 1);
      await expectOverlayVisible(page, 'zeta');

      const seen: RecordedServerMessage[] = [];
      const drain = async (): Promise<RecordedServerMessage[]> => {
        seen.push(...(await standalone.drainMessages()));
        return seen;
      };
      const created = (await drain()).find(
        (message): message is RecordedServerMessage & { id: number } =>
          message.type === 'agentCreated',
      );
      expect(created).toBeTruthy();

      fs.appendFileSync(
        sessionFile,
        jsonl({
          type: 'custom',
          customType: 'tool_execution_start',
          data: { toolCallId: 'call-1', toolName: 'read', args: { path: '/work/zeta/PLAN.md' } },
        }),
      );
      await selectCharacter(page, created!.id);
      await expectOverlayVisibleForAgent(page, created!.id, 'Reading PLAN.md');

      fs.appendFileSync(
        sessionFile,
        jsonl({ type: 'message', message: { role: 'assistant', stopReason: 'stop' } }),
      );
      await expect
        .poll(
          async () =>
            (await drain())
              .filter((message) => message.type === 'agentStatus')
              .map((message) => message['status'])
              .at(-1),
          { timeout: 10_000 },
        )
        .toBe('waiting');
    } finally {
      await standalone.cleanup();
      fs.rmSync(tmpHome, { recursive: true, force: true });
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });
});
