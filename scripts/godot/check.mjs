#!/usr/bin/env -S npx tsx
/**
 * `npm run godot:check`: loads the built Godot export through the real server
 * in Chromium and fails unless it stays inside its budget (no console error
 * or warning, every response compressed, the payload and first frame under
 * their limits) and draws the same office as the current client: every frame
 * it shows, at the fitted view, at each zoom step and panned to the office
 * edges, must equal the current client's office rasterised by
 * officeReference.ts, every office pixel a whole block of screen pixels.
 * Needs `npm run build` and `npm run godot:export` first.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';

import {
  boundsRect,
  centeredPan,
  clampPan,
  contentBounds,
  fitZoom,
  gridRect,
  mapOffset,
} from '../../webview-ui/src/office/projection.js';
import { everyFurnitureLayout } from './everyFurnitureLayout.mjs';
import { loadReferenceOffice } from './officeReference.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const DIST_ROOT = path.join(REPO_ROOT, 'dist');
const CLI = path.join(DIST_ROOT, 'cli.js');
const EXPORT_DIR = path.join(DIST_ROOT, 'godot');
const MANIFEST = path.join(DIST_ROOT, 'assets', 'office-manifest.json');
const ROUTE = '/godot/';
const FIRST_FRAME_MARK = 'terrarium:first-frame';
/** office.gd's VIEW_HOOK: the zoom and the pixel the office's iso origin sits on. */
const VIEW_HOOK = '__terrariumGodot';
const MAX_PAYLOAD_BYTES = 25 * 1000 * 1000;
const MAX_FIRST_FRAME_MS = 4000;
const LOAD_TIMEOUT_MS = 30_000;
const VIEW_TIMEOUT_MS = 5000;
/** How long the page runs after its first frame before its console is judged. */
const SETTLE_MS = 2000;
const SERVER_START_TIMEOUT_MS = 15_000;
/**
 * WebGL through SwiftShader, on every machine. A CI runner has no GPU and
 * falls back to it anyway, and headless Chromium on a GPU reads each WebGL
 * frame back, which the driver logs as "GPU stall due to ReadPixels". The
 * flags ask for SwiftShader explicitly, so Chromium does not warn about an
 * automatic software fallback.
 */
const CHROMIUM_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
/** The Godot project's fixed frame and its clear colour (project.godot). */
const GODOT_FRAME = { width: 640, height: 360 };
const CLEAR_COLOR = [20, 22, 28, 255];
/** office_camera.gd's ZOOM_MIN and ZOOM_MAX. */
const GODOT_ZOOM_MIN = 1;
const GODOT_ZOOM_MAX = 4;
/** Twice the Godot frame, so integer scaling fills it with no letterbox. */
const STRETCH = 2;
const BROWSER_VIEWPORT = {
  width: GODOT_FRAME.width * STRETCH,
  height: GODOT_FRAME.height * STRETCH,
};
/** Blending a translucent pixel rounds once in WebGL and once in the reference. */
const CHANNEL_TOLERANCE = 2;
/** A drag past any office edge, in browser px, and one of an odd number of half Godot pixels. */
const FAR_DRAG_PX = 4000;
const ODD_DRAG_PX = 7;
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

/** Runs `scenario` against a server whose ~/.terrarium/layout.json is `layout` (none when null). */
async function withServer(layout, scenario) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'terrarium-godot-check-'));
  let server;
  try {
    if (layout) {
      fs.mkdirSync(path.join(home, '.terrarium'));
      fs.writeFileSync(path.join(home, '.terrarium', 'layout.json'), JSON.stringify(layout));
    }
    const port = await freePort();
    server = await startServer(port, home);
    return await scenario(`http://127.0.0.1:${port}${ROUTE}`);
  } finally {
    server?.kill();
    fs.rmSync(home, { recursive: true, force: true });
  }
}

async function openOffice(browser, url, { throttled }) {
  const page = await browser.newPage({ viewport: BROWSER_VIEWPORT });
  if (throttled) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: LAN_LATENCY_MS,
      downloadThroughput: LAN_BYTES_PER_SECOND,
      uploadThroughput: LAN_BYTES_PER_SECOND,
    });
  }
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
    .waitForFunction((mark) => performance.getEntriesByName(mark)[0]?.startTime, FIRST_FRAME_MARK, {
      timeout: LOAD_TIMEOUT_MS,
    })
    .then((handle) => handle.jsonValue())
    .catch((error) => {
      if (error.name !== 'TimeoutError') throw error;
      return Number.POSITIVE_INFINITY;
    });
  await page.waitForTimeout(SETTLE_MS);
  // Capturing a WebGL canvas reads its pixels back, which Chromium reports
  // as a "GPU stall due to ReadPixels" driver warning. That comes from this
  // check, not the page, so the console is judged before the first capture.
  return { page, consoleProblems: [...consoleProblems], responses, firstFrameMs };
}

