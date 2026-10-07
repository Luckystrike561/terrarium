import * as fs from 'fs';
import * as path from 'path';

import { PNG } from 'pngjs';

export type RGBA = readonly [number, number, number, number];

export const TRANSPARENT: RGBA = [0, 0, 0, 0];

export function hex(value: string, alpha = 255): RGBA {
  const v = value.replace('#', '');
  return [
    parseInt(v.slice(0, 2), 16),
    parseInt(v.slice(2, 4), 16),
    parseInt(v.slice(4, 6), 16),
    v.length >= 8 ? parseInt(v.slice(6, 8), 16) : alpha,
  ];
}

/** Multiply RGB toward black (`amount` < 1) or toward white (`amount` > 1). */
export function shade(c: RGBA, amount: number): RGBA {
  const f = (x: number) =>
    amount <= 1 ? Math.round(x * amount) : Math.round(x + (255 - x) * (amount - 1));
  return [f(c[0]), f(c[1]), f(c[2]), c[3]];
}

export function mix(a: RGBA, b: RGBA, t: number): RGBA {
  const f = (i: number) => Math.round(a[i] + (b[i] - a[i]) * t);
  return [f(0), f(1), f(2), f(3)];
}

export class PixelImage {
  readonly data: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Uint8Array(width * height * 4);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  get(x: number, y: number): RGBA | null {
    if (!this.inBounds(x, y)) return null;
    const i = (y * this.width + x) * 4;
    if (this.data[i + 3] === 0) return null;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }

  set(x: number, y: number, c: RGBA | null): void {
    if (!this.inBounds(x, y)) return;
    const i = (y * this.width + x) * 4;
    const v = c ?? TRANSPARENT;
    this.data[i] = v[0];
    this.data[i + 1] = v[1];
    this.data[i + 2] = v[2];
    this.data[i + 3] = v[3];
  }

  fillRect(x: number, y: number, w: number, h: number, c: RGBA): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c);
  }

  /** Copy opaque pixels of `src` onto this image at (dx, dy). */
  blit(src: PixelImage, dx: number, dy: number): void {
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        const c = src.get(x, y);
        if (c) this.set(dx + x, dy + y, c);
      }
    }
  }

  mirrored(): PixelImage {
    const out = new PixelImage(this.width, this.height);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) out.set(this.width - 1 - x, y, this.get(x, y));
    }
    return out;
  }

  /** Draw a template: one string per row, each char looked up in `palette`
   *  (`.` and space are transparent). */
  stamp(rows: readonly string[], palette: Record<string, RGBA>, dx = 0, dy = 0): void {
    rows.forEach((row, y) => {
      [...row].forEach((ch, x) => {
        if (ch === '.' || ch === ' ') return;
        const c = palette[ch];
        if (!c) throw new Error(`stamp: no palette entry for '${ch}'`);
        this.set(dx + x, dy + y, c);
      });
    });
  }

  writePng(file: string): void {
    const png = new PNG({ width: this.width, height: this.height });
    png.data = Buffer.from(this.data);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, PNG.sync.write(png));
  }

  static readPng(file: string): PixelImage {
    const png = PNG.sync.read(fs.readFileSync(file));
    const img = new PixelImage(png.width, png.height);
    img.data.set(png.data);
    return img;
  }
}

/** Lay images out left to right on one sheet, upscaled, over a checker
 *  background, for eyeballing generated art. */
export function contactSheet(images: readonly PixelImage[], scale = 4, gap = 4): PixelImage {
  const w = images.reduce((s, im) => s + im.width + gap, gap);
  const h = images.reduce((m, im) => Math.max(m, im.height), 0) + gap * 2;
  const sheet = new PixelImage(w * scale, h * scale);
  const a = hex('#3b3550');
  const b = hex('#433c5a');
  for (let y = 0; y < sheet.height; y++) {
    for (let x = 0; x < sheet.width; x++) {
      sheet.set(x, y, (Math.floor(x / (8 * scale)) + Math.floor(y / (8 * scale))) % 2 ? a : b);
    }
  }
  let ox = gap;
  for (const im of images) {
    const oy = h - gap - im.height;
    for (let y = 0; y < im.height; y++) {
      for (let x = 0; x < im.width; x++) {
        const c = im.get(x, y);
        if (c) sheet.fillRect((ox + x) * scale, (oy + y) * scale, scale, scale, c);
      }
    }
    ox += im.width + gap;
  }
  return sheet;
}
