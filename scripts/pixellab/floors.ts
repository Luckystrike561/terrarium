/**
 * Generates the 9 floor materials with PixelLab's tiles-pro endpoint and
 * writes them straight into webview-ui/public/assets/floors/, replacing the
 * procedurally drawn grayscale patterns (scripts/iso-art/floors.ts, retired)
 * with real AI-generated materials.
 *
 *   npx tsx scripts/pixellab/floors.ts [index...]
 *
 * Each material is a `tile_type: 'square_topdown'`, `tile_view: 'top-down'`
 * request: a literal flat, axis-aligned material swatch with zero depth, no
 * isometric framing. The webview still projects this square onto the 64×32
 * diamond at render time (`projectToDiamond`, unchanged, also used by
 * carpets) — PixelLab only replaces the texture, not the projection.
 *
 * One call returns 16 independent variations of the same description (PixelLab's
 * default for a `tiles-pro` request with no `tile_feature`), all downloaded to
 * scripts/pixellab/floor-frames/<index>/tile_N.png (gitignored) so a rerun is
 * resumable and never re-requests a material it already has. `floor_<index>`
 * variant 0 is packed by default; override with the `chosen` field in
 * scripts/pixellab/floors.json to pick a different variant without spending
 * another generation. scripts/pixellab/floors.json records every prompt, seed
 * and PixelLab tile id for audit.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { contactSheet, PixelImage } from '../iso-art/lib/image.js';
import { pixelLabApiKey } from './env.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const framesDir = path.join(here, 'floor-frames');
const recordFile = path.join(here, 'floors.json');
const assetsDir = path.resolve(here, '../../webview-ui/public/assets');
const floorsDir = path.join(assetsDir, 'floors');
const reviewDir = '/tmp/floor-review';

const BASE = 'https://api.pixellab.ai/v2';
const TILE_SIZE = 32;
const VARIANTS_PER_CALL = 16;

/** Budget: the run aborts before issuing a paid call that would cross this
 *  (shared with other PixelLab work running against the same account). */
const GENERATION_BUDGET_CAP = 150;
const RETRY_429_MAX_ATTEMPTS = 40;

const STYLE_SUFFIX =
  ', cozy modern office pixel art, light wood tones, white and soft pastel colors, ' +
  'clean minimalist shapes, soft daylight, flat seamless repeating floor material, ' +
  'no harsh black outlines, subtle shading only';

/** One entry per `floor_N.png`, in index order. Keep the same material at
 *  each index: the default layout and any saved layout reference tiles by
 *  this pattern index (see docs/architecture/assets.md). */
const MATERIALS: Record<number, { name: string; description: string }> = {
  0: {
    name: 'plain polished slab',
    description: `plain polished pale warm-gray stone floor slab, smooth surface, no grout lines${STYLE_SUFFIX}`,
  },
  1: {
    name: 'large pale tile',
    description: `large pale cream stone floor tiles, thin light seams between a few big tiles${STYLE_SUFFIX}`,
  },
  2: {
    name: 'large tile dark grout',
    description: `large pale gray floor tiles with visible dark gray grout lines between them${STYLE_SUFFIX}`,
  },
  3: {
    name: 'small square tile',
    description: `small square cream ceramic floor tiles in a tight grid with thin gray grout lines${STYLE_SUFFIX}`,
  },
  4: {
    name: 'wood planks',
    description: `light honey wood plank flooring, horizontal wood planks with visible grain and subtle seams${STYLE_SUFFIX}`,
  },
  5: {
    name: 'running-bond brick',
    description: `warm terracotta brick floor pavers in a running-bond brick pattern, light mortar lines${STYLE_SUFFIX}`,
  },
  6: {
    name: 'aligned brick',
    description: `warm terracotta brick floor pavers in a straight aligned grid pattern, light mortar lines${STYLE_SUFFIX}`,
  },
  7: {
    name: 'fine checkerboard',
    description: `fine cream and white checkerboard floor tile pattern, many small alternating squares${STYLE_SUFFIX}`,
  },
  8: {
    name: 'coarse checkerboard',
    description: `coarse cream and white checkerboard floor tile pattern, few large alternating squares${STYLE_SUFFIX}`,
  },
};

interface Record_ {
  spentGenerations: number;
  materials: Record<
    string,
    { description: string; seed: number; tileId: string; backgroundJobId: string; chosen: number }
  >;
}

function loadRecord(): Record_ {
  if (fs.existsSync(recordFile)) return JSON.parse(fs.readFileSync(recordFile, 'utf8'));
  return { spentGenerations: 0, materials: {} };
}

let saveChain = Promise.resolve();
function save(record: Record_): Promise<void> {
  saveChain = saveChain.then(() =>
    fs.promises.writeFile(recordFile, `${JSON.stringify(record, null, 2)}\n`),
  );
  return saveChain;
}

