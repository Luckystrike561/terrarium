import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { TestInfo } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { applyAllureLabels } from '../../helpers/allure-labels';
import { expectOverlayCount, readSeatFits, type SeatFit } from '../../helpers/office';
import { launchStandalone } from '../../helpers/standalone';

/**
 * Seated characters sit IN their seats the way Habbo Hotel draws them: on a
 * seat facing the viewer the character draws over it and the seat still
 * shows around them, on a seat facing away the backrest draws over the
 * character and hides only its lower back, and every sitter's feet land
 * within the seat, never above it. Agents come from omp session stores (no
 * hook API, no herdr). The bundled office is seeded as `layout.json`, so it
 * stays one team module instead of growing: 16 working agents fill its 8
 * desks and then its 8 lounge seats (6 dining chairs facing every way, 2 on
 * the sofa) and type there, and the CTO sits at its desk and on its couch in
 * turn.
 */

const FLOOR = 'local';
const AGENTS = 16;
const ASSETS_DIR = path.join(__dirname, '../../../webview-ui/public/assets');
/** Share of a seat facing the viewer its sitter must leave visible: the seat
 *  still reads around the sitter instead of vanishing behind it. */
const MIN_SEAT_SHOWN = 0.2;
/** Share of a sitter a backrest facing away must leave visible: head and
 *  shoulders above the backrest. */
const MIN_CHARACTER_SHOWN = 0.45;
/** Rounding slack, in iso px, for the feet resting on the seat's bottom row. */
const FEET_SLACK_PX = 1;
const SEAT_TYPES_COVERED = [
  'CUSHIONED_CHAIR_FRONT',
  'CUSHIONED_CHAIR_BACK',
  'WOODEN_CHAIR_FRONT',
  'WOODEN_CHAIR_BACK',
  'WOODEN_CHAIR_LEFT',
  'WOODEN_CHAIR_RIGHT',
  'SOFA_FRONT',
];
const CTO_SEAT_TYPES = ['EXEC_CHAIR_FRONT', 'SOFA_FRONT'];

function jsonl(...records: object[]): string {
  return records.map((record) => `${JSON.stringify(record)}\n`).join('');
}

function writeSession(home: string, name: string, records: object[]): void {
  const dir = path.join(home, '.omp', 'agent', 'sessions', `-work-${name}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'session.jsonl'), jsonl(...records));
}

function expectSeatedInSeat(fit: SeatFit): void {
  const who = `${fit.isCto ? 'CTO' : `agent ${fit.id}`} on ${fit.seatType}`;
  if (fit.facesAway) {
    expect(fit.characterOnTop, `${who}: the backrest draws over the sitter`).toBe(false);
    expect(fit.characterShown, `${who}: visible share of the sitter`).toBeGreaterThanOrEqual(
      MIN_CHARACTER_SHOWN,
    );
  } else {
    expect(fit.characterOnTop, `${who}: the sitter draws over the seat`).toBe(true);
    expect(fit.seatShown, `${who}: visible share of the seat`).toBeGreaterThanOrEqual(
      MIN_SEAT_SHOWN,
    );
  }
  expect(fit.feetY, `${who}: feet below the seat's top`).toBeGreaterThan(fit.seatTopY);
  expect(fit.feetY, `${who}: feet no lower than the seat's bottom`).toBeLessThanOrEqual(
    fit.seatBottomY + FEET_SLACK_PX,
  );
}

test.beforeEach(async ({}, testInfo: TestInfo) => {
  await applyAllureLabels(testInfo);
});

test.describe('Office / seating', () => {
  test('characters sit in desk chairs, dining chairs, sofas and the CTO chair and couch @area:office', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'terrarium-seating-e2e-home-'));
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'terrarium-seating-e2e-ws-'));
    const defaultLayout = fs
      .readdirSync(ASSETS_DIR)
      .find((file) => /^default-layout-\d+\.json$/.test(file));
    const standalone = await launchStandalone(page, {
      homeDir: tmpHome,
      workspaceDir,
      provider: 'omp',
      seedLayout: JSON.parse(fs.readFileSync(path.join(ASSETS_DIR, defaultLayout!), 'utf8')),
    });
    try {
      for (let i = 0; i < AGENTS; i++) {
        writeSession(tmpHome, `agent${i}`, [
          { type: 'session', cwd: `/work/agent${i}` },
          { type: 'message', message: { role: 'user' } },
          {
            type: 'custom',
            customType: 'tool_execution_start',
            data: { toolCallId: `call-${i}`, toolName: 'read', args: { path: '/work/PLAN.md' } },
          },
        ]);
      }
      await expectOverlayCount(page, AGENTS);

      const seen = new Set<string>();
      const recordFits = async (): Promise<void> => {
        for (const fit of await readSeatFits(page, FLOOR)) {
          expectSeatedInSeat(fit);
          seen.add(`${fit.isCto ? 'cto' : 'agent'}:${fit.seatType}`);
        }
      };

      await expect
        .poll(
          async () => {
            await recordFits();
            return SEAT_TYPES_COVERED.filter((type) => !seen.has(`agent:${type}`));
          },
          { timeout: 60_000, message: 'every kind of seat holds a sitter' },
        )
        .toEqual([]);

      await expect
        .poll(
          async () => {
            await recordFits();
            return CTO_SEAT_TYPES.filter((type) => !seen.has(`cto:${type}`));
          },
          { timeout: 90_000, message: 'the CTO sat at its desk and on its couch' },
        )
        .toEqual([]);
    } finally {
      await standalone.cleanup();
      fs.rmSync(tmpHome, { recursive: true, force: true });
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });
});
