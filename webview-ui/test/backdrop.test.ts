/**
 * The backdrop fills the canvas edge to edge at any aspect ratio, and a resize
 * extends the skyline rather than reshuffling it.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import { paintNightSkyline } from '../src/office/backdrop.js';

const ALPHA_OFFSET = 3;
const BYTES_PER_PIXEL = 4;

test('every pixel is opaque at wide, tall, square and degenerate sizes', () => {
  for (const [width, height] of [
    [800, 350],
    [350, 800],
    [400, 400],
    [1, 1],
    [0, 0],
  ]) {
    const image = paintNightSkyline(width, height);
    assert.equal(image.pixels.length, image.width * image.height * BYTES_PER_PIXEL);
    for (let i = ALPHA_OFFSET; i < image.pixels.length; i += BYTES_PER_PIXEL) {
      assert.equal(image.pixels[i], 255, `transparent pixel at ${width}x${height}, byte ${i}`);
    }
  }
});

test('widening the canvas keeps the existing columns unchanged', () => {
  const height = 300;
  const narrowWidth = 400;
  const wideWidth = 700;
  const narrow = paintNightSkyline(narrowWidth, height);
  const wide = paintNightSkyline(wideWidth, height);
  const narrowRowBytes = narrowWidth * BYTES_PER_PIXEL;
  const wideRowBytes = wideWidth * BYTES_PER_PIXEL;
  for (let y = 0; y < height; y++) {
    const narrowRow = narrow.pixels.subarray(y * narrowRowBytes, (y + 1) * narrowRowBytes);
    const wideRow = wide.pixels.subarray(y * wideRowBytes, y * wideRowBytes + narrowRowBytes);
    assert.deepEqual(narrowRow, wideRow, `row ${y} changed`);
  }
});
