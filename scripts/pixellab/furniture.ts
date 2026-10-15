/**
 * Generates furniture art with PixelLab's map-object endpoint and packs it
 * into webview-ui/public/assets/furniture/, replacing the procedurally
 * drawn PNGs with AI-generated ones while keeping every manifest's shape
 * (ids, footprints, orientation and state groups) byte-identical except the
 * width/height of each asset node, which follow the actual generated image.
 *
 *   npx tsx scripts/pixellab/furniture.ts [item ids...]
 *
 * Resumable: each raw generation is downloaded once to
 * scripts/pixellab/furniture-frames/<ITEM>/<key>.png (gitignored) and never
 * re-requested once that file exists, so a rerun only fills in what a
 * previous run didn't finish. scripts/pixellab/furniture.json records every
 * prompt, seed and PixelLab object id for audit.
 *
 * Orientation handling follows the furniture anchor contract and the
 * character-sheet convention already used in this repo: `right` is `front`
 * mirrored and `left` is `back` mirrored, with no extra PixelLab call. Items
 * that face a way (seats, desks) or lie along an axis (long tables, benches)
 * are `turnaround` items: their front render seeds one 8-direction PixelLab
 * object, whose south-west view becomes `front` and north-east view `back`.
 * A text-only render faces either diagonal at random, and two separate
 * renders never share a design. Items without a distinct back (wall-mounted
 * items, plants) only ever generate `front`. On/off electronics generate the
 * off frame, then chain the on frames from it via `init_image` so the lit
 * frames stay visually close to the idle one.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import type { FurnitureSpec, FurnitureVariant, Orientation } from '../iso-art/lib/furniture.js';
import { writeFurniture } from '../iso-art/lib/furniture.js';
import { contactSheet, PixelImage } from '../iso-art/lib/image.js';
import { pixelLabApiKey } from './env.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const framesDir = path.join(here, 'furniture-frames');
const recordFile = path.join(here, 'furniture.json');
const assetsDir = path.resolve(here, '../../webview-ui/public/assets');
const furnitureDir = path.join(assetsDir, 'furniture');
const reviewDir = '/tmp/furniture-review';

const BASE = 'https://api.pixellab.ai/v2';

/** Budget: the run aborts before issuing a paid call that would cross this
 *  (shared with other PixelLab work running against the same account). */
const GENERATION_BUDGET_CAP = 400;
const RETRY_429_MAX_ATTEMPTS = 40;
/** PixelLab map-object generation fails permanently from time to time for
 *  reasons unrelated to the prompt; retry with a different seed before
 *  giving up on an item. */
const MAX_GENERATION_ATTEMPTS = 3;
const CONCURRENCY = 6;
/** The 8-direction object endpoint rejects reference images above this. */
const TURNAROUND_MAX_SIZE = 168;
/** PixelLab bills an 8-direction object 10 to 25 generations by size and
 *  does not always report usage. */
const TURNAROUND_GENERATIONS_ESTIMATE = 20;
/** Height of a desk or table top above the floor, in art px, measured on the
 *  PixelLab desk and table renders. */
const DESK_SURFACE_LIFT_ART_PX = 26;
/** Height of the kitchen counter top above the floor, in art px, measured
 *  where the coffee machine stands on the PixelLab counter render. */
const COUNTER_SURFACE_LIFT_ART_PX = 60;
/** Where a hung item's centre sits on the wall, and the highest its top may
 *  reach, in art px above the floor. The wall is 112 art px tall. */
const WALL_HANG_CENTRE_ART_PX = 70;
const WALL_HANG_TOP_ART_PX = 104;

type SourceOrientation = 'front' | 'back' | undefined;
type LeafState = 'off' | 'on' | undefined;

interface Leaf {
  id: string;
  width: number;
  height: number;
  footprintW: number;
  footprintH: number;
  orientation?: Orientation;
  state?: LeafState;
  frame?: number;
}

interface ManifestNode {
  type?: string;
  groupType?: string;
  orientation?: string;
  state?: string;
  frame?: number;
  id?: string;
  width?: number;
  height?: number;
  footprintW?: number;
  footprintH?: number;
  members?: ManifestNode[];
  name?: string;
  category?: string;
  canPlaceOnWalls?: boolean;
  canPlaceOnSurfaces?: boolean;
}

