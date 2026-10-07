#!/usr/bin/env node
/**
 * Record the README demo: play the scripted herdr session in e2e/demo against
 * the built standalone server, then convert the Playwright video to
 * docs/media/demo.gif. Requires `npm run compile` first and ffmpeg on PATH.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLAYWRIGHT_CLI = path.join(REPO_ROOT, 'node_modules', 'playwright', 'cli.js');
const RESULTS_DIR = path.join(REPO_ROOT, 'test-results', 'demo');
const OUTPUT_GIF = path.join(REPO_ROOT, 'docs', 'media', 'demo.gif');
const GIF_FPS = 10;
const GIF_WIDTH_PX = 960;
const GIF_MAX_COLORS = 128;

function findFile(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(entryPath, name);
      if (found) return found;
    } else if (entry.name === name) {
      return entryPath;
    }
  }
  return null;
}

fs.rmSync(RESULTS_DIR, { recursive: true, force: true });
execFileSync(process.execPath, [PLAYWRIGHT_CLI, 'test', '--config=e2e/demo/playwright.config.ts'], {
  cwd: REPO_ROOT,
  stdio: 'inherit',
});

const video = findFile(RESULTS_DIR, 'video.webm');
const trimFile = findFile(RESULTS_DIR, 'trim.json');
if (!video || !trimFile) {
  throw new Error(`No video.webm or trim.json under ${RESULTS_DIR}`);
}
const { startSeconds, durationSeconds } = JSON.parse(fs.readFileSync(trimFile, 'utf8'));

fs.mkdirSync(path.dirname(OUTPUT_GIF), { recursive: true });
// Playwright's VP8 video carries compression noise that changes every pixel every frame. Denoising first, then
// diff_mode=rectangle, lets the GIF re-encode only what moved. Together they cut the file by about 30%.
const filter =
  `hqdn3d=8:8:12:12,fps=${GIF_FPS},scale=${GIF_WIDTH_PX}:-1:flags=neighbor,split[a][b];` +
  `[a]palettegen=stats_mode=diff:max_colors=${GIF_MAX_COLORS}[p];` +
  '[b][p]paletteuse=dither=none:diff_mode=rectangle';
execFileSync(
  'ffmpeg',
  [
    '-y',
    '-ss',
    String(startSeconds),
    '-t',
    String(durationSeconds),
    '-i',
    video,
    '-filter_complex',
    filter,
    '-loop',
    '0',
    OUTPUT_GIF,
  ],
  { stdio: 'inherit' },
);

const sizeMiB = fs.statSync(OUTPUT_GIF).size / (1024 * 1024);
console.log(`Wrote ${path.relative(REPO_ROOT, OUTPUT_GIF)} (${sizeMiB.toFixed(1)} MiB)`);
