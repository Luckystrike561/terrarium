import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { expect, type Page } from '@playwright/test';

import { type HookServerConfig, waitForHookServer } from './hooks';
import { applyMockHomeEnv } from './mock-claude';

const REPO_ROOT = path.join(__dirname, '../..');
const STANDALONE_CLI = path.resolve(REPO_ROOT, 'dist', 'cli.js');
const MOCK_CLAUDE_PATH = path.join(REPO_ROOT, 'e2e/fixtures/mock-claude');
const MOCK_CLAUDE_CMD_PATH = path.join(REPO_ROOT, 'e2e/fixtures/mock-claude.cmd');
const MOCK_CLAUDE_RUNNER_PATH = path.join(REPO_ROOT, 'e2e/fixtures/mock-claude-runner.cjs');
const IS_WINDOWS = process.platform === 'win32';

export interface RecordedServerMessage {
  type: string;
  [key: string]: unknown;
}

export interface StandaloneSession {
  tmpHome: string;
  workspaceDir: string;
  /** Invocation log the mock `claude` appends one `session-id=<id>` line to per run. */
  mockLogFile: string;
  hostUrl: string;
  hookServerConfig: HookServerConfig;
  getHostLogs: () => string;
  cleanup: () => Promise<void>;
  drainMessages: () => Promise<RecordedServerMessage[]>;
  /** Stop the host process, breaking its WebSocket connections, without disposing
   *  the browser page or its recorded message buffer. Fallback for tests that need
   *  to observe a real connection drop when `context.setOffline` does not reliably
   *  close an already-open WebSocket (Chromium-version dependent). */
  stopHost: () => Promise<void>;
  /** Restart the host on the SAME port after `stopHost`, so the already-connected
   *  browser page's exponential-backoff retry succeeds again. */
  startHost: () => Promise<void>;
  /** Reload the SPA and wait until the office is interactive again (the
   *  standalone counterpart of closing and reopening the panel). */
  reloadPage: () => Promise<void>;
}

export interface LaunchStandaloneOptions {
  /** Reuse an existing isolated HOME (for multi-server tests). A supplied
   *  directory is never removed by standalone cleanup, and its mock `claude`
   *  lives in the `bin/` sibling of that HOME. */
  homeDir?: string;
  /** Reuse an existing workspace. A supplied directory is never removed by
   *  standalone cleanup. */
  workspaceDir?: string;
  /** Pre-seed a granted Claude hooksConsent entry so the first-run dialog never
   *  covers the office (default). The consent specs opt out with `false` —
   *  they are the only ones that want the dialog. Ignored when `seedConfig` is
   *  given. Never overwrites a config.json that already exists (a shared HOME
   *  was seeded by its owner). */
  seedHooksConsent?: boolean;
  /** Full `~/.pixel-agents/config.json` to seed instead of the baseline. */
  seedConfig?: unknown;
  /** `~/.pixel-agents/layout.json` to seed. The server serves it verbatim
   *  whenever the file exists and never resets it by revision. */
  seedLayout?: unknown;
  /** `~/.claude/settings.json` to seed before the server starts. A string is
   *  written verbatim so a spec can seed a deliberately unparseable file. */
  seedClaudeSettings?: unknown;
  /** Provider modules forwarded as `--provider <ids>` (comma-separated, default: the CLI's own default, 'claude').
   *  Herdr specs pass 'herdr' (or 'herdr,omp') so the standalone host connects to a local Herdr socket instead of
   *  installing Claude hooks. */
  provider?: string;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to allocate a free port'));
        return;
      }
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
  });
}

async function waitForHttpOk(url: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      lastError = new Error(`GET ${url} returned ${response.status.toString()}`);
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw lastError instanceof Error ? lastError : new Error(`Timed out waiting for ${url}`);
}

/**
 * Spawn our standalone CLI (dist/cli.js). The CLI serves both the SPA and the
 * /ws WebSocket on the same port; tests connect Playwright's chromium to that
 * single origin. Workspace dir is communicated via process.cwd() since our CLI
 * doesn't take a --workspace-dir flag.
 */
function spawnStandaloneHost(args: {
  homeDir: string;
  hostPort: number;
  workspaceDir: string;
  mockBinDir: string;
  provider?: string;
}): ChildProcessWithoutNullStreams {
  if (!fs.existsSync(STANDALONE_CLI)) {
    throw new Error(
      `Standalone CLI not built at ${STANDALONE_CLI}. Run 'npm run compile' before e2e tests.`,
    );
  }
  const cliArgs = [STANDALONE_CLI, '--port', args.hostPort.toString(), '--host', '127.0.0.1'];
  if (args.provider) {
    cliArgs.push('--provider', args.provider);
  }
  return spawn(process.execPath, cliArgs, {
    cwd: args.workspaceDir,
    env: {
      ...applyMockHomeEnv(process.env, args.homeDir),
      USERPROFILE: args.homeDir,
      PATH: `${args.mockBinDir}${path.delimiter}${process.env['PATH'] ?? ''}`,
      PIXEL_AGENTS_NODE_BIN: process.execPath,
      // Server-side hook/broadcast timeline, attached to failing tests.
      PIXEL_AGENTS_DEBUG_LOG: path.join(args.homeDir, '.pixel-agents', 'debug.log'),
      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
    },
    stdio: 'pipe',
  });
}

