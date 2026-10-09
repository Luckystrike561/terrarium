/**
 * Night city skyline painted behind the office, as raw RGBA pixels. DOM-free:
 * the scene renderer uploads the result as one nearest-sampled texture.
 *
 * Everything is a pure function of the pixel coordinates (hashed, never
 * random), with the skyline anchored to the bottom-left corner, so a resize
 * extends the city instead of reshuffling it.
 */

import {
  BACKDROP_ANTENNA_CHANCE,
  BACKDROP_ANTENNA_HEIGHT_PX,
  BACKDROP_FAR_BUILDING_COLOR,
  BACKDROP_FAR_BUILDING_HEIGHT_PX,
  BACKDROP_FAR_BUILDING_WIDTH_PX,
  BACKDROP_NEAR_BUILDING_COLOR,
  BACKDROP_NEAR_BUILDING_HEIGHT_PX,
  BACKDROP_NEAR_BUILDING_WIDTH_PX,
  BACKDROP_SKY_COLORS,
  BACKDROP_STAR_CELL_PX,
  BACKDROP_STAR_CHANCE,
  BACKDROP_STAR_COLORS,
  BACKDROP_STAR_CUTOFF,
  BACKDROP_WINDOW_DIM_COLOR,
  BACKDROP_WINDOW_HEIGHT_PX,
  BACKDROP_WINDOW_INSET_PX,
  BACKDROP_WINDOW_LIT_CHANCE,
  BACKDROP_WINDOW_LIT_COLOR,
  BACKDROP_WINDOW_STEP_X_PX,
  BACKDROP_WINDOW_STEP_Y_PX,
} from '../constants.js';
import { hexToNumber } from './engine/pixiColor.js';

export interface BackdropImage {
  width: number;
  height: number;
  /** Row-major RGBA, fully opaque. */
  pixels: Uint8ClampedArray<ArrayBuffer>;
}

type Range = readonly [number, number];

const BYTES_PER_PIXEL = 4;
const OPAQUE = 255;

/** 4×4 ordered-dither thresholds, so the sky bands blend in pixel-art steps. */
const BAYER_4X4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const;
const BAYER_SIZE = 4;
const BAYER_LEVELS = 16;

/** Independent hash streams, one per decision. */
const Salt = {
  star: 1,
  starX: 2,
  starY: 3,
  starBrightness: 4,
  farWidth: 5,
  farHeight: 6,
  antenna: 7,
  nearWidth: 8,
  nearHeight: 9,
  nearStagger: 10,
  window: 11,
} as const;

/** Deterministic hash of two integers into [0, 1). */
function hash01(a: number, b: number, salt: number): number {
  let h = Math.imul(a, 0x27d4eb2d) ^ Math.imul(b, 0x165667b1) ^ Math.imul(salt, 0x9e3779b9);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 0x1_0000_0000;
}

function pickInRange([min, max]: Range, t: number): number {
  return min + Math.floor(t * (max - min));
}

/** `#RRGGBB` → one opaque pixel as the platform's Uint32 view reads it, so
 *  rows can be filled a word at a time whatever the byte order. */
function toPixel(hex: string): number {
  const rgb = hexToNumber(hex);
  const bytes = new Uint8ClampedArray([(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff, OPAQUE]);
  return new Uint32Array(bytes.buffer)[0];
}

class PixelCanvas {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray<ArrayBuffer>;
  private readonly words: Uint32Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8ClampedArray(width * height * BYTES_PER_PIXEL);
    this.words = new Uint32Array(this.pixels.buffer);
  }

  fillRect(x: number, y: number, w: number, h: number, pixel: number): void {
    const left = Math.max(0, x);
    const right = Math.min(this.width, x + w);
    if (left >= right) return;
    for (let row = Math.max(0, y); row < Math.min(this.height, y + h); row++) {
      this.words.fill(pixel, row * this.width + left, row * this.width + right);
    }
  }

  /** Tiles `pattern` across row `y`, doubling the written span each copy. */
  fillRowWithPattern(y: number, pattern: readonly number[]): void {
    const start = y * this.width;
    const end = start + this.width;
    const seed = Math.min(pattern.length, this.width);
    for (let i = 0; i < seed; i++) this.words[start + i] = pattern[i];
    for (let filled = seed; filled < this.width; filled *= 2) {
      this.words.copyWithin(start + filled, start, Math.min(start + filled, end - filled));
    }
  }
}

