import fs from 'node:fs';
import path from 'node:path';

import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

import type { FakeHerdrAgent, FakeHerdrServer } from './herdr';
import { startFakeHerdrServer } from './herdr';

/**
 * Connections reach herdr servers other than this machine's default session. The far ends are faked at their
 * process boundaries, per e2e/README.md "Mocking model & rules": herdr is a Unix-socket JSON-RPC server, and the
 * OpenSSH client is a stand-in `ssh` on PATH that forwards a local socket to a "remote" home on this machine.
 */

const FAKE_SSH = path.join(__dirname, '../fixtures/fake-ssh.cjs');
export const CONNECTION_TIMEOUT_MS = 20_000;

export function paneAgent(
  workspace: string,
  overrides: Partial<FakeHerdrAgent> = {},
): FakeHerdrAgent {
  return {
    pane_id: 'w1:p1',
    workspace_id: `ws-${workspace}`,
    agent: 'codex',
    agent_status: 'working',
    cwd: `/work/${workspace}`,
    foreground_cwd: `/work/${workspace}`,
    terminal_title_stripped: `Working in ${workspace}`,
    ...overrides,
  };
}

/** A herdr under `home` running one agent per workspace, each in its own pane. */
export async function serveHerdr(
  home: string,
  workspaces: string | string[],
  overrides: Partial<FakeHerdrAgent> = {},
  session?: string,
): Promise<FakeHerdrServer> {
  const names = Array.isArray(workspaces) ? workspaces : [workspaces];
  const herdr = await startFakeHerdrServer(home, session);
  herdr.setWorkspaces(names.map((name) => ({ workspace_id: `ws-${name}`, label: name })));
  herdr.setAgents(
    names.map((name, i) => paneAgent(name, { pane_id: `w${i + 1}:p1`, ...overrides })),
  );
  return herdr;
}

/** Install the stand-in `ssh` where the server's PATH finds it, knowing each SSH target by the home it reaches. */
export function installFakeSsh(binDir: string, homeByTarget: Record<string, string>): void {
  fs.mkdirSync(binDir, { recursive: true });
  fs.copyFileSync(FAKE_SSH, path.join(binDir, 'ssh'));
  fs.chmodSync(path.join(binDir, 'ssh'), 0o755);
  const hosts = Object.fromEntries(
    Object.entries(homeByTarget).map(([target, home]) => [target, { home }]),
  );
  fs.writeFileSync(path.join(binDir, 'fake-ssh-hosts.json'), JSON.stringify(hosts));
}

export async function openConnections(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Connections' }).click();
  const menu = page
    .locator('div.fixed')
    .filter({ has: page.getByText('Connections', { exact: true }) });
  await expect(menu).toBeVisible();
  return menu;
}

export function connectionRow(menu: Locator, label: string): Locator {
  return menu.getByTestId('connection-row').filter({ hasText: label });
}

/** Close the Connections menu with its own close button. */
export async function closeConnections(menu: Locator): Promise<void> {
  await menu.getByRole('button', { name: 'x', exact: true }).click();
  await expect(menu).toBeHidden();
}

export async function addConnection(
  menu: Locator,
  connection: { kind: 'ssh' | 'local'; label: string; target?: string; session?: string },
): Promise<void> {
  await menu.getByLabel('Connection kind').selectOption(connection.kind);
  await menu.getByLabel('New connection label').fill(connection.label);
  if (connection.target) await menu.getByLabel('SSH target').fill(connection.target);
  if (connection.session) await menu.getByLabel('herdr session').fill(connection.session);
  await menu.getByRole('button', { name: 'Add', exact: true }).click();
}