/**
 * Install the mock `claude` into `bin/`, the sibling of the isolated HOME, where
 * spawnExternalClaudeScenario resolves it. The wrapper resolves its runner
 * relative to its own directory, so both must live there.
 */
function installMockClaude(mockBinDir: string): void {
  fs.mkdirSync(mockBinDir, { recursive: true });
  fs.copyFileSync(MOCK_CLAUDE_RUNNER_PATH, path.join(mockBinDir, 'mock-claude-runner.cjs'));
  if (IS_WINDOWS) {
    fs.copyFileSync(MOCK_CLAUDE_CMD_PATH, path.join(mockBinDir, 'claude.cmd'));
    return;
  }
  const binary = path.join(mockBinDir, 'claude');
  fs.copyFileSync(MOCK_CLAUDE_PATH, binary);
  fs.chmodSync(binary, 0o755);
}

/**
 * Seed the isolated HOME before the server reads it. By default, grants the
 * Claude consent so the first-run Intro does not cover the office.
 */
function seedHome(tmpHome: string, options: LaunchStandaloneOptions): void {
  const paDir = path.join(tmpHome, '.pixel-agents');
  fs.mkdirSync(paDir, { recursive: true });
  const configPath = path.join(paDir, 'config.json');
  if (!fs.existsSync(configPath)) {
    const seedConfig = options.seedConfig ?? {
      ...((options.seedHooksConsent ?? true) ? { hooksConsent: { claude: 'granted' } } : {}),
    };
    fs.writeFileSync(configPath, JSON.stringify(seedConfig, null, 2));
  }
  if (options.seedLayout !== undefined) {
    fs.writeFileSync(path.join(paDir, 'layout.json'), JSON.stringify(options.seedLayout, null, 2));
  }
  if (options.seedClaudeSettings !== undefined) {
    const claudeDir = path.join(tmpHome, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(
      path.join(claudeDir, 'settings.json'),
      typeof options.seedClaudeSettings === 'string'
        ? options.seedClaudeSettings
        : JSON.stringify(options.seedClaudeSettings, null, 2),
    );
  }
}

/** Real Claude Code reads its team-mode switch from the workspace's
 *  settings.local.json; the mock reads the same file. */
function seedWorkspace(workspaceDir: string): void {
  const claudeDir = path.join(workspaceDir, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(
    path.join(claudeDir, 'settings.local.json'),
    JSON.stringify({ env: { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' } }, null, 2),
  );
}

async function stopProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.killed) {
    return;
  }
  child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    delay(2_000),
  ]);
  if (child.exitCode === null && !child.killed) {
    child.kill('SIGKILL');
    await Promise.race([
      new Promise<void>((resolve) => child.once('exit', () => resolve())),
      delay(1_000),
    ]);
  }
}

/**
 * Install a WebSocket recorder BEFORE page navigation. Proxies window.WebSocket
 * so every incoming message frame is JSON-parsed and pushed to
 * window.__pixelAgentsMessages, which drainMessages() reads from.
 */
async function installMessageRecorder(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const recordedMessages: unknown[] = [];
    const OriginalWebSocket = window.WebSocket;
    const RecordingWebSocket = new Proxy(OriginalWebSocket, {
      construct(target, args) {
        const socket = Reflect.construct(target, args) as WebSocket;
        socket.addEventListener('message', (event) => {
          if (typeof event.data !== 'string') {
            return;
          }
          try {
            recordedMessages.push(JSON.parse(event.data));
          } catch {
            // Ignore non-JSON frames.
          }
        });
        return socket;
      },
    });
    window.WebSocket = RecordingWebSocket as typeof WebSocket;
    (window as Window & { __pixelAgentsMessages?: unknown[] }).__pixelAgentsMessages =
      recordedMessages;
  });
}

async function drainRecordedMessages(page: Page): Promise<RecordedServerMessage[]> {
  return await page.evaluate(() => {
    const store = (window as Window & { __pixelAgentsMessages?: unknown[] }).__pixelAgentsMessages;
    if (!Array.isArray(store)) {
      return [];
    }
    const drained = store.slice();
    store.length = 0;
    return drained as RecordedServerMessage[];
  });
}

/** The trailing `\s` is load-bearing: stdout arrives in chunks, and without a
 *  terminator a half-delivered line would match and yield a truncated URL that
 *  still parses (`http://127.0.0.1:501`). */
const PRINTED_URL_PATTERN = /Pixel Agents server running at (\S+)\s/;