function flattenManifest(
  node: ManifestNode,
  ctx: { orientation?: string; state?: string } = {},
): Leaf[] {
  if (node.type === 'asset') {
    return [
      {
        id: node.id!,
        width: node.width!,
        height: node.height!,
        footprintW: node.footprintW!,
        footprintH: node.footprintH!,
        orientation: (node.orientation ?? ctx.orientation) as Orientation | undefined,
        state: (node.state ?? ctx.state) as LeafState,
        frame: node.frame,
      },
    ];
  }
  let out: Leaf[] = [];
  for (const member of node.members ?? []) {
    out = out.concat(
      flattenManifest(member, {
        orientation: node.orientation ?? ctx.orientation,
        state: node.state ?? ctx.state,
      }),
    );
  }
  return out;
}

/** Generation key: always a `front`/`back` (never `right`/`left`, which
 *  reuse the front/back render mirrored) plus state/frame. */
function genKey(
  state: LeafState,
  frame: number | undefined,
  orientation: SourceOrientation,
): string {
  const parts = [orientation, state, frame !== undefined ? String(frame + 1) : undefined].filter(
    Boolean,
  );
  return parts.length > 0 ? parts.join('_') : 'base';
}

function sourceOrientationOf(orientation: Orientation | undefined): SourceOrientation {
  if (orientation === 'right') return 'front';
  if (orientation === 'left') return 'back';
  return orientation as SourceOrientation;
}

const STYLE_SUFFIX =
  'cozy modern office pixel art, light wood tones, white and soft pastel colors, clean minimalist shapes, ' +
  'soft daylight, single isolated game object, isometric view, viewed from an isometric angle';
const FRONT_SUFFIX =
  ', large and centered, filling most of the frame, facing the viewer, standing on the ground with a soft drop shadow, transparent background';
const BACK_SUFFIX =
  ', large and centered, filling most of the frame, seen from behind with its back facing the viewer, standing on the ground with a soft drop shadow, transparent background';
const WALL_SUFFIX =
  ', large and centered, filling most of the frame, flat wall-mounted object, hanging flat against a wall and viewed frontally, transparent background';

interface ItemPrompt {
  front: string;
  back?: string;
  turnaround?: boolean;
  /** The cached front render lies along the wrong floor axis. Used where the
   *  8-direction object misreads a symmetric item and returns no diagonals. */
  mirrorFront?: boolean;
  /** The turnaround's north-east view of a long item came back along the
   *  other floor axis from its south-west view. */
  mirrorBack?: boolean;
  /** Transparent rows added under the render. The renderer anchors every
   *  item at the floor, so an item made to stand on a desk or counter carries
   *  that surface's height in its own sprite. */
  surfaceLift?: number;
  /** Hangs on the wall at eye level rather than standing on the floor
   *  against it. */
  hang?: boolean;
  /** Every on frame shows the first one. Separate renders of the same item
   *  shift its outline, so cycling them makes the item jump. */
  stillOn?: boolean;
  wallMounted?: boolean;
  /** Only for items with on/off electronics state: full descriptions for
   *  the off frame and each on frame, for front and (if the item has one)
   *  back. Index 0 = on frame 1, 1 = on frame 2, 2 = on frame 3. */
  states?: {
    front: { off: string; on: [string, string, string] };
    back?: { off: string; on: [string, string, string] };
  };
}

