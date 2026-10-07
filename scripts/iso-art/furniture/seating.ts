import type { PixelImage, RGBA } from '../lib/image.js';
import { mix } from '../lib/image.js';
import { CHAIR_SEAT_Z } from '../lib/iso.js';
import { PAL } from '../lib/palette.js';
import type { Paint } from '../lib/scene.js';
import { IsoScene, lit, solid } from '../lib/scene.js';
import type { FurnitureSpec, FurnitureVariant } from '../lib/furniture.js';

const OFFICE_FABRIC = PAL.fabricRed;
const OFFICE_FABRIC_DARK = mix(PAL.fabricRed, PAL.black, 0.3);
const OFFICE_BASE = PAL.metal;
const SOFA_CUSHION = mix(PAL.plastic, PAL.wood, 0.18);
const SOFA_CUSHION_SEAM = mix(SOFA_CUSHION, PAL.black, 0.25);
const SOFA_PLINTH = PAL.woodDark;
const BENCH_CUSHION = mix(PAL.fabricBlue, PAL.plastic, 0.45);
const BENCH_CUSHION_SEAM = mix(PAL.fabricBlue, PAL.black, 0.3);
const BENCH_FRAME = PAL.metalDark;

function seamPaint(base: RGBA, seam: RGBA, positions: number[], tol = 0.8): Paint {
  return (hit) => {
    const c = lit(base, hit.light);
    if (hit.face === 'top' && positions.some((p) => Math.abs(hit.a - p) < tol)) {
      return mix(c, seam, 0.55);
    }
    return c;
  };
}

function grainPaint(base: RGBA, grain: RGBA): Paint {
  return (hit) => {
    const c = lit(base, hit.light);
    if (hit.face !== 'top') return c;
    return Math.floor(hit.b / 2) % 2 === 0 ? mix(c, grain, 0.14) : c;
  };
}

function buildOfficeChair(backHigh: boolean): PixelImage {
  const scene = new IsoScene(1, 1, 24);
  scene.cylinder(8, 8, 6.5, 0, 1, solid(OFFICE_BASE));
  scene.cylinder(8, 8, 1.6, 1, 4, solid(PAL.chrome));
  scene.box([2, 2, 4], [14, 14, CHAIR_SEAT_Z], seamPaint(OFFICE_FABRIC, OFFICE_FABRIC_DARK, [6]));
  const y0 = backHigh ? 12 : 1;
  const y1 = backHigh ? 15 : 4;
  scene.box([2, y0, CHAIR_SEAT_Z], [14, y1, 18], seamPaint(OFFICE_FABRIC, OFFICE_FABRIC_DARK, [6]));
  scene.box([1, 3, 7], [3, 11, 10], solid(PAL.plasticDark));
  scene.box([13, 3, 7], [15, 11, 10], solid(PAL.plasticDark));
  return scene.render();
}

function buildWoodenChair(backHigh: boolean): PixelImage {
  const scene = new IsoScene(1, 1, 20);
  for (const lx of [1, 11]) {
    for (const ly of [1, 11]) {
      scene.box([lx, ly, 0], [lx + 2, ly + 2, CHAIR_SEAT_Z], solid(PAL.wood));
    }
  }
  scene.box([2, 2, 5], [14, 14, CHAIR_SEAT_Z], grainPaint(PAL.woodLight, PAL.woodGrain));
  const sy0 = backHigh ? 13 : 1;
  const sy1 = backHigh ? 15 : 3;
  for (const sx of [3, 7, 11]) {
    scene.box([sx, sy0, CHAIR_SEAT_Z], [sx + 2, sy1, 16], solid(PAL.wood));
  }
  scene.box([2, sy0, 16], [14, sy1, 17], solid(PAL.woodDark));
  return scene.render();
}

