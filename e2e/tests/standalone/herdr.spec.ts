import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { applyAllureLabels } from '../../helpers/allure-labels';
import type { FakeHerdrServer } from '../../helpers/herdr';
import { startFakeHerdrServer } from '../../helpers/herdr';
import {
  expectOverlayCount,
  expectOverlayVisible,
  expectOverlayVisibleForAgent,
  selectCharacter,
} from '../../helpers/office';
import type { RecordedServerMessage, StandaloneSession } from '../../helpers/standalone';
import { launchStandalone } from '../../helpers/standalone';
import { setSettings } from '../../helpers/webview';

/**
 * Herdr is an external process (a local session multiplexer), so per the
 * process-boundary rule in e2e/README.md "Mocking model & rules" it is faked
 * at that boundary: a real Unix-socket JSON-RPC server standing in for the
 * real `herdr` daemon, never by poking server/webview internals.
 */

interface HerdrFixture {
  tmpHome: string;
  workspaceDir: string;
  fakeHerdr: FakeHerdrServer;
  standalone: StandaloneSession;
}

/** One record per line, as omp appends them to a session transcript. */
function jsonl(...records: object[]): string {
  return records.map((record) => `${JSON.stringify(record)}\n`).join('');
}

const ompToolStart = (toolCallId: string): object => ({
  type: 'custom',
  customType: 'tool_execution_start',
  data: { toolCallId, toolName: 'bash', intent: `Running ${toolCallId}` },
});
const ompTurnEnded = { type: 'message', message: { role: 'assistant', stopReason: 'stop' } };
const ompPrompt = { type: 'message', message: { role: 'user' } };

/** Write an omp transcript into omp's own session store, where the omp module discovers it. */
function ompStoreSession(tmpHome: string, cwd: string, ...records: object[]): string {
  const dir = path.join(tmpHome, '.omp', 'agent', 'sessions', `-${path.basename(cwd)}`);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'session.jsonl');
  fs.writeFileSync(file, jsonl({ type: 'session', cwd }, ...records));
  return file;
}

async function launchHerdrStandalone(page: Page, provider = 'herdr'): Promise<HerdrFixture> {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-herdr-e2e-home-'));
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-herdr-e2e-workspace-'));
  // Neither herdr nor omp installs anything, so neither has a consent ask. The
  // Claude grant keeps an unrelated first-run dialog off the office in case a
  // spec enables Claude too.
  fs.mkdirSync(path.join(tmpHome, '.pixel-agents'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpHome, '.pixel-agents', 'config.json'),
    JSON.stringify({ hooksConsent: { claude: 'granted' } }, null, 2),
  );

  // Must exist before the CLI spawns: HerdrBridge's connect-failure path only
  // retries every 5s, so a socket created after launch would tax every test.
  const fakeHerdr = await startFakeHerdrServer(tmpHome);

  const standalone = await launchStandalone(page, {
    homeDir: tmpHome,
    workspaceDir,
    provider,
  });
  await setSettings(page, { alwaysShowLabels: true });
  await standalone.drainMessages();

  return { tmpHome, workspaceDir, fakeHerdr, standalone };
}

async function cleanup(fixture: HerdrFixture): Promise<void> {
  await fixture.standalone.cleanup();
  await fixture.fakeHerdr.stop();
  fs.rmSync(fixture.tmpHome, { recursive: true, force: true });
  fs.rmSync(fixture.workspaceDir, { recursive: true, force: true });
}

test.beforeEach(async ({}, testInfo: TestInfo) => {
  await applyAllureLabels(testInfo);
});