const PROMPTS: Record<string, ItemPrompt> = {
  DESK: {
    front: 'a simple modern office desk with a light wood top and white metal legs',
    turnaround: true,
  },
  SMALL_TABLE: { front: 'a small round side table with a light wood top and thin white legs' },
  MEETING_TABLE: {
    front: 'a long modern conference table with a light wood top and white legs',
    turnaround: true,
  },
  COFFEE_TABLE: {
    front:
      'a low modern rectangular coffee table with a solid glossy light wood tabletop and four sturdy white wooden legs, opaque wood grain clearly visible on the tabletop',
    turnaround: true,
  },
  EXEC_DESK: {
    front:
      'an elegant executive desk with a white lacquered top, light wood drawer fronts and brass handle accents',
    turnaround: true,
    mirrorBack: true,
  },
  PC: {
    front:
      'a modern desktop computer monitor and keyboard on a small stand, white and light grey plastic',
    back: 'a modern desktop computer monitor seen from behind, white and light grey plastic back panel and cables, keyboard in front',
    stillOn: true,
    surfaceLift: DESK_SURFACE_LIFT_ART_PX,
    states: {
      front: {
        off: 'a modern desktop computer monitor and keyboard on a small stand, white and light grey plastic, screen turned off showing a dark blank display',
        on: [
          'a modern desktop computer monitor and keyboard on a small stand, white and light grey plastic, screen glowing softly with a pale blue light and a few lines of text',
          'a modern desktop computer monitor and keyboard on a small stand, white and light grey plastic, screen glowing with a pale blue light, blinking text cursor',
          'a modern desktop computer monitor and keyboard on a small stand, white and light grey plastic, screen glowing with a pale blue light, a subtle soft flicker',
        ],
      },
      back: {
        off: 'a modern desktop computer monitor seen from behind, white and light grey plastic back panel and cables, keyboard in front, screen off, no glow',
        on: [
          'a modern desktop computer monitor seen from behind, white and light grey plastic back panel and cables, keyboard in front, a soft pale blue glow spilling from the screen edges',
          'a modern desktop computer monitor seen from behind, white and light grey plastic back panel and cables, keyboard in front, a soft pale blue glow spilling from the screen edges, slightly brighter',
          'a modern desktop computer monitor seen from behind, white and light grey plastic back panel and cables, keyboard in front, a soft pale blue glow flickering gently from the screen edges',
        ],
      },
    },
  },
  CUSHIONED_CHAIR: {
    front: 'a modern upholstered office swivel chair with cream fabric cushions and a white frame',
    turnaround: true,
  },
  WOODEN_CHAIR: {
    front: 'a simple wooden dining chair with a light wood frame and a pale cushion seat',
    turnaround: true,
  },
  SOFA: {
    front: 'a cozy two-seat sofa with soft pastel sage green cushions and light wood legs',
    turnaround: true,
  },
  CUSHIONED_BENCH: {
    front:
      'a cozy upholstered bench with a thick pastel blush pink seat cushion clearly separate from a tall pastel blush pink backrest cushion, white wooden frame and legs',
  },
  WOODEN_BENCH: { front: 'a simple light wood bench with a smooth plank seat', mirrorFront: true },
  EXEC_CHAIR: {
    front:
      'an elegant high-back executive office chair with cream leather upholstery and brushed gold trim',
    turnaround: true,
  },
  STOOL: { front: 'a simple round bar stool with a pale wood seat and thin white metal legs' },
  PLANT: { front: 'a leafy potted houseplant in a simple white ceramic pot' },
  PLANT_2: { front: 'a bushy potted houseplant with broad green leaves in a pale terracotta pot' },
  LARGE_PLANT: { front: 'a tall leafy potted floor plant in a large white ceramic planter' },
  CACTUS: { front: 'a small potted cactus in a simple white ceramic pot' },
  POT: {
    front:
      'a small potted succulent plant with neat rounded pale-green leaves in a pastel pink ceramic pot',
  },
  BIN: { front: 'a small round office waste bin in white and light grey plastic' },
  COFFEE: {
    front:
      'a small brown ceramic coffee mug filled with dark coffee, white steam curling above it, a simple loop handle on the side',
    surfaceLift: DESK_SURFACE_LIFT_ART_PX,
  },
  COFFEE_MACHINE: {
    front: 'a modern countertop coffee machine in white and light wood',
    surfaceLift: COUNTER_SURFACE_LIFT_ART_PX,
    stillOn: true,
    states: {
      front: {
        off: 'a modern countertop coffee machine in white and light wood, idle with no steam',
        on: [
          'a modern countertop coffee machine in white and light wood, brewing coffee with a small puff of steam rising from the top',
          'a modern countertop coffee machine in white and light wood, brewing coffee with a larger puff of steam rising from the top',
          'a modern countertop coffee machine in white and light wood, brewing coffee with a wisp of steam drifting to the side',
        ],
      },
    },
  },
  KITCHEN_COUNTER: {
    front: 'a modern kitchen counter cabinet with a white countertop and light wood cabinet doors',
  },
  FRIDGE: { front: 'a modern compact refrigerator in white and light grey with rounded corners' },
  WATER_COOLER: {
    front: 'a modern water cooler dispenser with a pale blue tinted water bottle on a white base',
  },
  FLOOR_LAMP: {
    front:
      'a modern floor lamp with a round pale cream fabric drum lamp shade sitting flat atop a slim dark wood pole stand and a small round dark wood base',
  },
  RUG_PLANT: { front: 'a long low planter box full of leafy green plants, white planter sides' },
  BOOKSHELF: {
    front: 'a modern light wood bookshelf with a few books and a small potted plant on its shelves',
    wallMounted: true,
  },
  DOUBLE_BOOKSHELF: {
    front: 'a tall modern light wood bookcase filled with books and a small potted plant on top',
    wallMounted: true,
  },
  CLOCK: {
    front:
      'a round wall clock with a warm cream-beige face, thick black clock hands pointing to ten past ten, bold black tick marks around the rim, and a dark wood case',
    wallMounted: true,
    hang: true,
  },
  SMALL_PAINTING: {
    front: 'a small framed abstract painting in soft pastel colors with a light wood frame',
    wallMounted: true,
    hang: true,
  },
  SMALL_PAINTING_2: {
    front: 'a small framed landscape painting in soft pastel colors with a white frame',
    wallMounted: true,
    hang: true,
  },
  LARGE_PAINTING: {
    front: 'a large framed abstract painting in soft pastel colors with a light wood frame',
    wallMounted: true,
    hang: true,
  },
  WHITEBOARD: {
    front: 'a modern whiteboard in a light wood frame with a few colorful sticky notes',
    wallMounted: true,
    hang: true,
  },
  KANBAN_BOARD: {
    front:
      'a modern kanban task board mounted on the wall, divided into three columns by thin wood dividers, each column holding several colorful opaque sticky notes in pink, yellow and blue, solid white board surface, light wood frame',
    wallMounted: true,
    hang: true,
  },
  HANGING_PLANT: {
    front: 'a small trailing houseplant in a hanging white ceramic planter',
    wallMounted: true,
  },
  WALL_TV: {
    front: 'a modern flat wall-mounted screen with a thin white bezel',
    wallMounted: true,
    hang: true,
    stillOn: true,
    states: {
      front: {
        off: 'a modern flat wall-mounted screen with a thin white bezel, turned off with a dark blank display',
        on: [
          'a modern flat wall-mounted screen with a thin white bezel, turned on and glowing with a soft pale blue display',
          'a modern flat wall-mounted screen with a thin white bezel, turned on, glowing pale blue display, a faint shimmer',
          'a modern flat wall-mounted screen with a thin white bezel, turned on, glowing pale blue display, brightness pulsing gently',
        ],
      },
    },
  },
  CTO_SIGN: {
    front:
      'a small modern office name-plate sign, a solid white plaque with the bold dark letters "CTO" printed on it, mounted in a light wood frame',
    wallMounted: true,
    hang: true,
  },
  WALL_SHELF: {
    front: 'a simple light wood floating wall shelf with a small potted plant and a book',
    wallMounted: true,
    hang: true,
  },
};

