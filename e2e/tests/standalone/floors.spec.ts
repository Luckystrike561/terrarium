import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { applyAllureLabels } from '../../helpers/allure-labels';
import {
  addConnection,
  CONNECTION_TIMEOUT_MS,
  closeConnections,
  connectionRow,
  installFakeSsh,
  openConnections,
  serveHerdr,
} from '../../helpers/connections';
import type { FakeHerdrServer } from '../../helpers/herdr';
import {
  expectOverlayCount,
  getOverlayByAgentId,
  readAgentSeats,
  readCharacterHitPoint,
  readCtoQueue,
  readFloors,
} from '../../helpers/office';
import { launchStandalone } from '../../helpers/standalone';

/**
 * One floor per machine. This machine runs herdr with two agents; a Raspberry Pi is reached over SSH twice (its
 * default herdr session and a named one, under two spellings of the same host) and a VPS once. SSH and herdr are
 * faked at their process boundaries, as in connections.spec.ts.
 */

/** Tall enough for three stacked floors at 1x, so the whole building is on screen at once. */
const BUILDING_VIEWPORT = { width: 1280, height: 1400 };
const FLOOR_TIMEOUT_MS = 20_000;

async function waitForFloors(page: Page, names: string[]): Promise<void> {
  await expect
    .poll(async () => (await readFloors(page)).map((floor) => floor.name), {
      timeout: FLOOR_TIMEOUT_MS,
    })
    .toEqual(names);
}

async function agentsOn(page: Page, floorId: string): Promise<number[]> {
  return (await readFloors(page)).find((floor) => floor.id === floorId)?.agentIds ?? [];
}

/** Click a character where it stands on the canvas until the click lands (it may still be walking to its desk). */
async function clickCharacter(page: Page, agentId: number): Promise<void> {
  await expect(async () => {
    const point = await readCharacterHitPoint(page, agentId);
    await page.mouse.click(point.x, point.y);
    await expect(
      getOverlayByAgentId(page, agentId).locator('button[title="Close agent"]'),
    ).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: FLOOR_TIMEOUT_MS });
}

test.beforeEach(async ({}, testInfo: TestInfo) => {
  await applyAllureLabels(testInfo);
});

test.describe('Standalone / floors', () => {
  test('floors: one floor per machine, shared by its connections, each machine keeping its agents to itself @area:standalone', async ({
    page,
  }) => {
    test.skip(process.platform === 'win32', 'the stand-in ssh is a shebang script');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-floors-'));
    const home = path.join(root, 'home');
    const piHome = path.join(root, 'pi');
    const vpsHome = path.join(root, 'vps');
    installFakeSsh(path.join(root, 'bin'), { pi: piHome, 'luc@pi': piHome, vps: vpsHome });
    const servers: FakeHerdrServer[] = [
      await serveHerdr(home, ['laptop-api', 'laptop-web']),
      await serveHerdr(piHome, ['pi-1', 'pi-2', 'pi-3', 'pi-4']),
      await serveHerdr(piHome, 'pi-night', {}, 'night'),
      await serveHerdr(vpsHome, 'hermes', { agent_status: 'blocked' }),
    ];
    const standalone = await launchStandalone(page, {
      homeDir: home,
      workspaceDir: path.join(root, 'workspace'),
      provider: 'herdr',
    });
    try {
      await page.setViewportSize(BUILDING_VIEWPORT);
      // This machine alone: one floor, as before floors existed.
      await expectOverlayCount(page, 2);
      const [ground] = await readFloors(page);
      expect(await readFloors(page)).toHaveLength(1);
      expect(ground.id).toBe('local');

      const menu = await openConnections(page);
      await addConnection(menu, { kind: 'ssh', label: 'Raspberry Pi', target: 'pi' });
      await expect(connectionRow(menu, 'Raspberry Pi')).toHaveAttribute('data-state', 'connected', {
        timeout: CONNECTION_TIMEOUT_MS,
      });
      await waitForFloors(page, [ground.name, 'Raspberry Pi']);

      // Two connections to the same host share its floor.
      await addConnection(menu, {
        kind: 'ssh',
        label: 'Pi night',
        target: 'luc@pi',
        session: 'night',
      });
      await expect(connectionRow(menu, 'Pi night')).toHaveAttribute('data-state', 'connected', {
        timeout: CONNECTION_TIMEOUT_MS,
      });
      await expectOverlayCount(page, 7);
      await waitForFloors(page, [ground.name, 'Raspberry Pi']);

      await addConnection(menu, { kind: 'ssh', label: 'VPS', target: 'vps' });
      await expectOverlayCount(page, 8);
      await waitForFloors(page, [ground.name, 'Raspberry Pi', 'VPS']);
      await closeConnections(menu);

      // Every socket sees the floor ids, so a remote one never names its host.
      const floorIdOf = async (name: string) =>
        (await readFloors(page)).find((floor) => floor.name === name)!.id;
      const piFloor = await floorIdOf('Raspberry Pi');
      const vpsFloor = await floorIdOf('VPS');
      for (const id of [piFloor, vpsFloor]) expect(id).not.toMatch(/pi|vps/);

      // Every agent sits on its own machine's floor, whatever connection reported it.
      expect(await agentsOn(page, 'local')).toHaveLength(2);
      expect(await agentsOn(page, piFloor)).toHaveLength(5);
      const [hermes] = await agentsOn(page, vpsFloor);
      const seats = await readAgentSeats(page);
      for (const floorId of ['local', piFloor, vpsFloor]) {
        const ids = await agentsOn(page, floorId);
        expect(
          seats.filter((seat) => ids.includes(seat.id)).every((seat) => seat.machineId === floorId),
        ).toBe(true);
      }

      // The VPS agent waits for approval in the VPS floor's CTO queue, not anyone else's.
      await expect
        .poll(async () => (await readCtoQueue(page, vpsFloor)).map((entry) => entry.id), {
          timeout: FLOOR_TIMEOUT_MS,
        })
        .toEqual([hermes]);
      expect(await readCtoQueue(page, 'local')).toEqual([]);
      expect(await readCtoQueue(page, piFloor)).toEqual([]);

      // The whole building is on screen at once, and a click on the top floor selects its agent.
      for (const id of [...(await agentsOn(page, 'local')), hermes]) {
        const point = await readCharacterHitPoint(page, id);
        expect(point.y).toBeGreaterThan(0);
        expect(point.y).toBeLessThan(BUILDING_VIEWPORT.height);
      }
      await clickCharacter(page, hermes);

      // Hovering an agent on the bottom floor shows its overlay with its task.
      const [laptopAgent] = await agentsOn(page, 'local');
      await expect(async () => {
        const point = await readCharacterHitPoint(page, laptopAgent);
        await page.mouse.move(point.x, point.y);
        await expect(getOverlayByAgentId(page, laptopAgent)).toContainText('Working in laptop', {
          timeout: 1_000,
        });
      }).toPass({ timeout: FLOOR_TIMEOUT_MS });

      // The Pi's floor stays while one of its connections does, and goes with the last one.
      const reopened = await openConnections(page);
      await connectionRow(reopened, 'Raspberry Pi').getByRole('button', { name: 'Remove' }).click();
      await waitForFloors(page, [ground.name, 'Pi night', 'VPS']);
      await expectOverlayCount(page, 4);
      await connectionRow(reopened, 'Pi night').getByRole('button', { name: 'Remove' }).click();
      await waitForFloors(page, [ground.name, 'VPS']);
      await expectOverlayCount(page, 3);
    } finally {
      await standalone.cleanup();
      for (const server of servers) await server.stop();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
