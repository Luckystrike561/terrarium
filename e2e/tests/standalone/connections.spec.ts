import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { applyAllureLabels } from '../../helpers/allure-labels';
import {
  addConnection,
  CONNECTION_TIMEOUT_MS,
  connectionRow,
  installFakeSsh,
  openConnections,
  serveHerdr,
} from '../../helpers/connections';
import type { FakeHerdrServer } from '../../helpers/herdr';
import { expectOverlayCount, expectOverlayVisible } from '../../helpers/office';
import type { StandaloneSession } from '../../helpers/standalone';
import { launchStandalone } from '../../helpers/standalone';

interface ConnectionsFixture {
  root: string;
  home: string;
  remoteHome: string;
  binDir: string;
  localHerdr: FakeHerdrServer;
  standalone: StandaloneSession;
}

async function launchWithConnections(page: Page): Promise<ConnectionsFixture> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-conn-'));
  const home = path.join(root, 'home');
  const remoteHome = path.join(root, 'remote');
  const binDir = path.join(root, 'bin');
  installFakeSsh(binDir, { buildbox: remoteHome });
  const localHerdr = await serveHerdr(home, 'local-desk');
  const standalone = await launchStandalone(page, {
    homeDir: home,
    workspaceDir: path.join(root, 'workspace'),
    provider: 'herdr',
  });
  await standalone.drainMessages();
  return { root, home, remoteHome, binDir, localHerdr, standalone };
}

async function cleanup(fixture: ConnectionsFixture, ...servers: FakeHerdrServer[]): Promise<void> {
  await fixture.standalone.cleanup();
  for (const server of [fixture.localHerdr, ...servers]) await server.stop();
  fs.rmSync(fixture.root, { recursive: true, force: true });
}

test.beforeEach(async ({}, testInfo: TestInfo) => {
  await applyAllureLabels(testInfo);
});

test.describe('Standalone / herdr connections', () => {
  test('connections: an SSH host joins the office, follows its herdr up and down, and survives a restart @area:standalone', async ({
    page,
  }) => {
    test.skip(process.platform === 'win32', 'the stand-in ssh is a shebang script');
    const fixture = await launchWithConnections(page);
    let remoteHerdr = await serveHerdr(fixture.remoteHome, 'build-farm', {
      agent_status: 'blocked',
    });
    try {
      const menu = await openConnections(page);
      await expect(connectionRow(menu, 'This machine')).toHaveAttribute('data-state', 'connected', {
        timeout: CONNECTION_TIMEOUT_MS,
      });
      await expectOverlayVisible(page, 'local-desk');

      await addConnection(menu, { kind: 'ssh', label: 'Build box', target: 'buildbox' });
      await expect(connectionRow(menu, 'Build box')).toHaveAttribute('data-state', 'connected', {
        timeout: CONNECTION_TIMEOUT_MS,
      });

      // Both servers report pane w1:p1: two characters, the remote one named for its machine.
      await expectOverlayVisible(page, 'build-farm @Build box');
      await expectOverlayCount(page, 2);
      const blocked = (await fixture.standalone.drainMessages()).some(
        (message) => message.type === 'agentToolPermission',
      );
      expect(blocked).toBe(true);

      await remoteHerdr.stop();
      await expect(connectionRow(menu, 'Build box')).toHaveAttribute(
        'data-state',
        /error|reconnecting/,
        { timeout: CONNECTION_TIMEOUT_MS },
      );
      await expect(
        connectionRow(menu, 'Build box').getByTestId('connection-message'),
      ).toContainText('buildbox');
      await expectOverlayCount(page, 1);

      remoteHerdr = await serveHerdr(fixture.remoteHome, 'build-farm');
      await expect(connectionRow(menu, 'Build box')).toHaveAttribute('data-state', 'connected', {
        timeout: CONNECTION_TIMEOUT_MS,
      });
      await expectOverlayCount(page, 2);

      await fixture.standalone.stopHost();
      await fixture.standalone.startHost();
      await fixture.standalone.reopenPrintedUrl();
      const reopened = await openConnections(page);
      await expect(connectionRow(reopened, 'Build box')).toHaveAttribute(
        'data-state',
        'connected',
        {
          timeout: CONNECTION_TIMEOUT_MS,
        },
      );
      await expectOverlayVisible(page, 'build-farm @Build box');

      await connectionRow(reopened, 'Build box').getByRole('button', { name: 'Disable' }).click();
      await expect(connectionRow(reopened, 'Build box')).toHaveAttribute('data-state', 'disabled');
      await expectOverlayCount(page, 1);

      await connectionRow(reopened, 'Build box').getByRole('button', { name: 'Remove' }).click();
      await expect(connectionRow(reopened, 'Build box')).toHaveCount(0);
      const config = JSON.parse(
        fs.readFileSync(path.join(fixture.home, '.terrarium', 'config.json'), 'utf8'),
      ) as { connections?: { label: string }[] };
      expect(config.connections?.map((connection) => connection.label)).toEqual(['This machine']);
    } finally {
      await cleanup(fixture, remoteHerdr);
    }
  });

  test('connections: an unreachable SSH target is refused with the ssh error and nothing is saved @area:standalone', async ({
    page,
  }) => {
    test.skip(process.platform === 'win32', 'the stand-in ssh is a shebang script');
    const fixture = await launchWithConnections(page);
    try {
      const menu = await openConnections(page);

      await addConnection(menu, { kind: 'ssh', label: 'Nowhere', target: 'nowhere' });

      await expect(menu.getByTestId('connection-add-error')).toHaveText(
        'ssh: Could not resolve hostname nowhere: Name or service not known',
        { timeout: CONNECTION_TIMEOUT_MS },
      );
      await expect(menu.getByTestId('connection-row')).toHaveCount(1);
      expect((await fetch(`${fixture.standalone.hostUrl}/api/health`)).ok).toBe(true);
    } finally {
      await cleanup(fixture);
    }
  });

  test("connections: a local connection to a named herdr session shows that session's agents @area:standalone", async ({
    page,
  }) => {
    const fixture = await launchWithConnections(page);
    const nightHerdr = await serveHerdr(fixture.home, 'night-shift', {}, 'night');
    try {
      const menu = await openConnections(page);

      await addConnection(menu, { kind: 'local', label: 'Night', session: 'night' });

      await expect(connectionRow(menu, 'Night')).toHaveAttribute('data-state', 'connected', {
        timeout: CONNECTION_TIMEOUT_MS,
      });
      await expectOverlayVisible(page, 'night-shift @Night');
      await expectOverlayCount(page, 2);
    } finally {
      await cleanup(fixture, nightHerdr);
    }
  });
});
