#!/usr/bin/env node
/**
 * `npm run godot:export`: builds the Godot client's single-threaded web export
 * into dist/godot/ with the pinned Godot release, then writes .br and .gz
 * siblings for the server to serve and records the SHA-256 of every file
 * Godot wrote in godot/web-export.sha256, so a diff there means this run did
 * not reproduce the committed artifact.
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

import { GODOT } from './pin.mjs';
import { bufferSource, httpSource, listEntries, readEntry } from './zip.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const PROJECT_DIR = path.join(REPO_ROOT, 'godot');
const EXPORT_DIR = path.join(REPO_ROOT, 'dist', 'godot');
const CHECKSUM_FILE = path.join(PROJECT_DIR, 'web-export.sha256');
const CACHE_DIR = path.join(REPO_ROOT, '.cache', 'godot', GODOT.version);
const EDITOR_PATH = path.join(CACHE_DIR, 'godot');
/** A `_sc_` file beside the editor binary makes Godot self-contained: it keeps
 *  its settings and templates in `editor_data/` there, never under $HOME. */
const SELF_CONTAINED_MARKER = path.join(CACHE_DIR, '_sc_');
const TEMPLATES_DIR = path.join(
  CACHE_DIR,
  'editor_data',
  'export_templates',
  GODOT.templatesDirName,
);
const EXPORT_PRESET = 'Web';
const PRECOMPRESSED_EXTENSIONS = new Set(['.html', '.js', '.wasm', '.pck']);
/** Their bytes depend on the zlib and Brotli Node was built with, which the checksums must not pin. */
const COMPRESSED_SIBLING_EXTENSIONS = new Set(['.br', '.gz']);

function log(message) {
  console.log(`[godot:export] ${message}`);
}

function hash(algorithm, content) {
  return crypto.createHash(algorithm).update(content).digest('hex');
}

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function editorForThisMachine() {
  const key = `${process.platform}-${process.arch}`;
  const editor = GODOT.editors[key];
  if (!editor) {
    const supported = Object.keys(GODOT.editors).join(', ');
    throw new Error(`no pinned Godot editor for ${key} (supported: ${supported})`);
  }
  return editor;
}

async function ensureEditor() {
  if (fs.existsSync(EDITOR_PATH)) return;
  const editor = editorForThisMachine();
  log(`downloading ${editor.url}`);
  const archive = await download(editor.url);
  const actual = hash('sha512', archive);
  if (actual !== editor.sha512) {
    throw new Error(`${editor.url}: SHA-512 ${actual}, expected ${editor.sha512}`);
  }
  const source = bufferSource(archive);
  const entry = (await listEntries(source)).find((e) => e.name === editor.binary);
  if (!entry) throw new Error(`${editor.url}: no ${editor.binary} inside`);
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(SELF_CONTAINED_MARKER, '');
  fs.writeFileSync(EDITOR_PATH, await readEntry(source, entry), { mode: 0o755 });
}

async function ensureTemplates() {
  const missing = Object.entries(GODOT.templates.members).filter(
    ([member]) => !fs.existsSync(path.join(TEMPLATES_DIR, path.basename(member))),
  );
  if (missing.length === 0) return;
  log(`reading ${missing.map(([member]) => member).join(', ')} from ${GODOT.templates.url}`);
  const source = await httpSource(GODOT.templates.url);
  const entries = await listEntries(source);
  fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
  for (const [member, sha256] of missing) {
    const entry = entries.find((e) => e.name === member);
    if (!entry) throw new Error(`${GODOT.templates.url}: no ${member} inside`);
    const content = await readEntry(source, entry);
    const actual = hash('sha256', content);
    if (actual !== sha256) throw new Error(`${member}: SHA-256 ${actual}, expected ${sha256}`);
    fs.writeFileSync(path.join(TEMPLATES_DIR, path.basename(member)), content);
  }
  fs.writeFileSync(path.join(TEMPLATES_DIR, 'version.txt'), GODOT.templatesDirName);
}

/** Exports from a fresh copy without `.godot/`, so a stale local import cache
 *  can never make this run differ from one on a clean checkout. */
function exportProject() {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'terrarium-godot-'));
  try {
    fs.cpSync(PROJECT_DIR, workDir, {
      recursive: true,
      filter: (src) => path.basename(src) !== '.godot',
    });
    fs.rmSync(EXPORT_DIR, { recursive: true, force: true });
    fs.mkdirSync(EXPORT_DIR, { recursive: true });
    const run = (...args) =>
      execFileSync(EDITOR_PATH, ['--headless', '--path', workDir, ...args], { stdio: 'inherit' });
    log('importing');
    run('--import');
    log('exporting');
    run('--export-release', EXPORT_PRESET, path.join(EXPORT_DIR, 'index.html'));
    for (const file of ['index.html', 'index.wasm', 'index.pck', 'index.js']) {
      if (!fs.existsSync(path.join(EXPORT_DIR, file)))
        throw new Error(`export produced no ${file}`);
    }
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

function precompress() {
  for (const file of fs.readdirSync(EXPORT_DIR)) {
    if (!PRECOMPRESSED_EXTENSIONS.has(path.extname(file))) continue;
    const filePath = path.join(EXPORT_DIR, file);
    const content = fs.readFileSync(filePath);
    fs.writeFileSync(
      `${filePath}.br`,
      zlib.brotliCompressSync(content, {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: content.length,
        },
      }),
    );
    fs.writeFileSync(
      `${filePath}.gz`,
      zlib.gzipSync(content, { level: zlib.constants.Z_BEST_COMPRESSION }),
    );
  }
}

function writeChecksums() {
  const lines = fs
    .readdirSync(EXPORT_DIR)
    .filter((file) => !COMPRESSED_SIBLING_EXTENSIONS.has(path.extname(file)))
    .sort()
    .map((file) => `${hash('sha256', fs.readFileSync(path.join(EXPORT_DIR, file)))}  ${file}`);
  fs.writeFileSync(CHECKSUM_FILE, `${lines.join('\n')}\n`);
  for (const file of fs.readdirSync(EXPORT_DIR).sort()) {
    log(`${file.padEnd(36)} ${fs.statSync(path.join(EXPORT_DIR, file)).size} bytes`);
  }
}

try {
  await ensureEditor();
  await ensureTemplates();
  exportProject();
  precompress();
  writeChecksums();
  log(
    `wrote ${path.relative(REPO_ROOT, EXPORT_DIR)} and ${path.relative(REPO_ROOT, CHECKSUM_FILE)}`,
  );
} catch (error) {
  console.error(`[godot:export] ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
