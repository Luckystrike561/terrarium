import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { test } from '@playwright/test';

import type { FakeHerdrAgent, FakeHerdrServer } from '../helpers/herdr';
import { startFakeHerdrServer } from '../helpers/herdr';
import { expectOverlayCount } from '../helpers/office';
import { launchStandalone } from '../helpers/standalone';

/**
 * Scripted session behind the README demo GIF. Not a test: it drives a fake
 * herdr socket and omp session files through the real standalone server, and
 * the `demo:record` npm script turns the recorded video into the GIF.
 */

const TOOL_INTERVAL_MS = 2_200;
const SETTLE_MS = 2_500;

/** The "what's new" toast compares major.minor, so that is the form lastSeenVersion is stored in. */
function readPackageMajorMinor(): string {
  const manifest: unknown = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'),
  );
  if (manifest && typeof manifest === 'object' && 'version' in manifest) {
    if (typeof manifest.version === 'string') {
      return manifest.version.split('.').slice(0, 2).join('.');
    }
  }
  throw new Error('package.json has no string "version"');
}

const CURRENT_MAJOR_MINOR = readPackageMajorMinor();

interface ToolCall {
  toolName: string;
  intent: string;
}

interface DemoAgent {
  pane: FakeHerdrAgent;
  tools: ToolCall[];
}

const WORKSPACES = [
  { workspace_id: 'ws-terrarium', label: 'terrarium' },
  { workspace_id: 'ws-shop', label: 'shop' },
  { workspace_id: 'ws-docs', label: 'docs' },
  { workspace_id: 'ws-infra', label: 'infra' },
];

const TABS = [
  { tab_id: 'tab-api', workspace_id: 'ws-shop', label: 'api' },
  { tab_id: 'tab-web', workspace_id: 'ws-shop', label: 'web' },
];

function ompPane(
  paneId: string,
  workspaceId: string,
  task: string,
  sessionFile: string,
  tabId?: string,
): FakeHerdrAgent {
  return {
    pane_id: paneId,
    workspace_id: workspaceId,
    tab_id: tabId,
    agent: 'omp',
    agent_status: 'working',
    cwd: `/work/${workspaceId}`,
    foreground_cwd: `/work/${workspaceId}`,
    terminal_title_stripped: `π ⠋ ${task}`,
    agent_session: { kind: 'path', value: sessionFile },
  };
}

function appendToolStart(sessionFile: string, callId: string, tool: ToolCall): void {
  const record = {
    type: 'custom',
    customType: 'tool_execution_start',
    data: { toolCallId: callId, toolName: tool.toolName, intent: tool.intent },
  };
  fs.appendFileSync(sessionFile, `${JSON.stringify(record)}\n`);
}

class Scene {
  private readonly callCounts = new Map<string, number>();

  constructor(
    private readonly herdr: FakeHerdrServer,
    private readonly agents: Map<string, DemoAgent>,
  ) {}

  /** Every agent herdr reports as working runs its next tool. */
  tick(): void {
    for (const [paneId, agent] of this.agents) {
      if (agent.pane.agent_status !== 'working') continue;
      const count = this.callCounts.get(paneId) ?? 0;
      this.callCounts.set(paneId, count + 1);
      const tool = agent.tools[count % agent.tools.length];
      appendToolStart(agent.pane.agent_session!.value, `${paneId}-${count}`, tool);
    }
  }

  setStatus(paneId: string, status: 'working' | 'blocked' | 'idle'): void {
    const agent = this.agents.get(paneId)!;
    agent.pane.agent_status = status;
    this.herdr.updateAgent(paneId, { agent_status: status });
  }

  publish(): void {
    this.herdr.setAgents([...this.agents.values()].map((agent) => agent.pane));
  }
}

