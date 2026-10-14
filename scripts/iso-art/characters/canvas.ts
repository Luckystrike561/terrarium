/**
 * Shared drawing primitives for character sheets: a letter-indexed pixel
 * canvas and the pixel masks used to paint, outline and shade its parts.
 * Shared by the posed body (`body.ts`) and the head (`head.ts`) so a limb,
 * a torso and a hairstyle all outline and shade the same way.
 */

import type { RGBA } from '../lib/image.js';
import { PixelImage } from '../lib/image.js';

/** Letter for empty pixels. */
const EMPTY = '.';
const INK = 'o';

export class LetterCanvas {
  private readonly cells: string[];

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.cells = new Array<string>(width * height).fill(EMPTY);
  }

  get(x: number, y: number): string {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return EMPTY;
    return this.cells[y * this.width + x];
  }

  set(x: number, y: number, letter: string): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.cells[y * this.width + x] = letter;
  }

  /** Fill every mask pixel with the letter `paint` picks for it. */
  fill(mask: Mask, paint: (x: number, y: number) => string): void {
    mask.forEach((x, y) => this.set(x, y, paint(x, y)));
  }

  /** Ink every pixel outside the mask that touches it edge to edge. */
  ring(mask: Mask): void {
    mask.forEach((x, y) => {
      for (const [nx, ny] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ] as const) {
        if (!mask.has(nx, ny)) this.set(nx, ny, INK);
      }
    });
  }

  /** Fill, then outline: one opaque, inked part. */
  part(mask: Mask, paint: (x: number, y: number) => string): void {
    this.fill(mask, paint);
    this.ring(mask);
  }

  /** Draw a letter template; `.` and space stay untouched. */
  stamp(rows: readonly string[], dx: number, dy: number): void {
    rows.forEach((row, y) => {
      [...row].forEach((letter, x) => {
        if (letter !== '.' && letter !== ' ') this.set(dx + x, dy + y, letter);
      });
    });
  }

  toImage(palette: Record<string, RGBA>): PixelImage {
    const img = new PixelImage(this.width, this.height);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const letter = this.get(x, y);
        if (letter === EMPTY) continue;
        const color = palette[letter];
        if (!color) throw new Error(`character palette has no colour for '${letter}'`);
        img.set(x, y, color);
      }
    }
    return img;
  }
}

/** A set of frame pixels. */
export class Mask {
  private readonly pixels = new Set<number>();

  constructor(
    readonly width: number,
    readonly height: number,
  ) {}

  has(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
    return this.pixels.has(y * this.width + x);
  }

  add(x: number, y: number): this {
    if (x >= 0 && y >= 0 && x < this.width && y < this.height) this.pixels.add(y * this.width + x);
    return this;
  }

  /** Pixels x0..x1 (inclusive) of row y. */
  span(y: number, x0: number, x1: number): this {
    for (let x = x0; x <= x1; x++) this.add(x, y);
    return this;
  }

  /** Every row of `rows` (top to bottom), each a [left, right] inclusive
   *  span, starting at `top`. */
  rows(top: number, spans: readonly (readonly [number, number])[]): this {
    spans.forEach(([left, right], i) => this.span(top + i, left, right));
    return this;
  }

  /** Pixels whose centre lies within `radius` of the segment a→b. */
  segment(a: Joint, b: Joint, radius: number): this {
    const [ax, ay] = a;
    const [bx, by] = b;
    const minX = Math.floor(Math.min(ax, bx) - radius);
    const maxX = Math.ceil(Math.max(ax, bx) + radius);
    const minY = Math.floor(Math.min(ay, by) - radius);
    const maxY = Math.ceil(Math.max(ay, by) + radius);
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy || 1;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
        const ex = px - (ax + t * dx);
        const ey = py - (ay + t * dy);
        if (ex * ex + ey * ey <= radius * radius + 1e-9) this.add(x, y);
      }
    }
    return this;
  }

  forEach(visit: (x: number, y: number) => void): void {
    for (const i of [...this.pixels].sort((p, q) => p - q)) {
      visit(i % this.width, Math.floor(i / this.width));
    }
  }
}

/** A pixel-centre position in the frame. */
export type Joint = readonly [number, number];

/** Lit left edge, shaded right edge, base in between: a limb, a shoe, a
 *  hairline. */
export function roundShade(mask: Mask, light: string, base: string, dark: string) {
  return (x: number, y: number): string => {
    if (!mask.has(x + 1, y)) return dark;
    if (!mask.has(x - 1, y)) return light;
    return base;
  };
}