/**
 * Wait for the URL line the CLI prints on its own stdout, and hand back exactly
 * that string.
 *
 * That printed line is the ONLY channel by which a real operator's browser
 * obtains the server token — the token is what makes the session privileged
 * enough to approve a hook install (the SPA forwards it on the /ws handshake,
 * server/src/httpServer.ts standaloneTokenValid). Reading the token out of
 * `~/.pixel-agents/server.json` and synthesizing an equivalent URL, which this
 * fixture used to do, is the fixture handing ITSELF a capability no browser can
 * reach: the whole standalone suite then stays green over a CLI that prints a
 * bare, wrong-tokened, or unbrowsable URL, and every real user lands in a
 * read-only session whose hooks toggle is silently refused.
 */
async function waitForPrintedUrl(readOutput: () => string): Promise<string> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const printed = PRINTED_URL_PATTERN.exec(readOutput())?.[1];
    if (printed) {
      return printed;
    }
    await delay(100);
  }
  throw new Error(`The CLI never printed its server URL:\n${readOutput()}`);
}

/** Open the SPA the way the operator does: by pasting in the URL the CLI printed. */
async function openStandalonePage(page: Page, printedUrl: string): Promise<void> {
  await page.goto(printedUrl);
  await expect(page.locator('canvas')).toBeVisible({ timeout: 30_000 });
}

export async function launchStandalone(
  page: Page,
  options: LaunchStandaloneOptions = {},
): Promise<StandaloneSession> {
  const ownsHome = options.homeDir === undefined;
  const ownsWorkspace = options.workspaceDir === undefined;
  const tmpBase = ownsHome ? fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-e2e-')) : undefined;
  const tmpHome = options.homeDir ?? path.join(tmpBase!, 'home');
  const mockBinDir = path.resolve(tmpHome, '..', 'bin');
  const workspaceDirRaw = options.workspaceDir ?? path.join(tmpBase ?? tmpHome, 'workspace');
  fs.mkdirSync(tmpHome, { recursive: true });
  fs.mkdirSync(workspaceDirRaw, { recursive: true });
  // The mock `claude` hashes `process.cwd()` into its project dir and the server
  // hashes its own cwd the same way, so both must see one canonical path:
  // Windows `os.tmpdir()` can be an 8.3 short name and macOS's lives behind the
  // `/var` -> `/private/var` symlink.
  const workspaceDir =
    IS_WINDOWS || process.platform === 'darwin'
      ? fs.realpathSync.native(workspaceDirRaw)
      : workspaceDirRaw;
  seedHome(tmpHome, options);
  seedWorkspace(workspaceDir);
  installMockClaude(mockBinDir);
  const mockLogFile = path.join(tmpHome, '.claude-mock', 'invocations.log');
  const hostPort = await getFreePort();
  const hostUrl = `http://127.0.0.1:${hostPort}`;

  let hostStdout = '';
  let hostStderr = '';
  function spawnAndAttach(): ChildProcessWithoutNullStreams {
    const proc = spawnStandaloneHost({
      homeDir: tmpHome,
      hostPort,
      workspaceDir,
      mockBinDir,
      provider: options.provider,
    });
    proc.stdout.on('data', (chunk) => {
      hostStdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk) => {
      hostStderr += chunk.toString();
    });
    return proc;
  }
  let hostProcess = spawnAndAttach();

  function removeOwnedDirs(): void {
    if (tmpBase) fs.rmSync(tmpBase, { recursive: true, force: true });
    if (ownsWorkspace && !tmpBase) fs.rmSync(workspaceDir, { recursive: true, force: true });
  }

  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    // Mark this as the e2e harness before navigation so the standalone webview
    // installs its test-only observability hooks (window.__pixelAgentsTestHooks).
    await page.addInitScript(() => {
      (window as unknown as { __PIXEL_AGENTS_E2E?: boolean }).__PIXEL_AGENTS_E2E = true;
    });
    await installMessageRecorder(page);
    await waitForHttpOk(`${hostUrl}/api/health`);
    // The hook-endpoint Bearer token is a different channel and legitimately
    // read from the registry — that is where the real hook script reads it too.
    // The BROWSER's capability may only come from the printed URL below.
    const hookServerConfig = await waitForHookServer(tmpHome);
    await openStandalonePage(page, await waitForPrintedUrl(() => hostStdout));
    await drainRecordedMessages(page);

    return {
      tmpHome,
      workspaceDir,
      mockLogFile,
      hostUrl,
      hookServerConfig,
      getHostLogs: () =>
        [hostStdout.trim(), hostStderr.trim()].filter((value) => value.length > 0).join('\n'),
      drainMessages: () => drainRecordedMessages(page),
      stopHost: async () => {
        await stopProcess(hostProcess);
      },
      startHost: async () => {
        hostProcess = spawnAndAttach();
        await waitForHttpOk(`${hostUrl}/api/health`);
      },
      reloadPage: async () => {
        await page.reload();
        await expect(page.locator('canvas')).toBeVisible({
          timeout: 30_000,
        });
      },
      cleanup: async () => {
        await stopProcess(hostProcess);
        removeOwnedDirs();
      },
    };
  } catch (error) {
    await stopProcess(hostProcess);
    removeOwnedDirs();
    throw error;
  }
}