async function transfersOf(responses) {
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
  return transfers;
}

function budgetFailures({ consoleProblems, firstFrameMs, transfers }) {
  const failures = consoleProblems.map((problem) => `console ${problem}`);
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
  return failures;
}

/** The camera geometry the current client derives for a layout, in Godot frame pixels. */
function viewGeometry(layout) {
  return { grid: gridRect(layout), view: boundsRect(contentBounds(layout)) };
}

function readView(page) {
  return page.evaluate((hook) => window[hook] ?? null, VIEW_HOOK);
}

/** Waits until the published view satisfies `accept`, then two more frames so the canvas shows it. */
async function settledView(page, accept, description) {
  const deadline = Date.now() + VIEW_TIMEOUT_MS;
  let view = await readView(page);
  while (!(view && accept(view))) {
    if (Date.now() > deadline) {
      throw new Error(`${description}: view stayed ${JSON.stringify(view)}`);
    }
    await page.waitForTimeout(50);
    view = await readView(page);
  }
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  return view;
}

const sameView = (a, b) => a.zoom === b.zoom && a.offsetX === b.offsetX && a.offsetY === b.offsetY;

async function drag(page, dx, dy) {
  const start = { x: BROWSER_VIEWPORT.width / 2, y: BROWSER_VIEWPORT.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 4 });
  await page.mouse.up();
}

/**
 * Compares the canvas with the reference office at `view`. Every Godot frame
 * pixel must be one uniform STRETCH × STRETCH block on screen (no filtering,
 * no half-pixel offset) and within CHANNEL_TOLERANCE of the reference.
 */
async function compareFrame(page, reference, view, label) {
  const shot = PNG.sync.read(await page.locator('canvas').screenshot());
  if (shot.width !== BROWSER_VIEWPORT.width || shot.height !== BROWSER_VIEWPORT.height) {
    return [
      `${label}: the canvas is ${shot.width} × ${shot.height}, not ${BROWSER_VIEWPORT.width} × ${BROWSER_VIEWPORT.height}`,
    ];
  }
  const expected = reference.render({ ...view, ...GODOT_FRAME, background: CLEAR_COLOR });
  let blurred = 0;
  let mismatched = 0;
  const actual = new PNG(GODOT_FRAME);
  for (let y = 0; y < GODOT_FRAME.height; y++) {
    for (let x = 0; x < GODOT_FRAME.width; x++) {
      const corner = (y * STRETCH * shot.width + x * STRETCH) * 4;
      for (let dy = 0; dy < STRETCH; dy++) {
        for (let dx = 0; dx < STRETCH; dx++) {
          const i = ((y * STRETCH + dy) * shot.width + x * STRETCH + dx) * 4;
          if ([0, 1, 2].some((k) => shot.data[i + k] !== shot.data[corner + k])) blurred++;
        }
      }
      const j = (y * GODOT_FRAME.width + x) * 4;
      for (let k = 0; k < 4; k++) actual.data[j + k] = k === 3 ? 255 : shot.data[corner + k];
      if (
        [0, 1, 2].some(
          (k) => Math.abs(shot.data[corner + k] - expected.data[j + k]) > CHANNEL_TOLERANCE,
        )
      ) {
        mismatched++;
      }
    }
  }
  console.log(
    `[godot:check] ${label}: zoom ${view.zoom}, origin (${view.offsetX}, ${view.offsetY}), ${mismatched} pixels off the current client, ${blurred} blurred`,
  );
  if (mismatched === 0 && blurred === 0) return [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'terrarium-godot-diff-'));
  const want = new PNG(GODOT_FRAME);
  want.data.set(expected.data);
  fs.writeFileSync(path.join(dir, 'godot.png'), PNG.sync.write(actual));
  fs.writeFileSync(path.join(dir, 'current-client.png'), PNG.sync.write(want));
  return [
    `${label}: ${mismatched} pixels differ from the current client and ${blurred} screen pixels are blurred (frames in ${dir})`,
  ];
}

/**
 * The view one wheel notch from `view` to `zoom` gives with the cursor on
 * `anchor` (browser px): the office point under the cursor stays put, then
 * the current client's clampPan and mapOffset place the map.
 */
