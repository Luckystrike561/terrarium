/**
 * Packs the raw PixelLab frames (scripts/pixellab/frames/<character>/) into
 * the 12 agent sheets + the CTO sheet the webview loads
 * (webview-ui/public/assets/characters/char_N.png, cto.png), and prints the
 * measured crown heights used to tune the webview's character geometry
 * constants.
 *
 *   npx tsx scripts/pixellab/pack.ts [--preview]
 *
 * Alignment: every pose is placed so its own lowest opaque row (its feet)
 * sits on a shared baseline near the bottom of the frame. Standing poses
 * use that baseline directly; seated poses raise it by SEAT_RAISE_ART_PX,
 * the chair's seat height above the floor (tuned by eye against
 * webview-ui/public/assets/furniture/WOODEN_CHAIR). Horizontal placement
 * centers each frame on the opaque pixels of its own lower third (hips and
 * legs), which stay still while an arm waves or a hand holds up a form.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import type { CharacterFrame } from '../../core/src/assets/constants.js';
import { CHAR_FRAMES_PER_ROW, CHARACTER_FRAMES } from '../../core/src/assets/constants.js';
import { contactSheet, PixelImage } from '../iso-art/lib/image.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const castFile = path.join(here, 'cast.json');
const framesDir = path.join(here, 'frames');
const assetsDir = path.resolve(here, '../../webview-ui/public/assets/characters');

/** Final frame canvas: big enough for every raw 88×88 PixelLab frame,
 *  including a hand or a held-up form reaching above the head. */
export const CHAR_FRAME_W = 96;
export const CHAR_FRAME_H = 96;
/** Rows of margin kept clear under the feet for the ground shadow. */
const FOOT_MARGIN_ART_PX = 4;
const BASELINE_Y = CHAR_FRAME_H - FOOT_MARGIN_ART_PX;
/** How much higher a seated pose's own feet sit than the standing
 *  baseline: the chair's seat height above the floor. */
const SEAT_RAISE_ART_PX = 12;
const OPAQUE_ALPHA_THRESHOLD = 128;

interface FrameSource {
  anim: string;
  index: number;
  seated: boolean;
}

/** Which raw animation frame fills each of the 23 CHARACTER_FRAMES slots.
 *  walk1–3 spread over the stride (walk2 the passing pose); type1–4 and
 *  read1–4 are 4 CONSECUTIVE frames from the middle of the cycle (fixed
 *  body/head, only the hands move) so the loop reads as continuous typing or
 *  reading rather than jitter; every other 2-frame loop picks two visibly
 *  different frames; holdForm and raiseHand never share a frame since they
 *  come from different animations entirely. */
const FRAME_SOURCE: Record<CharacterFrame, FrameSource> = {
  walk1: { anim: 'walk', index: 2, seated: false },
  walk2: { anim: 'walk', index: 4, seated: false },
  walk3: { anim: 'walk', index: 6, seated: false },
  type1: { anim: 'type', index: 2, seated: true },
  type2: { anim: 'type', index: 3, seated: true },
  type3: { anim: 'type', index: 4, seated: true },
  type4: { anim: 'type', index: 5, seated: true },
  read1: { anim: 'read', index: 2, seated: true },
  read2: { anim: 'read', index: 3, seated: true },
  read3: { anim: 'read', index: 4, seated: true },
  read4: { anim: 'read', index: 5, seated: true },
  idle1: { anim: 'idle', index: 0, seated: false },
  idle2: { anim: 'idle', index: 4, seated: false },
  rest1: { anim: 'rest', index: 0, seated: true },
  rest2: { anim: 'rest', index: 1, seated: true },
  raiseHand1: { anim: 'wave', index: 4, seated: false },
  raiseHand2: { anim: 'wave', index: 8, seated: false },
  raiseHandSeated1: { anim: 'waveSeated', index: 4, seated: true },
  raiseHandSeated2: { anim: 'waveSeated', index: 8, seated: true },
  holdForm1: { anim: 'holdForm', index: 4, seated: false },
  holdForm2: { anim: 'holdForm', index: 7, seated: false },
  holdFormSeated1: { anim: 'holdFormSeated', index: 4, seated: true },
  holdFormSeated2: { anim: 'holdFormSeated', index: 7, seated: true },
};

/** An animated prop (a desk growing under typing hands, a particle trail)
 *  can slip into a generated cycle even when the text prompt asks for none:
 *  PixelLab's edit model sometimes keeps extending an object frame over
 *  frame instead of holding the pose. A raised hand or a held-up sheet of
 *  paper legitimately grows the opaque silhouette a lot (measured up to
 *  ~39% here), so the threshold sits above that, in the gap before a real
 *  prop (measured at 47%+ when this last happened, scripts/pixellab/frames/
 *  worker0/type_north-east before this pose set was fixed). */
const PROP_GROWTH_THRESHOLD = 1.45;

function frameArea(img: PixelImage): number {
  let area = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const c = img.get(x, y);
      if (c && c[3] >= OPAQUE_ALPHA_THRESHOLD) area++;
    }
  }
  return area;
}