function seedFor(index: number): number {
  let h = 0;
  for (const ch of `floor:${index}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 1_000_000;
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

async function apiPost<T>(path_: string, body: unknown): Promise<T> {
  const res = await fetch(BASE + path_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${pixelLabApiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`PixelLab POST ${path_} -> ${res.status}: ${text.slice(0, 1000)}`);
  return JSON.parse(text) as T;
}

async function apiGet<T>(path_: string): Promise<T> {
  const res = await fetch(BASE + path_, {
    headers: { Authorization: `Bearer ${pixelLabApiKey()}` },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`PixelLab GET ${path_} -> ${res.status}: ${text.slice(0, 1000)}`);
  return JSON.parse(text) as T;
}

async function withRetry429<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes('429') || attempt >= RETRY_429_MAX_ATTEMPTS) throw err;
      await sleep(5000 + Math.random() * 5000);
    }
  }
}

interface CreateTilesProResponse {
  background_job_id: string;
  tile_id: string;
  status: string;
}

interface BackgroundJob {
  status: string;
}

interface GetTilesProResponse {
  storage_urls: Record<string, string>;
}

async function pollJob(jobId: string, limitMs = 10 * 60 * 1000): Promise<void> {
  const start = Date.now();
  for (;;) {
    const job = await apiGet<BackgroundJob>(`/background-jobs/${jobId}`);
    if (job.status === 'completed') return;
    if (job.status === 'failed') throw new Error(`background job ${jobId} failed`);
    if (Date.now() - start > limitMs) throw new Error(`background job ${jobId} timed out`);
    await sleep(4000);
  }
}

async function fetchBytes(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { 'User-Agent': 'terrarium-floor-generator' } });
  if (!res.ok) throw new Error(`download -> ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Generate (or load from a previous run) every raw variant for one material. */
async function generateMaterial(record: Record_, index: number): Promise<void> {
  const key = String(index);
  const dir = path.join(framesDir, key);
  const existing = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.png')) : [];
  if (existing.length >= VARIANTS_PER_CALL) return;

  if (record.spentGenerations >= GENERATION_BUDGET_CAP) {
    throw new Error(
      `generation budget cap ${GENERATION_BUDGET_CAP} reached before material ${index}`,
    );
  }

  const material = MATERIALS[index];
  if (!material) throw new Error(`unknown floor material index ${index}`);
  const seed = seedFor(index);

  const created = await withRetry429(() =>
    apiPost<CreateTilesProResponse>('/create-tiles-pro', {
      description: material.description,
      tile_type: 'square_topdown',
      tile_size: TILE_SIZE,
      tile_view: 'top-down',
      outline_mode: 'segmentation',
      seed,
    }),
  );
  await pollJob(created.background_job_id);
  const result = await apiGet<GetTilesProResponse>(`/tiles-pro/${created.tile_id}`);

  fs.mkdirSync(dir, { recursive: true });
  let n = 0;
  for (const [variantKey, url] of Object.entries(result.storage_urls)) {
    const buf = await fetchBytes(url);
    fs.writeFileSync(path.join(dir, `${variantKey}.png`), buf);
    n++;
  }

  record.spentGenerations += 10;
  record.materials[key] = {
    description: material.description,
    seed,
    tileId: created.tile_id,
    backgroundJobId: created.background_job_id,
    chosen: record.materials[key]?.chosen ?? 0,
  };
  await save(record);
  console.log(`[pixellab-floors] ${index} (${material.name}): ${n} variants`);
}

async function pool<T>(
  items: T[],
  concurrency: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (;;) {
        const item = queue.shift();
        if (item === undefined) return;
        await run(item);
      }
    }),
  );
}

async function main(): Promise<void> {
  const requested = process.argv.slice(2).map(Number);
  const indices = requested.length > 0 ? requested : Object.keys(MATERIALS).map(Number);
  for (const i of indices) {
    if (!MATERIALS[i]) throw new Error(`unknown floor material index ${i}`);
  }

  const record = loadRecord();
  fs.mkdirSync(framesDir, { recursive: true });
  fs.mkdirSync(floorsDir, { recursive: true });
  fs.mkdirSync(reviewDir, { recursive: true });

  const failed: number[] = [];
  await pool(indices, 3, async (index) => {
    try {
      await generateMaterial(record, index);
    } catch (err) {
      failed.push(index);
      console.error(`[pixellab-floors] ${index} FAILED:`, err instanceof Error ? err.message : err);
    }
  });

  for (const index of indices) {
    if (failed.includes(index)) continue;
    const dir = path.join(framesDir, String(index));
    const variants = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.png'))
      .sort();
    if (variants.length === 0) continue;

    contactSheet(
      variants.map((f) => PixelImage.readPng(path.join(dir, f))),
      6,
    ).writePng(path.join(reviewDir, `${index}.png`));

    const chosen = record.materials[String(index)]?.chosen ?? 0;
    const chosenFile = path.join(dir, `tile_${chosen}.png`);
    if (!fs.existsSync(chosenFile)) throw new Error(`material ${index}: no variant tile_${chosen}`);
    fs.copyFileSync(chosenFile, path.join(floorsDir, `floor_${index}.png`));
  }

  contactSheet(
    indices
      .filter((i) => !failed.includes(i))
      .map((i) => PixelImage.readPng(path.join(floorsDir, `floor_${i}.png`))),
    6,
  ).writePng(path.join(reviewDir, 'all.png'));

  console.log(`[pixellab-floors] done. spent ~${record.spentGenerations} generations so far.`);
  if (failed.length > 0) {
    console.log(`[pixellab-floors] failed (rerun to retry): ${failed.join(', ')}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[pixellab-floors]', err instanceof Error ? (err.stack ?? err.message) : err);
  process.exitCode = 1;
});
