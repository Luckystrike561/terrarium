/**
 * Generate the 16×16 grayscale floor patterns (`floor_0.png`..`floor_8.png`).
 *
 * Each pattern is one material: a grid of slabs, planks or bricks, lit like
 * the furniture (seam toward the key light one band brighter, an inset edge
 * one band darker so each piece reads as slightly raised) and flat in
 * between, like Habbo's floor tiles. Only wood carries grain. The webview
 * projects the square onto a 32×16 diamond and colourizes it per tile
 * (`colorizeSprite`, Photoshop Colorize mode), so the pattern only carries
 * luminance: alternating tones stay readable after any hue/saturation/
 * brightness/contrast the room applies.
 *
 * Only the top and left edge of each cell carries the bright seam: tiled
 * edge to edge, the next cell's own seam covers the shared boundary, so the
 * pattern repeats with no doubled or missing line.
 */

import type { RGBA } from './lib/image.js';
import { PixelImage } from './lib/image.js';
import { hash3 } from './lib/scene.js';

const SIZE = 16;
const BASE_GRAY = 162;
const BEVEL_DARK = -18;
const GRAIN_BAND = 9;

function gray(v: number): RGBA {
  const c = Math.max(0, Math.min(255, Math.round(v)));
  return [c, c, c, 255];
}

interface SlabSpec {
  /** Cell size in pixels. A 16×16 cell is one slab per tile. */
  cellW: number;
  cellH: number;
  /** Brightness shift of the top/left seam line, relative to the base. */
  seamDelta: number;
  /** Shift every other row-band of cells sideways by this many px, for a
   *  running-bond brick course. 0 keeps cells aligned in a plain grid. */
  runningBondPx?: number;
  /** Alternate two flat tones by cell parity (checkerboard) instead of a
   *  seamed grid. */
  checker?: { low: number; high: number };
  /** Seed of the horizontal grain streaks of wood planks. Other materials
   *  are flat between their seams. */
  grainSeed?: number;
}

function renderSlabPattern(spec: SlabSpec): PixelImage {
  const img = new PixelImage(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    const band = Math.floor(y / spec.cellH);
    const shiftedX = (x: number): number => {
      if (!spec.runningBondPx || band % 2 === 0) return x;
      return (((x + spec.runningBondPx) % SIZE) + SIZE) % SIZE;
    };
    for (let x = 0; x < SIZE; x++) {
      const cx = shiftedX(x);
      const localX = cx % spec.cellW;
      const localY = y % spec.cellH;

      let v = BASE_GRAY;
      if (spec.checker) {
        const cellCol = Math.floor(cx / spec.cellW);
        const cellRow = Math.floor(y / spec.cellH);
        v = (cellCol + cellRow) % 2 === 0 ? spec.checker.low : spec.checker.high;
      }

      if (localY === 0 || localX === 0) {
        v += spec.seamDelta;
      } else if (localY === spec.cellH - 1 || localX === spec.cellW - 1) {
        v += BEVEL_DARK;
      }

      if (spec.grainSeed !== undefined) {
        const grain = hash3(Math.floor(x / 2), band, spec.grainSeed) - 0.5;
        v += grain * GRAIN_BAND;
      }

      img.set(x, y, gray(v));
    }
  }
  return img;
}

/** One entry per `floor_N.png`, in index order. Keep the same material at
 *  each index: the default layout and any saved layout reference tiles by
 *  this pattern index. */
const PATTERNS: SlabSpec[] = [
  // floor_0: plain polished slab, one cell per tile, faint seam.
  { cellW: 16, cellH: 16, seamDelta: 14 },
  // floor_1: large pale tile, bright seam.
  { cellW: 16, cellH: 16, seamDelta: 30 },
  // floor_2: large tile, dark grout.
  { cellW: 16, cellH: 16, seamDelta: -26 },
  // floor_3: small square tile, dark grout.
  { cellW: 8, cellH: 8, seamDelta: -24 },
  // floor_4: wood planks, warm grain.
  { cellW: 16, cellH: 4, seamDelta: 20, grainSeed: 12 },
  // floor_5: running-bond brick, bright mortar.
  { cellW: 8, cellH: 4, seamDelta: 28, runningBondPx: 4 },
  // floor_6: aligned brick/plank, dark mortar.
  { cellW: 8, cellH: 4, seamDelta: -24 },
  // floor_7: fine checkerboard.
  { cellW: 4, cellH: 4, seamDelta: 0, checker: { low: 68, high: 234 } },
  // floor_8: coarse checkerboard.
  { cellW: 8, cellH: 8, seamDelta: 0, checker: { low: 68, high: 234 } },
];

export function renderFloorTiles(): PixelImage[] {
  return PATTERNS.map(renderSlabPattern);
}