function zoomedView(layout, view, anchor, zoom) {
  const { grid, view: rect } = viewGeometry(layout);
  const cursor = { x: anchor.x / STRETCH, y: anchor.y / STRETCH };
  const point = {
    x: (cursor.x - view.offsetX) / view.zoom,
    y: (cursor.y - view.offsetY) / view.zoom,
  };
  const base = mapOffset(GODOT_FRAME.width, GODOT_FRAME.height, grid, zoom, 0, 0);
  const pan = clampPan(
    { x: cursor.x - point.x * zoom - base.offsetX, y: cursor.y - point.y * zoom - base.offsetY },
    grid,
    rect,
    zoom,
    GODOT_FRAME.width,
    GODOT_FRAME.height,
  );
  const { offsetX, offsetY } = mapOffset(
    GODOT_FRAME.width,
    GODOT_FRAME.height,
    grid,
    zoom,
    pan.x,
    pan.y,
  );
  return { zoom, offsetX, offsetY };
}

/** The view the current client's clampPan gives a drag far past the office edge in `direction`. */
function edgeView(layout, zoom, direction) {
  const { grid, view } = viewGeometry(layout);
  const far = {
    x: direction.x * Number.MAX_SAFE_INTEGER,
    y: direction.y * Number.MAX_SAFE_INTEGER,
  };
  const pan = clampPan(far, grid, view, zoom, GODOT_FRAME.width, GODOT_FRAME.height);
  const { offsetX, offsetY } = mapOffset(
    GODOT_FRAME.width,
    GODOT_FRAME.height,
    grid,
    zoom,
    pan.x,
    pan.y,
  );
  return { zoom, offsetX, offsetY };
}

/**
 * The view the current client's clampPan gives `view` dragged by (dx, dy)
 * browser px. `view`'s pan must be whole, as it is at an office edge.
 */
function draggedView(layout, view, dx, dy) {
  const { grid, view: rect } = viewGeometry(layout);
  const base = mapOffset(GODOT_FRAME.width, GODOT_FRAME.height, grid, view.zoom, 0, 0);
  const pan = clampPan(
    {
      x: view.offsetX - base.offsetX + dx / STRETCH,
      y: view.offsetY - base.offsetY + dy / STRETCH,
    },
    grid,
    rect,
    view.zoom,
    GODOT_FRAME.width,
    GODOT_FRAME.height,
  );
  const { offsetX, offsetY } = mapOffset(
    GODOT_FRAME.width,
    GODOT_FRAME.height,
    grid,
    view.zoom,
    pan.x,
    pan.y,
  );
  return { zoom: view.zoom, offsetX, offsetY };
}

/** Drags the office as far as it goes in each diagonal and compares every edge view. */
async function checkEdges(page, reference, layout, zoom, label) {
  const failures = [];
  for (const direction of [
    { x: 1, y: 1 },
    { x: -1, y: 1 },
    { x: -1, y: -1 },
    { x: 1, y: -1 },
  ]) {
    const expected = edgeView(layout, zoom, direction);
    const name = `${label} dragged to (${direction.x}, ${direction.y})`;
    await drag(page, direction.x * FAR_DRAG_PX, direction.y * FAR_DRAG_PX);
    try {
      const view = await settledView(
        page,
        (v) => sameView(v, expected),
        `${name}, expected ${JSON.stringify(expected)}`,
      );
      failures.push(...(await compareFrame(page, reference, view, name)));
    } catch (error) {
      failures.push(error.message);
    }
  }
  return failures;
}

/** The fitted view the current client would centre: the largest whole zoom that fits, at least 1. */
function fittedView(layout) {
  const { grid, view } = viewGeometry(layout);
  const zoom = Math.floor(fitZoom(view, GODOT_FRAME.width, GODOT_FRAME.height));
  const pan = centeredPan(grid, view, zoom, GODOT_FRAME.width, GODOT_FRAME.height);
  const { offsetX, offsetY } = mapOffset(
    GODOT_FRAME.width,
    GODOT_FRAME.height,
    grid,
    zoom,
    pan.x,
    pan.y,
  );
  return { zoom, offsetX, offsetY };
}

async function checkFit(page, reference, layout, label) {
  const expected = fittedView(layout);
  try {
    const view = await settledView(
      page,
      (v) => sameView(v, expected),
      `${label} fit, expected ${JSON.stringify(expected)}`,
    );
    return compareFrame(page, reference, view, `${label} fitted`);
  } catch (error) {
    return [error.message];
  }
}

/**
 * Wheels in one notch at a time to the deepest zoom and back out, comparing
 * every step. The cursor sits off the frame centre, where zooming around it
 * and zooming around the centre give different views.
 */