function buildSofa(backHigh: boolean): PixelImage {
  const scene = new IsoScene(2, 1, 22);
  scene.box([1, 2, 0], [31, 13, 2], solid(SOFA_PLINTH));
  scene.box([4, 3, 2], [15, 13, CHAIR_SEAT_Z], seamPaint(SOFA_CUSHION, SOFA_CUSHION_SEAM, [5.5]));
  scene.box([17, 3, 2], [28, 13, CHAIR_SEAT_Z], seamPaint(SOFA_CUSHION, SOFA_CUSHION_SEAM, [5.5]));
  const y0 = backHigh ? 13 : 0;
  const y1 = backHigh ? 16 : 3;
  scene.box([3, y0, CHAIR_SEAT_Z], [29, y1, 20], seamPaint(SOFA_CUSHION, SOFA_CUSHION_SEAM, [13]));
  scene.box([0, 1, 0], [3, 14, 13], solid(SOFA_CUSHION));
  scene.box([29, 1, 0], [32, 14, 13], solid(SOFA_CUSHION));
  return scene.render();
}

function buildCushionedBench(): PixelImage {
  const scene = new IsoScene(2, 1, 10);
  scene.box([1, 3, 0], [31, 13, 2], solid(BENCH_FRAME));
  scene.box(
    [2, 4, 2],
    [30, 12, CHAIR_SEAT_Z],
    seamPaint(BENCH_CUSHION, BENCH_CUSHION_SEAM, [9, 19]),
  );
  return scene.render();
}

function buildWoodenBench(): PixelImage {
  const scene = new IsoScene(2, 1, 8);
  for (const lx of [1, 29]) {
    for (const ly of [2, 10]) {
      scene.box([lx, ly, 0], [lx + 2, ly + 2, 5], solid(PAL.wood));
    }
  }
  scene.box([3, 6, 3], [29, 10, 4], solid(PAL.woodDark));
  scene.box([1, 3, 5], [31, 13, CHAIR_SEAT_Z], grainPaint(PAL.woodLight, PAL.woodGrain));
  return scene.render();
}

function fourWay(fw: number, fh: number, front: PixelImage, back: PixelImage): FurnitureVariant[] {
  return [
    { orientation: 'front', footprintW: fw, footprintH: fh, images: [front] },
    { orientation: 'right', footprintW: fh, footprintH: fw, images: [front.mirrored()] },
    { orientation: 'back', footprintW: fw, footprintH: fh, images: [back] },
    { orientation: 'left', footprintW: fh, footprintH: fw, images: [back.mirrored()] },
  ];
}

export const ITEMS: FurnitureSpec[] = [
  {
    id: 'CUSHIONED_CHAIR',
    name: 'Office Chair',
    category: 'chairs',
    variants: fourWay(1, 1, buildOfficeChair(false), buildOfficeChair(true)),
  },
  {
    id: 'WOODEN_CHAIR',
    name: 'Wooden Chair',
    category: 'chairs',
    variants: fourWay(1, 1, buildWoodenChair(false), buildWoodenChair(true)),
  },
  {
    id: 'SOFA',
    name: 'Sofa',
    category: 'chairs',
    variants: fourWay(2, 1, buildSofa(false), buildSofa(true)),
  },
  {
    id: 'CUSHIONED_BENCH',
    name: 'Cushioned Bench',
    category: 'chairs',
    variants: (() => {
      const front = buildCushionedBench();
      return [
        { orientation: 'front', footprintW: 2, footprintH: 1, images: [front] },
        { orientation: 'right', footprintW: 1, footprintH: 2, images: [front.mirrored()] },
      ] satisfies FurnitureVariant[];
    })(),
  },
  {
    id: 'WOODEN_BENCH',
    name: 'Wooden Bench',
    category: 'chairs',
    variants: (() => {
      const front = buildWoodenBench();
      return [
        { orientation: 'front', footprintW: 2, footprintH: 1, images: [front] },
        { orientation: 'right', footprintW: 1, footprintH: 2, images: [front.mirrored()] },
      ] satisfies FurnitureVariant[];
    })(),
  },
];