test.describe('Standalone / herdr provider', () => {
  test('herdr: one character per live pane, named by workspace and tab, task read from the title @area:standalone', async ({
    page,
  }) => {
    const fixture = await launchHerdrStandalone(page);
    try {
      fixture.fakeHerdr.setWorkspaces([
        { workspace_id: 'ws-monopoly', label: 'monopoly' },
        { workspace_id: 'ws-console', label: 'console' },
      ]);
      fixture.fakeHerdr.setTabs([
        { tab_id: 'tab-2', workspace_id: 'ws-monopoly', label: '2' },
        { tab_id: 'tab-3', workspace_id: 'ws-monopoly', label: '3' },
      ]);
      fixture.fakeHerdr.setAgents([
        {
          pane_id: 'pane-monopoly-2',
          workspace_id: 'ws-monopoly',
          tab_id: 'tab-2',
          agent: 'omp',
          agent_status: 'working',
          cwd: '/work/monopoly',
          foreground_cwd: '/work/monopoly',
          terminal_title_stripped: 'π ⠧ Verify pending creative bidder message sending',
        },
        {
          pane_id: 'pane-monopoly-3',
          workspace_id: 'ws-monopoly',
          tab_id: 'tab-3',
          agent: 'omp',
          agent_status: 'working',
          cwd: '/work/monopoly',
          foreground_cwd: '/work/monopoly',
          terminal_title_stripped: 'π ⠇ Review contested auction terms',
        },
        {
          pane_id: 'pane-console',
          workspace_id: 'ws-console',
          agent: 'omp',
          agent_status: 'working',
          cwd: '/work/console',
          foreground_cwd: '/work/console',
          terminal_title_stripped: 'π ⠋ Tally final scoreboard',
        },
      ]);

      await expectOverlayCount(page, 3);
      await expectOverlayVisible(page, 'monopoly #2');
      await expectOverlayVisible(page, 'monopoly #3');
      await expectOverlayVisible(page, 'console');

      const messages = await fixture.standalone.drainMessages();
      const monopoly2 = messages.find(
        (message): message is RecordedServerMessage & { id: number } =>
          message.type === 'agentInfo' && message['name'] === 'monopoly #2',
      );
      expect(monopoly2).toBeTruthy();

      await selectCharacter(page, monopoly2!.id);
      await expectOverlayVisibleForAgent(
        page,
        monopoly2!.id,
        'Verify pending creative bidder message sending',
      );
    } finally {
      await cleanup(fixture);
    }
  });

  test('herdr: a shell-prompt title never creates a character, and a live agent is removed when it returns to the shell @area:standalone', async ({
    page,
  }) => {
    const fixture = await launchHerdrStandalone(page);
    try {
      fixture.fakeHerdr.setWorkspaces([{ workspace_id: 'ws-alpha', label: 'alpha' }]);
      fixture.fakeHerdr.setAgents([
        {
          pane_id: 'pane-exited',
          workspace_id: 'ws-alpha',
          agent: 'omp',
          agent_status: 'working',
          cwd: '/work/alpha',
          foreground_cwd: '/work/alpha',
          // The agent process already exited; herdr keeps reporting the pane's
          // last-known `agent` but the shell has retitled the terminal to its
          // prompt -- the one signal that distinguishes this from a live agent.
          terminal_title_stripped: 'lucas@workstation:~/alpha',
        },
        {
          pane_id: 'pane-live',
          workspace_id: 'ws-alpha',
          agent: 'omp',
          agent_status: 'working',
          cwd: '/work/beta',
          foreground_cwd: '/work/beta',
          terminal_title_stripped: 'π ⠙ Draft the quarterly report',
        },
      ]);

      // Settle wait before the negative assertion, same convention as
      // e2e/helpers/office.ts's wait-strategy comment: without it,
      // toHaveCount(1) could pass before the exited pane was even considered.
      await page.waitForTimeout(500);
      await expectOverlayCount(page, 1);
      await expectOverlayVisible(page, 'alpha');

      fixture.fakeHerdr.updateAgent('pane-live', {
        terminal_title_stripped: 'lucas@workstation:~/beta',
      });

      await expectOverlayCount(page, 0);
    } finally {
      await cleanup(fixture);
    }
  });

  test('herdr: a terminal title change updates the task text @area:standalone', async ({
    page,
  }) => {
    const fixture = await launchHerdrStandalone(page);
    try {
      fixture.fakeHerdr.setWorkspaces([{ workspace_id: 'ws-gamma', label: 'gamma' }]);
      fixture.fakeHerdr.setAgents([
        {
          pane_id: 'pane-gamma',
          workspace_id: 'ws-gamma',
          agent: 'omp',
          agent_status: 'working',
          cwd: '/work/gamma',
          foreground_cwd: '/work/gamma',
          terminal_title_stripped: 'π ⠴ Draft the release notes',
        },
      ]);

      await expectOverlayCount(page, 1);
      const firstMessages = await fixture.standalone.drainMessages();
      const created = firstMessages.find(
        (message): message is RecordedServerMessage & { id: number } =>
          message.type === 'agentCreated',
      );
      expect(created).toBeTruthy();
      const agentId = created!.id;

      await selectCharacter(page, agentId);
      await expectOverlayVisibleForAgent(page, agentId, 'Draft the release notes');

      fixture.fakeHerdr.updateAgent('pane-gamma', {
        terminal_title_stripped: 'π ⠦ Proofread the changelog',
      });

      await expectOverlayVisibleForAgent(page, agentId, 'Proofread the changelog');
    } finally {
      await cleanup(fixture);
    }
  });

  test('herdr + omp: a pane running omp shows omp tool activity, never replays history, and goes idle at turn end @area:standalone', async ({
    page,
  }) => {
    const fixture = await launchHerdrStandalone(page, 'herdr,omp');
    try {
      const sessionFile = path.join(fixture.workspaceDir, 'session.jsonl');
      fs.writeFileSync(
        sessionFile,
        jsonl({ type: 'session', cwd: '/work/delta' }, ompToolStart('old-call'), ompTurnEnded),
      );

      fixture.fakeHerdr.setWorkspaces([{ workspace_id: 'ws-delta', label: 'delta' }]);
      fixture.fakeHerdr.setAgents([
        {
          pane_id: 'pane-delta',
          workspace_id: 'ws-delta',
          agent: 'omp',
          agent_status: 'idle',
          cwd: '/work/delta',
          foreground_cwd: '/work/delta',
          terminal_title_stripped: 'π > Ship the release',
          agent_session: { kind: 'path', value: sessionFile },
        },
      ]);

      await expectOverlayCount(page, 1);
      await expectOverlayVisible(page, 'delta');
      const seen: RecordedServerMessage[] = [];
      const statusesOf = async (): Promise<string[]> => {
        seen.push(...(await fixture.standalone.drainMessages()));
        return seen
          .filter((m) => m.type === 'agentStatus' || m.type === 'agentToolStart')
          .map((m) =>
            m.type === 'agentToolStart' ? `tool:${String(m['status'])}` : String(m['status']),
          );
      };

      await expect.poll(statusesOf, { timeout: 10_000 }).toContain('waiting');
      // Several transcript polls without the historical line being replayed.
      await page.waitForTimeout(3000);
      expect(await statusesOf()).not.toContain('tool:Running old-call');

      fs.appendFileSync(sessionFile, jsonl(ompPrompt, ompToolStart('late-call')));
      await expect.poll(statusesOf, { timeout: 10_000 }).toContain('tool:Running late-call');

      fs.appendFileSync(sessionFile, jsonl(ompTurnEnded));
      await expect
        .poll(
          async () => {
            const events = await statusesOf();
            return events.slice(events.lastIndexOf('tool:Running late-call')).includes('waiting');
          },
          { timeout: 10_000 },
        )
        .toBe(true);
    } finally {
      await cleanup(fixture);
    }
  });

  test('herdr + omp: an omp session omp and herdr both report is one character, and one outside herdr renders too @area:standalone', async ({
    page,
  }) => {
    const fixture = await launchHerdrStandalone(page, 'herdr,omp');
    try {
      // Both transcripts sit in omp's own store, where omp's discovery finds them.
      // herdr reports the first one in a pane as well.
      const paneSession = ompStoreSession(fixture.tmpHome, '/work/epsilon', ompPrompt);
      ompStoreSession(fixture.tmpHome, '/work/outside', ompTurnEnded);

      fixture.fakeHerdr.setWorkspaces([{ workspace_id: 'ws-epsilon', label: 'epsilon-pane' }]);
      fixture.fakeHerdr.setAgents([
        {
          pane_id: 'pane-epsilon',
          workspace_id: 'ws-epsilon',
          agent: 'omp',
          agent_status: 'working',
          cwd: '/work/epsilon',
          foreground_cwd: '/work/epsilon',
          terminal_title_stripped: 'π ⠋ Cut the release branch',
          agent_session: { kind: 'path', value: paneSession },
        },
      ]);

      await expectOverlayVisible(page, 'epsilon-pane');
      await expectOverlayVisible(page, 'outside');
      // Settle past several discovery scans and snapshot polls before the count.
      await page.waitForTimeout(4000);
      await expectOverlayCount(page, 2);

      const messages = await fixture.standalone.drainMessages();
      const paneAgent = messages.find(
        (message): message is RecordedServerMessage & { id: number } =>
          message.type === 'agentInfo' && message['name'] === 'epsilon-pane',
      );
      expect(paneAgent).toBeTruthy();

      fs.appendFileSync(paneSession, jsonl(ompToolStart('pane-call')));
      await selectCharacter(page, paneAgent!.id);
      await expectOverlayVisibleForAgent(page, paneAgent!.id, 'Running pane-call');
    } finally {
      await cleanup(fixture);
    }
  });
});