function paintSky(canvas: PixelCanvas): void {
  const bands = BACKDROP_SKY_COLORS.map(toPixel);
  const lastBand = bands.length - 1;
  for (let y = 0; y < canvas.height; y++) {
    const position = (canvas.height > 1 ? y / (canvas.height - 1) : 0) * lastBand;
    const band = Math.min(Math.floor(position), lastBand);
    const blend = position - band;
    const lower = bands[band];
    const upper = bands[Math.min(band + 1, lastBand)];
    const ditherRow = (y % BAYER_SIZE) * BAYER_SIZE;
    const pattern = BAYER_4X4.slice(ditherRow, ditherRow + BAYER_SIZE).map((level) =>
      blend > level / BAYER_LEVELS ? upper : lower,
    );
    canvas.fillRowWithPattern(y, pattern);
  }
}

function paintStars(canvas: PixelCanvas): void {
  const stars = BACKDROP_STAR_COLORS.map(toPixel);
  const skyHeight = Math.floor(canvas.height * BACKDROP_STAR_CUTOFF);
  for (let cellY = 0; cellY * BACKDROP_STAR_CELL_PX < skyHeight; cellY++) {
    for (let cellX = 0; cellX * BACKDROP_STAR_CELL_PX < canvas.width; cellX++) {
      if (hash01(cellX, cellY, Salt.star) >= BACKDROP_STAR_CHANCE) continue;
      const x = (cellX + hash01(cellX, cellY, Salt.starX)) * BACKDROP_STAR_CELL_PX;
      const y = (cellY + hash01(cellX, cellY, Salt.starY)) * BACKDROP_STAR_CELL_PX;
      if (y >= skyHeight) continue;
      const brightness = Math.floor(hash01(cellX, cellY, Salt.starBrightness) * stars.length);
      canvas.fillRect(Math.floor(x), Math.floor(y), 1, 1, stars[brightness]);
    }
  }
}

function paintFarSkyline(canvas: PixelCanvas): void {
  const color = toPixel(BACKDROP_FAR_BUILDING_COLOR);
  for (let index = 0, x = 0; x < canvas.width; index++) {
    const width = pickInRange(BACKDROP_FAR_BUILDING_WIDTH_PX, hash01(index, 0, Salt.farWidth));
    const height = pickInRange(BACKDROP_FAR_BUILDING_HEIGHT_PX, hash01(index, 0, Salt.farHeight));
    const top = canvas.height - height;
    canvas.fillRect(x, top, width, height, color);
    if (hash01(index, 0, Salt.antenna) < BACKDROP_ANTENNA_CHANCE) {
      canvas.fillRect(
        x + Math.floor(width / 2),
        top - BACKDROP_ANTENNA_HEIGHT_PX,
        1,
        BACKDROP_ANTENNA_HEIGHT_PX,
        color,
      );
    }
    x += width;
  }
}

function paintWindows(
  canvas: PixelCanvas,
  building: { index: number; x: number; top: number; width: number },
): void {
  const lit = toPixel(BACKDROP_WINDOW_LIT_COLOR);
  const dim = toPixel(BACKDROP_WINDOW_DIM_COLOR);
  const right = building.x + building.width - BACKDROP_WINDOW_INSET_PX;
  for (
    let y = building.top + BACKDROP_WINDOW_INSET_PX;
    y + BACKDROP_WINDOW_HEIGHT_PX <= canvas.height;
    y += BACKDROP_WINDOW_STEP_Y_PX
  ) {
    for (let x = building.x + BACKDROP_WINDOW_INSET_PX; x < right; x += BACKDROP_WINDOW_STEP_X_PX) {
      const isLit =
        hash01(building.index * BACKDROP_WINDOW_STEP_X_PX + x, canvas.height - y, Salt.window) <
        BACKDROP_WINDOW_LIT_CHANCE;
      canvas.fillRect(x, y, 1, BACKDROP_WINDOW_HEIGHT_PX, isLit ? lit : dim);
    }
  }
}

function paintNearSkyline(canvas: PixelCanvas): void {
  const color = toPixel(BACKDROP_NEAR_BUILDING_COLOR);
  const stagger = pickInRange(BACKDROP_NEAR_BUILDING_WIDTH_PX, hash01(0, 0, Salt.nearStagger));
  for (let index = 0, x = -stagger; x < canvas.width; index++) {
    const width = pickInRange(BACKDROP_NEAR_BUILDING_WIDTH_PX, hash01(index, 0, Salt.nearWidth));
    const height = pickInRange(BACKDROP_NEAR_BUILDING_HEIGHT_PX, hash01(index, 0, Salt.nearHeight));
    const top = canvas.height - height;
    canvas.fillRect(x, top, width, height, color);
    paintWindows(canvas, { index, x, top, width });
    x += width;
  }
}

/** Paints a `width`×`height` backdrop, every pixel opaque. */
export function paintNightSkyline(width: number, height: number): BackdropImage {
  const canvas = new PixelCanvas(Math.max(1, width), Math.max(1, height));
  paintSky(canvas);
  paintStars(canvas);
  paintFarSkyline(canvas);
  paintNearSkyline(canvas);
  return { width: canvas.width, height: canvas.height, pixels: canvas.pixels };
}