async function checkZoomSteps(page, reference, layout) {
  const failures = [];
  const anchor = { x: BROWSER_VIEWPORT.width / 4, y: BROWSER_VIEWPORT.height / 4 };
  let view = await readView(page);
  if (view === null) return ['wheel: Godot never published its view'];
  for (const direction of [-1, 1]) {
    for (;;) {
      const before = view;
      await page.mouse.move(anchor.x, anchor.y);
      await page.mouse.wheel(0, direction * 100);
      try {
        view = await settledView(page, (v) => v.zoom !== before.zoom, 'wheel');
      } catch (error) {
        if (!error.message.startsWith('wheel:')) throw error;
        view = before;
        break;
      }
      const label = `wheel ${direction < 0 ? 'in' : 'out'} to zoom ${view.zoom}`;
      const zoomed = zoomedView(layout, before, anchor, before.zoom - direction);
      if (!sameView(view, zoomed)) {
        failures.push(
          `${label}: one notch from ${JSON.stringify(before)} gave ${JSON.stringify(view)}, expected ${JSON.stringify(zoomed)}`,
        );
      }
      failures.push(...(await compareFrame(page, reference, view, label)));
      if (direction < 0 && view.zoom > before.zoom) {
        failures.push(
          ...(await checkEdges(page, reference, layout, view.zoom, `zoom ${view.zoom}`)),
        );
        const cornered = await readView(page);
        const expected = draggedView(layout, cornered, ODD_DRAG_PX, ODD_DRAG_PX);
        const name = `zoom ${view.zoom} after a ${ODD_DRAG_PX} px drag`;
        await drag(page, ODD_DRAG_PX, ODD_DRAG_PX);
        try {
          const dragged = await settledView(
            page,
            (v) => sameView(v, expected),
            `${name}, expected ${JSON.stringify(expected)}`,
          );
          failures.push(...(await compareFrame(page, reference, dragged, name)));
          view = dragged;
        } catch (error) {
          failures.push(error.message);
          view = await readView(page);
        }
      }
    }
    const limit = direction < 0 ? GODOT_ZOOM_MAX : GODOT_ZOOM_MIN;
    if (view.zoom !== limit) {
      failures.push(
        `wheeling ${direction < 0 ? 'in' : 'out'} stopped at zoom ${view.zoom}, not ${limit}`,
      );
    }
  }
  return failures;
}

async function checkDefaultLayout(browser) {
  return withServer(null, async (url) => {
    const office = await openOffice(browser, url, { throttled: true });
    const reference = await loadReferenceOffice(DIST_ROOT, null);
    const layout = JSON.parse(fs.readFileSync(defaultLayoutFile(), 'utf8'));
    return [
      ...budgetFailures({ ...office, transfers: await transfersOf(office.responses) }),
      ...(await checkFit(office.page, reference, layout, 'default layout')),
      ...(await checkZoomSteps(office.page, reference, layout)),
    ];
  });
}

async function checkEveryFurniture(browser) {
  const layout = everyFurnitureLayout(JSON.parse(fs.readFileSync(MANIFEST, 'utf8')));
  return withServer(layout, async (url) => {
    const office = await openOffice(browser, url, { throttled: false });
    const reference = await loadReferenceOffice(DIST_ROOT, layout);
    const failures = office.consoleProblems.map((problem) => `console ${problem}`);
    if (reference.unknownFurniture.length > 0) {
      failures.push(`the current client's catalog lacks ${reference.unknownFurniture.join(', ')}`);
    }
    failures.push(...(await checkFit(office.page, reference, layout, 'every furniture')));
    failures.push(...(await checkEdges(office.page, reference, layout, 1, 'every furniture')));
    return failures;
  });
}

function defaultLayoutFile() {
  const assets = path.join(DIST_ROOT, 'assets');
  const newest = fs
    .readdirSync(assets)
    .map((file) => /^default-layout-(\d+)\.json$/.exec(file))
    .filter(Boolean)
    .sort((a, b) => Number(b[1]) - Number(a[1]))[0];
  return path.join(assets, newest[0]);
}

if (!fs.existsSync(CLI) || !fs.existsSync(path.join(EXPORT_DIR, 'index.html'))) {
  console.error('[godot:check] run `npm run build` and `npm run godot:export` first');
  process.exit(1);
}

const browser = await chromium.launch({ args: CHROMIUM_ARGS });
let failures;
try {
  failures = [...(await checkDefaultLayout(browser)), ...(await checkEveryFurniture(browser))];
} finally {
  await browser.close();
}
if (failures.length > 0) {
  for (const failure of failures) console.error(`[godot:check] FAIL ${failure}`);
  process.exit(1);
}
console.log('[godot:check] OK');
