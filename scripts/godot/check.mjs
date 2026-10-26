#!/usr/bin/env node
/**
 * `npm run godot:check`: loads the built Godot export through the real server
 * in Chromium and fails unless it stays inside its budget: no console error
 * or warning, the grid drawn, every response compressed, and the payload and
 * first frame under their limits. Needs `npm run build` and
 * `npm run godot:export` first.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const CLI = path.join(REPO_ROOT, 'dist', 'cli.js');
const EXPORT_DIR = path.join(REPO_ROOT, 'dist', 'godot');
const ROUTE = '/godot/';
const FIRST_FRAME_MARK = 'terrarium:first-frame';
const MAX_PAYLOAD_BYTES = 25 * 1000 * 1000;
const MAX_FIRST_FRAME_MS = 4000;
const LOAD_TIMEOUT_MS = 30_000;
/** How long the page runs after its first frame before its console is judged. */
const SETTLE_MS = 2000;
const SERVER_START_TIMEOUT_MS = 15_000;
/** IsoGrid.LINE_COLOR as 8-bit RGB. */
const GRID_LINE_RGB = [84, 93, 113];
const GRID_LINE_TOLERANCE = 24;
const MIN_GRID_PIXELS = 1000;
/**
 * WebGL through SwiftShader, on every machine. A CI runner has no GPU and
 * lands there anyway. On a GPU, headless Chromium reads every WebGL frame
 * back for its own compositor, and the driver reports that as "GPU stall due
 * to ReadPixels" warnings a headed browser never shows (the current client at
 * `/` gets them too). `--enable-unsafe-swiftshader` opts in to SwiftShader
 * explicitly, so Chromium does not warn about an automatic software fallback.
 */
const CHROMIUM_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
/** The LAN the first-frame budget is stated for: 100 Mbit/s Ethernet, 2 ms round trip. */
const LAN_BYTES_PER_SECOND = (100 * 1000 * 1000) / 8;
const LAN_LATENCY_MS = 2;

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function startServer(port, home) {
  const child = spawn(process.execPath, [CLI, '--port', String(port), '--provider', 'omp'], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early:\n${output}`);
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return child;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  child.kill();
  throw new Error(
    `server did not answer /api/health within ${SERVER_START_TIMEOUT_MS} ms:\n${output}`,
  );
}

function countGridPixels(screenshot) {
  const png = PNG.sync.read(screenshot);
  let count = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const close = GRID_LINE_RGB.every(
      (value, c) => Math.abs(png.data[i + c] - value) <= GRID_LINE_TOLERANCE,
    );
    if (close) count++;
  }
  return count;
}

async function measure(url) {
  const browser = await chromium.launch({ args: CHROMIUM_ARGS });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: LAN_LATENCY_MS,
      downloadThroughput: LAN_BYTES_PER_SECOND,
      uploadThroughput: LAN_BYTES_PER_SECOND,
    });
    const consoleProblems = [];
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') {
        consoleProblems.push(`${message.type()}: ${message.text()}`);
      }
    });
    page.on('pageerror', (error) => consoleProblems.push(`pageerror: ${error.message}`));
    const responses = [];
    page.on('response', (response) => responses.push(response));

    await page.goto(url);
    const firstFrameMs = await page
      .waitForFunction(
        (mark) => performance.getEntriesByName(mark)[0]?.startTime,
        FIRST_FRAME_MARK,
        { timeout: LOAD_TIMEOUT_MS },
      )
      .then((handle) => handle.jsonValue())
      .catch((error) => {
        if (error.name !== 'TimeoutError') throw error;
        return Number.POSITIVE_INFINITY;
      });
    await page.waitForTimeout(SETTLE_MS);
    // Capturing a WebGL canvas reads its pixels back, which Chromium reports
    // as a "GPU stall due to ReadPixels" driver warning. That comes from this
    // check, not the page, so the console is judged before the capture.
    const pageConsoleProblems = [...consoleProblems];
    const gridPixels = countGridPixels(await page.locator('canvas').screenshot());

    const transfers = [];
    for (const response of responses) {
      const sizes = await response.request().sizes();
      const headers = await response.allHeaders();
      transfers.push({
        file: new URL(response.url()).pathname,
        status: response.status(),
        bytes: sizes.responseBodySize,
        type: headers['content-type'] ?? '',
        encoding: headers['content-encoding'] ?? '',
      });
    }
    return { consoleProblems: pageConsoleProblems, firstFrameMs, gridPixels, transfers };
  } finally {
    await browser.close();
  }
}

function evaluate({ consoleProblems, firstFrameMs, gridPixels, transfers }) {
  const failures = [];
  for (const problem of consoleProblems) failures.push(`console ${problem}`);
  if (gridPixels < MIN_GRID_PIXELS) {
    failures.push(
      `grid not drawn: ${gridPixels} grid-coloured pixels, expected at least ${MIN_GRID_PIXELS}`,
    );
  }
  if (firstFrameMs >= MAX_FIRST_FRAME_MS) {
    failures.push(`first frame at ${Math.round(firstFrameMs)} ms, budget ${MAX_FIRST_FRAME_MS} ms`);
  }
  const payload = transfers.reduce((sum, t) => sum + t.bytes, 0);
  if (payload >= MAX_PAYLOAD_BYTES)
    failures.push(`payload ${payload} bytes, budget ${MAX_PAYLOAD_BYTES}`);
  for (const t of transfers) {
    if (t.status !== 200) failures.push(`${t.file}: HTTP ${t.status}`);
    if (/\.(html|js|wasm|pck)$|\/$/.test(t.file) && !t.encoding)
      failures.push(`${t.file}: sent uncompressed`);
  }
  const wasm = transfers.find((t) => t.file.endsWith('.wasm'));
  if (!wasm) failures.push('index.wasm was never fetched');
  else if (!wasm.type.startsWith('application/wasm'))
    failures.push(`index.wasm: Content-Type ${wasm.type}`);

  for (const t of transfers) {
    console.log(
      `[godot:check] ${t.file.padEnd(42)} ${String(t.bytes).padStart(9)} B  ${t.encoding || '-'}  ${t.type}`,
    );
  }
  console.log(
    `[godot:check] payload ${(payload / 1e6).toFixed(2)} MB of ${MAX_PAYLOAD_BYTES / 1e6} MB`,
  );
  console.log(
    `[godot:check] first frame ${Math.round(firstFrameMs)} ms of ${MAX_FIRST_FRAME_MS} ms`,
  );
  console.log(`[godot:check] grid pixels ${gridPixels}`);
  return failures;
}

if (!fs.existsSync(CLI) || !fs.existsSync(path.join(EXPORT_DIR, 'index.html'))) {
  console.error('[godot:check] run `npm run build` and `npm run godot:export` first');
  process.exit(1);
}

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'terrarium-godot-check-'));
let server;
let failures;
try {
  const port = await freePort();
  server = await startServer(port, home);
  failures = evaluate(await measure(`http://127.0.0.1:${port}${ROUTE}`));
} finally {
  server?.kill();
  fs.rmSync(home, { recursive: true, force: true });
}
if (failures.length > 0) {
  for (const failure of failures) console.error(`[godot:check] FAIL ${failure}`);
  process.exit(1);
}
console.log('[godot:check] OK');