/** Guards every downloaded animation (standing and seated) against a prop or
 *  particle effect growing into the frame over the cycle: compares each
 *  frame's opaque pixel count against the cycle's first frame and reports
 *  (never silently drops) any direction that crosses PROP_GROWTH_THRESHOLD.
 *  Run before packing so a regression can't reach the bundled sheets. */
function checkGrowthGuard(
  characterId: string,
  anims: readonly string[],
  directions: readonly string[],
): string[] {
  const violations: string[] = [];
  for (const anim of anims) {
    for (const direction of directions) {
      const files: string[] = [];
      for (let i = 0; ; i++) {
        const file = path.join(framesDir, characterId, `${anim}_${direction}_${i}.png`);
        if (!fs.existsSync(file)) break;
        files.push(file);
      }
      if (files.length < 2) continue;
      const areas = files.map((f) => frameArea(isolateCharacter(PixelImage.readPng(f))));
      const base = areas[0];
      if (base <= 0) continue;
      const maxGrowth = Math.max(...areas.slice(1)) / base;
      if (maxGrowth > PROP_GROWTH_THRESHOLD) {
        violations.push(
          `${characterId}/${anim}/${direction}: opaque area grew to ${(maxGrowth * 100).toFixed(0)}% of its first frame (threshold ${(PROP_GROWTH_THRESHOLD * 100).toFixed(0)}%)`,
        );
      }
    }
  }
  return violations;
}

interface CastCharacter {
  id: string;
  dominantColor: string;
}

interface Cast {
  directions: string[];
  standingAnimations: { name: string }[];
  seatedAnimations: { name: string }[];
  characters: CastCharacter[];
}

/** 4-connected flood fill: every opaque pixel's component id, sized by pixel count. */
function componentLabels(img: PixelImage): { labels: Int32Array; sizes: number[] } {
  const visited = new Uint8Array(img.width * img.height);
  const labels = new Int32Array(img.width * img.height).fill(-1);
  const sizes: number[] = [];
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const idx = y * img.width + x;
      if (visited[idx]) continue;
      const c = img.get(x, y);
      if (!c || c[3] < OPAQUE_ALPHA_THRESHOLD) {
        visited[idx] = 1;
        continue;
      }
      const id = sizes.length;
      let size = 0;
      const stack = [idx];
      visited[idx] = 1;
      while (stack.length) {
        const cur = stack.pop()!;
        const cx = cur % img.width;
        const cy = Math.floor(cur / img.width);
        labels[cur] = id;
        size++;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= img.width || ny >= img.height) continue;
          const nidx = ny * img.width + nx;
          if (visited[nidx]) continue;
          visited[nidx] = 1;
          const nc = img.get(nx, ny);
          if (nc && nc[3] >= OPAQUE_ALPHA_THRESHOLD) stack.push(nidx);
        }
      }
      sizes.push(size);
    }
  }
  return { labels, sizes };
}

/** Some PixelLab renders (the CTO's every pose, a handful of worker frames)
 *  carry a small disconnected desk-corner prop at a fixed screen position,
 *  baked in beside the character. Keeping only the largest 4-connected
 *  opaque blob drops it before it can skew centering or bleed into the
 *  packed sheet; the character is always by far the largest blob. */
function isolateCharacter(img: PixelImage): PixelImage {
  const { labels, sizes } = componentLabels(img);
  if (sizes.length <= 1) return img;
  let mainId = 0;
  for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[mainId]) mainId = i;
  const out = new PixelImage(img.width, img.height);
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      if (labels[y * img.width + x] === mainId) out.set(x, y, img.get(x, y));
    }
  return out;
}

function loadFrame(
  characterId: string,
  anim: string,
  direction: string,
  index: number,
): PixelImage {
  const file = path.join(framesDir, characterId, `${anim}_${direction}_${index}.png`);
  return isolateCharacter(PixelImage.readPng(file));
}

/** Lowest row with an opaque pixel: the feet, with the ground. */
function lowestOpaqueRow(img: PixelImage): number {
  for (let y = img.height - 1; y >= 0; y--) {
    for (let x = 0; x < img.width; x++) {
      const c = img.get(x, y);
      if (c && c[3] >= OPAQUE_ALPHA_THRESHOLD) return y;
    }
  }
  throw new Error('frame is fully transparent');
}

/** Horizontal center of the opaque pixels in the image's lower third (hips
 *  and legs), stable across an animation's arm motion. */
function stableCenterX(img: PixelImage): number {
  const top = Math.floor((img.height * 2) / 3);
  let minX = img.width;
  let maxX = -1;
  for (let y = top; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const c = img.get(x, y);
      if (c && c[3] >= OPAQUE_ALPHA_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
  }
  if (maxX < 0) throw new Error('frame has no opaque pixels in its lower third');
  return (minX + maxX + 1) / 2;
}

/** The crown of the character: the topmost opaque row of its standing or
 *  seated reference pose, as "rows above the baseline" (art px). */
function crownRiseArtPx(img: PixelImage): number {
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const c = img.get(x, y);
      if (c && c[3] >= OPAQUE_ALPHA_THRESHOLD) return y;
    }
  }
  throw new Error('frame is fully transparent');
}