interface Record_ {
  spentGenerations: number;
  items: Record<
    string,
    Record<
      string,
      { description: string; seed: number; objectId: string; width: number; height: number }
    >
  >;
}

function loadRecord(): Record_ {
  if (fs.existsSync(recordFile)) return JSON.parse(fs.readFileSync(recordFile, 'utf8'));
  return { spentGenerations: 0, items: {} };
}

let saveChain = Promise.resolve();
function save(record: Record_): Promise<void> {
  saveChain = saveChain.then(() =>
    fs.promises.writeFile(recordFile, `${JSON.stringify(record, null, 2)}\n`),
  );
  return saveChain;
}

function seedFor(itemId: string, key: string): number {
  let h = 0;
  for (const ch of `${itemId}:${key}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 1_000_000;
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

interface CreateMapObjectResponse {
  background_job_id: string;
  object_id: string;
  status: string;
  usage?: { type: string; generations?: number | null } | null;
}

interface GetMapObjectResponse {
  status: string;
  object_id: string;
  download_url?: string | null;
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
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

async function pollMapObject(
  objectId: string,
  limitMs = 10 * 60 * 1000,
): Promise<GetMapObjectResponse> {
  const start = Date.now();
  for (;;) {
    const res = await fetch(`${BASE}/map-objects/${objectId}`, {
      headers: { Authorization: `Bearer ${pixelLabApiKey()}` },
    });
    if (res.status === 200) {
      const body = (await res.json()) as GetMapObjectResponse;
      if (body.status === 'completed' && body.download_url) return body;
      if (body.status === 'failed') throw new Error(`map object ${objectId} failed`);
    } else if (res.status === 423) {
      const retryAfter = Number(res.headers.get('retry-after') ?? '5');
      await sleep(Math.max(1, retryAfter) * 1000);
      continue;
    } else if (res.status === 410) {
      throw new Error(`map object ${objectId} failed permanently`);
    } else if (res.status === 429) {
      await sleep(5000 + Math.random() * 5000);
      continue;
    } else {
      throw new Error(`map object ${objectId} poll -> ${res.status}`);
    }
    if (Date.now() - start > limitMs) throw new Error(`map object ${objectId} timed out`);
    await sleep(4000);
  }
}

async function fetchBytes(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { 'User-Agent': 'terrarium-art' } });
  if (!res.ok) throw new Error(`download -> ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

interface ObjectDetailResponse {
  status?: string | null;
  rotation_urls?: Partial<Record<'south-west' | 'north-east', string | null>>;
}

async function pollObject(
  objectId: string,
  limitMs = 15 * 60 * 1000,
): Promise<ObjectDetailResponse> {
  const start = Date.now();
  for (;;) {
    const res = await fetch(`${BASE}/objects/${objectId}`, {
      headers: { Authorization: `Bearer ${pixelLabApiKey()}` },
    });
    if (res.status === 200) {
      const json = (await res.json()) as ObjectDetailResponse & { data?: ObjectDetailResponse };
      const body = json.data ?? json;
      if (body.status === 'completed') return body;
      if (body.status === 'failed') throw new Error(`object ${objectId} failed`);
    } else if (res.status !== 429 && res.status !== 423) {
      throw new Error(`object ${objectId} poll -> ${res.status}`);
    }
    if (Date.now() - start > limitMs) throw new Error(`object ${objectId} timed out`);
    await sleep(5000);
  }
}

/** The front render, squared, seeds one 8-direction object. Its south-west
 *  view is the screen-lower-left facing `front` of the anchor contract and its
 *  north-east view the matching `back`. */
async function generateTurnaround(
  record: Record_,
  itemId: string,
  description: string,
  front: PixelImage,
): Promise<{ front: PixelImage; back: PixelImage }> {
  const dir = path.join(framesDir, itemId);
  const frontPath = path.join(dir, 'turnaround_south-west.png');
  const backPath = path.join(dir, 'turnaround_north-east.png');
  if (fs.existsSync(frontPath) && fs.existsSync(backPath)) {
    return { front: PixelImage.readPng(frontPath), back: PixelImage.readPng(backPath) };
  }
  if (record.spentGenerations >= GENERATION_BUDGET_CAP) {
    throw new Error(`generation budget cap ${GENERATION_BUDGET_CAP} reached before ${itemId}`);
  }

  const size = Math.max(front.width, front.height);
  if (size > TURNAROUND_MAX_SIZE) throw new Error(`${itemId} front is ${size}px, too big to turn`);
  const reference = new PixelImage(size, size);
  reference.blit(front, Math.floor((size - front.width) / 2), size - front.height);
  const referencePath = path.join(dir, 'turnaround_reference.png');
  reference.writePng(referencePath);

  const created = await withRetry429(() =>
    apiPost<CreateMapObjectResponse>('/create-8-direction-object', {
      description,
      view: 'high top-down',
      reference_image: {
        type: 'base64',
        base64: fs.readFileSync(referencePath).toString('base64'),
        format: 'png',
      },
    }),
  );
  const done = await pollObject(created.object_id);
  const frontUrl = done.rotation_urls?.['south-west'];
  const backUrl = done.rotation_urls?.['north-east'];
  if (!frontUrl || !backUrl) throw new Error(`object ${created.object_id} has no diagonal views`);
  fs.writeFileSync(frontPath, await fetchBytes(frontUrl));
  fs.writeFileSync(backPath, await fetchBytes(backUrl));

  record.spentGenerations += created.usage?.generations ?? TURNAROUND_GENERATIONS_ESTIMATE;
  record.items[itemId] ??= {};
  record.items[itemId].turnaround = {
    description,
    seed: 0,
    objectId: created.object_id,
    width: size,
    height: size,
  };
  await save(record);
  return { front: PixelImage.readPng(frontPath), back: PixelImage.readPng(backPath) };
}

/** Generate (or load from a previous run) one raw PixelLab canvas: exactly
 *  `width`×`height`, undrimmed. */
async function generateRaw(
  record: Record_,
  itemId: string,
  key: string,
  description: string,
  width: number,
  height: number,
  initImagePath?: string,
): Promise<PixelImage> {
  const rawPath = path.join(framesDir, itemId, `${key}.png`);
  if (fs.existsSync(rawPath)) return PixelImage.readPng(rawPath);

  if (record.spentGenerations >= GENERATION_BUDGET_CAP) {
    throw new Error(
      `generation budget cap ${GENERATION_BUDGET_CAP} reached before ${itemId}/${key}`,
    );
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
    const seed = seedFor(itemId, key) + attempt;
    const body: Record<string, unknown> = {
      description,
      image_size: { width, height },
      view: 'side',
      outline: 'single color outline',
      shading: 'medium shading',
      detail: 'medium detail',
      seed,
    };
    if (initImagePath) {
      body.init_image = {
        type: 'base64',
        base64: fs.readFileSync(initImagePath).toString('base64'),
        format: 'png',
      };
    }

    try {
      const created = await withRetry429(() =>
        apiPost<CreateMapObjectResponse>('/map-objects', body),
      );
      const done = await pollMapObject(created.object_id);
      const bytes = await fetchBytes(done.download_url!);
      fs.mkdirSync(path.dirname(rawPath), { recursive: true });
      fs.writeFileSync(rawPath, bytes);

      record.spentGenerations += created.usage?.generations ?? 1;
      record.items[itemId] ??= {};
      record.items[itemId][key] = { description, seed, objectId: created.object_id, width, height };
      await save(record);
      return PixelImage.readPng(rawPath);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function liftOff(img: PixelImage, rows: number): PixelImage {
  const out = new PixelImage(img.width, img.height + rows);
  out.blit(img, 0, 0);
  return out;
}

function hangLift(height: number): number {
  const centred = Math.round(WALL_HANG_CENTRE_ART_PX - height / 2);
  return Math.max(0, Math.min(centred, WALL_HANG_TOP_ART_PX - height));
}

/** Trim to the opaque bounding box, then upscale that box by the largest
 *  integer factor that still fits `targetWidth` (nearest-neighbour block
 *  replication, never a smooth scale) so content the model placed small
 *  within its canvas still reads at full pixel density, and center it in a
 *  canvas exactly `targetWidth` wide (the anchor contract's required
 *  width). Height is whatever the scaled content needs. */
function trimAndPad(raw: PixelImage, targetWidth: number): PixelImage {
  let minX = raw.width;
  let maxX = -1;
  let minY = raw.height;
  let maxY = -1;
  for (let y = 0; y < raw.height; y++) {
    for (let x = 0; x < raw.width; x++) {
      const c = raw.get(x, y);
      if (c && c[3] >= 16) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error('generated image is fully transparent');
  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;
  const scale = Math.max(1, Math.floor(targetWidth / cropW));
  const padLeft = Math.floor((targetWidth - cropW * scale) / 2);
  const out = new PixelImage(targetWidth, cropH * scale);
  for (let y = 0; y < cropH; y++) {
    for (let x = 0; x < cropW; x++) {
      const c = raw.get(minX + x, minY + y);
      if (c) out.fillRect(padLeft + x * scale, y * scale, scale, scale, c);
    }
  }
  return out;
}

function stateFrameCombos(
  leaves: Leaf[],
  orientation: SourceOrientation,
): { state: LeafState; frame?: number }[] {
  const own = leaves.filter(
    (l) => sourceOrientationOf(l.orientation) === orientation || (!l.orientation && !orientation),
  );
  const seen = new Set<string>();
  const out: { state: LeafState; frame?: number }[] = [];
  for (const l of own) {
    const k = `${l.state ?? ''}:${l.frame ?? ''}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ state: l.state, frame: l.frame });
  }
  return out;
}

function describe(
  prompt: ItemPrompt,
  orientation: SourceOrientation,
  state: LeafState,
  frame?: number,
): string {
  const base = orientation === 'back' ? prompt.back! : prompt.front;
  if (state && prompt.states) {
    const set = orientation === 'back' ? prompt.states.back : prompt.states.front;
    if (set) {
      if (state === 'off') return decorate(set.off, orientation, prompt.wallMounted);
      return decorate(set.on[frame ?? 0], orientation, prompt.wallMounted);
    }
  }
  return decorate(base, orientation, prompt.wallMounted);
}

function decorate(
  description: string,
  orientation: SourceOrientation,
  wallMounted?: boolean,
): string {
  const framing = wallMounted ? WALL_SUFFIX : orientation === 'back' ? BACK_SUFFIX : FRONT_SUFFIX;
  return `${description}, ${STYLE_SUFFIX}${framing}`;
}

function regroupVariants(leaves: Leaf[], images: Map<string, PixelImage>): FurnitureVariant[] {
  const order: string[] = [];
  const groups = new Map<
    string,
    {
      orientation?: Orientation;
      state?: 'on' | 'off';
      footprintW: number;
      footprintH: number;
      frames: { frame?: number; image: PixelImage }[];
    }
  >();
  for (const leaf of leaves) {
    const key = `${leaf.orientation ?? ''}|${leaf.state ?? ''}`;
    if (!groups.has(key)) {
      groups.set(key, {
        orientation: leaf.orientation,
        state: leaf.state,
        footprintW: leaf.footprintW,
        footprintH: leaf.footprintH,
        frames: [],
      });
      order.push(key);
    }
    groups.get(key)!.frames.push({ frame: leaf.frame, image: images.get(leaf.id)! });
  }
  return order.map((key) => {
    const g = groups.get(key)!;
    g.frames.sort((a, b) => (a.frame ?? 0) - (b.frame ?? 0));
    return {
      orientation: g.orientation,
      state: g.state,
      footprintW: g.footprintW,
      footprintH: g.footprintH,
      images: g.frames.map((f) => f.image),
    };
  });
}

async function processItem(record: Record_, itemId: string): Promise<FurnitureSpec> {
  const prompt = PROMPTS[itemId];
  if (!prompt) throw new Error(`no prompt for ${itemId}`);
  const manifestPath = path.join(furnitureDir, itemId, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ManifestNode & {
    name: string;
    category: string;
    canPlaceOnWalls: boolean;
    canPlaceOnSurfaces: boolean;
  };
  const leaves = flattenManifest(manifest);
  const width = leaves[0].width;
  const canvasHeight = Math.floor(Math.min(400, leaves[0].height + 110) / 4) * 4;

  const orientationsPresent = new Set(leaves.map((l) => l.orientation));
  const sourceOrientations: SourceOrientation[] = orientationsPresent.has(undefined)
    ? [undefined]
    : (['front', 'back'] as const).filter((o) => orientationsPresent.has(o));

  const generated = new Map<string, PixelImage>();
  for (const so of prompt.turnaround ? (['front'] as const) : sourceOrientations) {
    const combos = stateFrameCombos(leaves, so);
    let prevRawPath: string | undefined;
    for (const { state, frame } of combos) {
      const key = genKey(state, frame, so);
      const description = describe(prompt, so, state, frame);
      const img = await generateRaw(
        record,
        itemId,
        key,
        description,
        width,
        canvasHeight,
        prevRawPath,
      );
      generated.set(`${so ?? ''}|${state ?? ''}|${frame ?? ''}`, trimAndPad(img, width));
      prevRawPath = path.join(framesDir, itemId, `${key}.png`);
    }
  }
  if (prompt.turnaround) {
    const views = await generateTurnaround(record, itemId, prompt.front, generated.get('front||')!);
    generated.set('front||', trimAndPad(views.front, width));
    generated.set('back||', trimAndPad(views.back, width));
  }
  if (prompt.mirrorFront) generated.set('front||', generated.get('front||')!.mirrored());
  if (prompt.mirrorBack) generated.set('back||', generated.get('back||')!.mirrored());
  if (prompt.surfaceLift) {
    for (const [key, img] of generated) generated.set(key, liftOff(img, prompt.surfaceLift));
  }
  if (prompt.hang) {
    for (const [key, img] of generated) generated.set(key, liftOff(img, hangLift(img.height)));
  }

  const finalImages = new Map<string, PixelImage>();
  for (const leaf of leaves) {
    const so = sourceOrientationOf(leaf.orientation);
    const frame = prompt.stillOn && leaf.frame !== undefined ? 0 : leaf.frame;
    const base = generated.get(`${so ?? ''}|${leaf.state ?? ''}|${frame ?? ''}`);
    if (!base) throw new Error(`missing generated image for ${leaf.id}`);
    const mirror = leaf.orientation === 'right' || leaf.orientation === 'left';
    finalImages.set(leaf.id, mirror ? base.mirrored() : base);
  }

  return {
    id: itemId,
    name: manifest.name,
    category: manifest.category as FurnitureSpec['category'],
    canPlaceOnWalls: manifest.canPlaceOnWalls,
    canPlaceOnSurfaces: manifest.canPlaceOnSurfaces,
    variants: regroupVariants(leaves, finalImages),
  };
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
  const requested = process.argv.slice(2);
  const ids = requested.length > 0 ? requested : Object.keys(PROMPTS);
  for (const id of ids) {
    if (!PROMPTS[id]) throw new Error(`unknown item id ${id}`);
  }

  const record = loadRecord();
  fs.mkdirSync(framesDir, { recursive: true });
  fs.mkdirSync(reviewDir, { recursive: true });

  const balanceRes = await fetch(`${BASE}/balance`, {
    headers: { Authorization: `Bearer ${pixelLabApiKey()}` },
  });
  const balance = (await balanceRes.json()) as {
    subscription: { generations: number; total: number };
  };
  console.log(
    `[pixellab-furniture] balance before: ${balance.subscription.generations}/${balance.subscription.total}`,
  );

  const specs: FurnitureSpec[] = [];
  const failed: string[] = [];
  await pool(ids, CONCURRENCY, async (id) => {
    try {
      const spec = await processItem(record, id);
      specs.push(spec);
      writeFurniture(spec, furnitureDir);
      contactSheet(spec.variants.flatMap((v) => v.images)).writePng(
        path.join(reviewDir, `${id}.png`),
      );
      console.log(`[pixellab-furniture] ${id} done`);
    } catch (err) {
      failed.push(id);
      console.error(`[pixellab-furniture] ${id} FAILED:`, err instanceof Error ? err.message : err);
    }
  });

  contactSheet(
    specs.flatMap((s) => s.variants.flatMap((v) => v.images)),
    3,
  ).writePng(path.join(reviewDir, 'all.png'));

  const balanceAfterRes = await fetch(`${BASE}/balance`, {
    headers: { Authorization: `Bearer ${pixelLabApiKey()}` },
  });
  const balanceAfter = (await balanceAfterRes.json()) as {
    subscription: { generations: number; total: number };
  };
  console.log(
    `[pixellab-furniture] balance after: ${balanceAfter.subscription.generations}/${balanceAfter.subscription.total}`,
  );
  console.log(`[pixellab-furniture] done. spent ~${record.spentGenerations} generations this run.`);
  if (failed.length > 0) {
    console.log(`[pixellab-furniture] failed (rerun to retry): ${failed.join(', ')}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[pixellab-furniture]', err instanceof Error ? (err.stack ?? err.message) : err);
  process.exitCode = 1;
});