test('record the README demo', async ({ page }) => {
  // The page fixture, and with it the video, is created just before the body runs.
  const videoStartedAt = Date.now();
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'terrarium-demo-home-'));
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'terrarium-demo-ws-'));
  fs.mkdirSync(path.join(tmpHome, '.pixel-agents'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpHome, '.pixel-agents', 'config.json'),
    JSON.stringify({
      // Without it the "Updated to …" toast covers a corner of the footage.
      standalone: { alwaysShowLabels: true, lastSeenVersion: CURRENT_MAJOR_MINOR },
      hooksConsent: { claude: 'granted', herdr: 'granted' },
    }),
  );

  const session = (name: string): string => {
    const file = path.join(workspaceDir, `${name}.jsonl`);
    fs.writeFileSync(file, '');
    return file;
  };

  const agents = new Map<string, DemoAgent>([
    [
      'pane-terrarium',
      {
        pane: ompPane(
          'pane-terrarium',
          'ws-terrarium',
          'Design the provider registry',
          session('terrarium'),
        ),
        tools: [
          { toolName: 'read', intent: 'Reading core/src/provider.ts' },
          { toolName: 'grep', intent: 'Searching for provider.id branches' },
          { toolName: 'edit', intent: 'Editing server/src/cli.ts' },
          { toolName: 'bash', intent: 'Running npm run test:server' },
        ],
      },
    ],
    [
      'pane-shop-api',
      {
        pane: ompPane(
          'pane-shop-api',
          'ws-shop',
          'Add the refunds endpoint',
          session('shop-api'),
          'tab-api',
        ),
        tools: [
          { toolName: 'edit', intent: 'Editing routes/refunds.ts' },
          { toolName: 'bash', intent: 'Running go test ./...' },
          { toolName: 'write', intent: 'Writing refunds_test.go' },
        ],
      },
    ],
    [
      'pane-shop-web',
      {
        pane: ompPane(
          'pane-shop-web',
          'ws-shop',
          'Fix the checkout layout',
          session('shop-web'),
          'tab-web',
        ),
        tools: [
          { toolName: 'read', intent: 'Reading Checkout.tsx' },
          { toolName: 'edit', intent: 'Editing Checkout.tsx' },
          { toolName: 'webfetch', intent: 'Fetching the design spec' },
        ],
      },
    ],
    [
      'pane-docs',
      {
        pane: ompPane('pane-docs', 'ws-docs', 'Rewrite the README', session('docs')),
        tools: [
          { toolName: 'read', intent: 'Reading README.md' },
          { toolName: 'write', intent: 'Writing README.md' },
        ],
      },
    ],
  ]);

  const fakeHerdr = await startFakeHerdrServer(tmpHome);
  const standalone = await launchStandalone(page, {
    homeDir: tmpHome,
    workspaceDir,
    provider: 'herdr',
  });
  const scene = new Scene(fakeHerdr, agents);

  async function playTicks(count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      scene.tick();
      await page.waitForTimeout(TOOL_INTERVAL_MS);
    }
  }

  try {
    fakeHerdr.setWorkspaces(WORKSPACES);
    fakeHerdr.setTabs(TABS);
    agents.get('pane-docs')!.pane.agent_status = 'idle';
    scene.publish();
    await expectOverlayCount(page, agents.size);
    // Let every character walk to its seat before the footage starts.
    await page.waitForTimeout(SETTLE_MS);
    scene.tick();
    await page.waitForTimeout(SETTLE_MS);

    const startedAt = Date.now();
    await playTicks(2);

    scene.setStatus('pane-shop-api', 'blocked');
    await playTicks(2);

    agents.set('pane-infra', {
      pane: ompPane('pane-infra', 'ws-infra', 'Rotate the TLS certificates', session('infra')),
      tools: [
        { toolName: 'bash', intent: 'Running kubectl get certificates' },
        { toolName: 'read', intent: 'Reading cert-manager values' },
      ],
    });
    scene.publish();
    await playTicks(2);

    scene.setStatus('pane-terrarium', 'blocked');
    scene.setStatus('pane-docs', 'working');
    await playTicks(2);

    scene.setStatus('pane-shop-api', 'working');
    scene.setStatus('pane-shop-web', 'idle');
    await playTicks(3);

    const trim = {
      startSeconds: (startedAt - videoStartedAt) / 1000,
      durationSeconds: (Date.now() - startedAt) / 1000,
    };
    fs.writeFileSync(test.info().outputPath('trim.json'), JSON.stringify(trim));
  } finally {
    await standalone.cleanup();
    await fakeHerdr.stop();
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  }
});
