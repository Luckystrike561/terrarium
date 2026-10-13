import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '../../fixtures/standalone';

const USER_STATUS_LINE = { type: 'command', command: 'printf user-status', padding: 1 };

/** Seconds since the epoch, the unit Claude Code's `rate_limits.*.resets_at` uses. */
function epochSecondsFromNow(offsetSeconds: number): number {
  return Math.floor(Date.now() / 1000) + offsetSeconds;
}

function installedStatusLineCommand(tmpHome: string): string | undefined {
  const settings: unknown = JSON.parse(
    fs.readFileSync(path.join(tmpHome, '.claude', 'settings.json'), 'utf-8'),
  );
  if (settings === null || typeof settings !== 'object' || !('statusLine' in settings)) {
    return undefined;
  }
  const statusLine = settings.statusLine;
  if (statusLine === null || typeof statusLine !== 'object' || !('command' in statusLine)) {
    return undefined;
  }
  return typeof statusLine.command === 'string' ? statusLine.command : undefined;
}

/** Run the status line command Terrarium installed, the way Claude Code does: in a shell, the session JSON on
 *  stdin. Resolves with what it printed. */
function runInstalledStatusLine(tmpHome: string, input: unknown): Promise<string> {
  const command = installedStatusLineCommand(tmpHome);
  if (command === undefined) throw new Error('no status line installed');
  return new Promise((resolve, reject) => {
    const child = execFile(
      '/bin/sh',
      ['-c', command],
      { env: { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome } },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
    child.stdin?.end(JSON.stringify(input));
  });
}

test.describe('Standalone / quota', () => {
  test.use({ seedClaudeSettings: { statusLine: USER_STATUS_LINE } });

  test("Claude's status line rate limits fill the coffee-bean jars @area:standalone", async ({
    page,
    standalone,
  }) => {
    test.skip(process.platform === 'win32', 'drives the status line through /bin/sh');
    const { narrator } = standalone;
    narrator.step('No status line has run yet: the office draws no jars');
    await page.waitForTimeout(500);
    await expect(page.getByTestId('quota-jar')).toHaveCount(0);

    await expect
      .poll(() => installedStatusLineCommand(standalone.tmpHome))
      .toContain('--status-line');

    narrator.step(
      'Claude Code runs the status line with 70% of the 5-hour and 100% of the week used',
    );
    const output = await runInstalledStatusLine(standalone.tmpHome, {
      session_id: 'quota-session',
      rate_limits: {
        five_hour: { used_percentage: 70, resets_at: epochSecondsFromNow(2 * 3600) },
        seven_day: { used_percentage: 100, resets_at: epochSecondsFromNow(3 * 86400) },
      },
    });
    expect(output).toBe('user-status');
    narrator.check("The user's own status line printed exactly what it prints alone");

    const fiveHour = page.locator('[data-meter-id="claude:five_hour"]');
    const sevenDay = page.locator('[data-meter-id="claude:seven_day"]');
    await expect(fiveHour).toHaveAttribute('data-beans', '3');
    await expect(fiveHour.getByTestId('quota-bean')).toHaveCount(3);
    await expect(sevenDay).toHaveAttribute('data-beans', '0');
    await expect(sevenDay).toHaveAttribute('data-empty', 'true');
    narrator.check('70% used leaves 3 of 10 beans, and the used-up week is an empty, flagged jar');

    narrator.step('The page reloads before Claude runs the status line again');
    await standalone.reloadPage();
    await expect(fiveHour).toHaveAttribute('data-beans', '3');
    await expect(sevenDay).toHaveAttribute('data-beans', '0');
    await expect(sevenDay).toHaveAttribute('data-empty', 'true');
    narrator.check('The jars come back from the quota board the server sends on connect');

    narrator.step('Hover the 5-hour jar');
    await fiveHour.hover();
    const tooltip = page.getByTestId('quota-tooltip');
    await expect(tooltip).toContainText('Claude · 5h');
    await expect(tooltip).toContainText('70% used');
    await expect(tooltip).toContainText(/Resets in (1h 59m|2h 0m)/);
    await expect(tooltip).toContainText('Updated');
    await expect(fiveHour).toHaveAttribute('data-stale', 'false');

    narrator.step('The 5-hour window is 99.7% used');
    await runInstalledStatusLine(standalone.tmpHome, {
      session_id: 'quota-session',
      rate_limits: {
        five_hour: { used_percentage: 99.7, resets_at: epochSecondsFromNow(2 * 3600) },
      },
    });
    await expect(fiveHour).toHaveAttribute('data-beans', '1');
    await expect(fiveHour).toHaveAttribute('data-empty', 'false');
    await expect(tooltip).toContainText('99% used');
    narrator.check('The label stays below 100% while the jar still holds a bean');

    narrator.step('A reading whose window has already reset arrives');
    await runInstalledStatusLine(standalone.tmpHome, {
      session_id: 'quota-session',
      rate_limits: {
        five_hour: { used_percentage: 70, resets_at: epochSecondsFromNow(-60) },
      },
    });
    await expect(fiveHour).toHaveAttribute('data-stale', 'true');
    await expect(tooltip).toContainText('Stale');
    narrator.check('The jar is drawn stale, not fresh');
  });
});