interface Placement {
  dy: number;
  centerX: number;
}

function placementFor(characterId: string, source: FrameSource, direction: string): Placement {
  const ref = loadFrame(characterId, source.seated ? 'rest' : 'idle', direction, 0);
  const footRow = lowestOpaqueRow(ref);
  const baseline = source.seated ? BASELINE_Y - SEAT_RAISE_ART_PX : BASELINE_Y;
  return { dy: baseline - footRow, centerX: stableCenterX(ref) };
}

function composeFrame(characterId: string, source: FrameSource, direction: string): PixelImage {
  const raw = loadFrame(characterId, source.anim, direction, source.index);
  const placement = placementFor(characterId, source, direction);
  const canvas = new PixelImage(CHAR_FRAME_W, CHAR_FRAME_H);
  const dx = Math.round(CHAR_FRAME_W / 2 - placement.centerX);
  canvas.blit(raw, dx, placement.dy);
  return canvas;
}

function renderSheet(characterId: string): PixelImage {
  const sheet = new PixelImage(CHAR_FRAME_W * CHAR_FRAMES_PER_ROW, CHAR_FRAME_H * 3);
  CHARACTER_FRAMES.forEach((frame, i) => {
    const source = FRAME_SOURCE[frame];
    const down = composeFrame(characterId, source, 'south-west');
    const up = composeFrame(characterId, source, 'north-east');
    sheet.blit(down, i * CHAR_FRAME_W, 0);
    sheet.blit(up, i * CHAR_FRAME_W, CHAR_FRAME_H);
    sheet.blit(down.mirrored(), i * CHAR_FRAME_W, CHAR_FRAME_H * 2);
  });
  return sheet;
}

/** Crown height above the shared floor anchor (not the pose's own feet):
 *  standing uses it directly, seated adds SEAT_RAISE_ART_PX because
 *  placementFor lifts the whole seated pose by that much. PixelLab's seated
 *  renders crouch rather than drop the hips, so the raw body height (feet to
 *  crown) barely shrinks. Seated crowns measure taller than standing once
 *  the chair raise is added back in, a known quirk of this pose set. */
function measureCrownHeights(characterId: string): { standingArtPx: number; seatedArtPx: number } {
  const standing = loadFrame(characterId, 'idle', 'south-west', 0);
  const seated = loadFrame(characterId, 'rest', 'south-west', 0);
  const standingFoot = lowestOpaqueRow(standing);
  const seatedFoot = lowestOpaqueRow(seated);
  const standingCrown = crownRiseArtPx(standing);
  const seatedCrown = crownRiseArtPx(seated);
  return {
    standingArtPx: standingFoot - standingCrown,
    seatedArtPx: SEAT_RAISE_ART_PX + (seatedFoot - seatedCrown),
  };
}

function main(): void {
  const preview = process.argv.includes('--preview');
  const cast: Cast = JSON.parse(fs.readFileSync(castFile, 'utf8'));
  const previewDir = '/tmp/pixellab-preview';
  const sheets: PixelImage[] = [];
  const allAnims = [...cast.standingAnimations, ...cast.seatedAnimations].map((a) => a.name);

  const violations = cast.characters.flatMap((ch) =>
    checkGrowthGuard(ch.id, allAnims, cast.directions),
  );
  if (violations.length > 0) {
    console.error(`[pack] prop/particle growth guard failed:\n${violations.join('\n')}`);
    throw new Error(`${violations.length} animation(s) failed the growth guard, see above`);
  }

  for (const ch of cast.characters) {
    const sheet = renderSheet(ch.id);
    const file =
      ch.id === 'cto'
        ? path.join(assetsDir, 'cto.png')
        : path.join(assetsDir, `char_${ch.id.replace('worker', '')}.png`);
    sheet.writePng(file);
    sheets.push(sheet);

    const crown = measureCrownHeights(ch.id);
    console.log(
      `[pack] ${ch.id}: standing crown ${crown.standingArtPx}art/${crown.standingArtPx / 2}world px, ` +
        `seated crown ${crown.seatedArtPx}art/${crown.seatedArtPx / 2}world px`,
    );

    if (preview) {
      fs.mkdirSync(path.join(previewDir, ch.id), { recursive: true });
      for (const frame of CHARACTER_FRAMES) {
        const source = FRAME_SOURCE[frame];
        const down = composeFrame(ch.id, source, 'south-west');
        const up = composeFrame(ch.id, source, 'north-east');
        contactSheet([down, up], 3).writePng(path.join(previewDir, ch.id, `${frame}.png`));
      }
    }
  }

  if (preview) {
    contactSheet(sheets, 1, 8).writePng(path.join(previewDir, 'all-sheets.png'));
  }

  console.log(`[pack] wrote ${sheets.length} character sheets to ${assetsDir}`);
}

main();
