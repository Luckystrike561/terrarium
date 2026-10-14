import type { PixelImage, RGBA } from '../lib/image.js';
import { mix } from '../lib/image.js';
import { CHAIR_SEAT_Z } from '../lib/iso.js';
import { PAL } from '../lib/palette.js';
import type { Paint } from '../lib/scene.js';
import { fabric, glossyTop, IsoScene, solid } from '../lib/scene.js';
import type { FurnitureSpec, FurnitureVariant } from '../lib/furniture.js';

const CHROME = PAL.chrome;
const CHROME_DARK = PAL.metalDark;
const PLASTO_SHELL = PAL.plasticWhite;
const NORJA_LEG = PAL.metal;
const NORJA_SEAT = PAL.upholsteryCream;
const SOFA_FRAME = PAL.woodDark;
const SOFA_FABRIC = PAL.upholsteryTeal;
const SOFA_FABRIC_SEAM = mix(SOFA_FABRIC, PAL.black, 0.3);
const SOFA_TRIM = PAL.gold;
const BENCH_CUSHION = PAL.upholsteryOrange;
const BENCH_CUSHION_SEAM = mix(BENCH_CUSHION, PAL.black, 0.3);
const BENCH_FRAME = PAL.metalDark;
const WOOD_LEG = PAL.woodLight;
const WOOD_SEAT = PAL.wood;
const EXEC_SHELL = PAL.terracotta;
const EXEC_SHELL_SEAM = mix(EXEC_SHELL, PAL.black, 0.3);
const EXEC_TRIM = PAL.gold;
const STOOL_SEAT = PAL.plasticYellow;

/** Seams across a cushion's top face over a base paint. */
function seamPaint(base: Paint, seam: RGBA, positions: number[], tol = 0.8): Paint {
  return (hit) => {
    const c = base(hit);
    if (c && hit.face === 'top' && positions.some((p) => Math.abs(hit.a - p) < tol)) {
      return mix(c, seam, 0.55);
    }
    return c;
  };
}

function buildOfficeChair(backHigh: boolean): PixelImage {
  const scene = new IsoScene(1, 1, 24);
  scene.cylinder(8, 8, 6.5, 0, 1, glossyTop(CHROME, 13, 13, 0.5));
  scene.cylinder(8, 8, 1.4, 1, 4, solid(CHROME_DARK));
  scene.box([2, 2, 4], [14, 14, CHAIR_SEAT_Z], glossyTop(PLASTO_SHELL, 12, 12, 0.5));
  const y0 = backHigh ? 12 : 1;
  const y1 = backHigh ? 15 : 4;
  scene.box([2, y0, CHAIR_SEAT_Z], [14, y1, 18], glossyTop(PLASTO_SHELL, 12, y1 - y0, 0.5));
  scene.box([1, 3, 7], [3, 11, 10], solid(CHROME_DARK));
  scene.box([13, 3, 7], [15, 11, 10], solid(CHROME_DARK));
  return scene.render();
}

function buildWoodenChair(backHigh: boolean): PixelImage {
  const scene = new IsoScene(1, 1, 20);
  for (const [lx, ly] of [
    [3, 3],
    [12, 3],
    [3, 12],
    [12, 12],
  ] as const) {
    scene.cylinder(lx, ly, 1, 0, CHAIR_SEAT_Z, solid(NORJA_LEG));
  }
  scene.box([1, 1, 4], [15, 15, CHAIR_SEAT_Z], fabric(NORJA_SEAT));
  const sy0 = backHigh ? 13 : 1;
  const sy1 = backHigh ? 16 : 4;
  scene.box([2, sy0, CHAIR_SEAT_Z], [14, sy1, 17], fabric(NORJA_SEAT));
  return scene.render();
}

function buildSofa(backHigh: boolean): PixelImage {
  const scene = new IsoScene(2, 1, 18);
  for (const lx of [2, 29]) {
    for (const ly of [2, 11]) {
      scene.box([lx, ly, 0], [lx + 2, ly + 2, 2], solid(SOFA_FRAME));
    }
  }
  const cushion = seamPaint(fabric(SOFA_FABRIC), SOFA_FABRIC_SEAM, [5.5]);
  scene.box([2, 2, 2], [15, 13, CHAIR_SEAT_Z], cushion);
  scene.box([17, 2, 2], [30, 13, CHAIR_SEAT_Z], cushion);
  scene.box([2, 1, CHAIR_SEAT_Z], [30, 2, CHAIR_SEAT_Z + 0.6], solid(SOFA_TRIM));
  const y0 = backHigh ? 13 : 0;
  const y1 = backHigh ? 16 : 3;
  scene.box(
    [2, y0, CHAIR_SEAT_Z],
    [30, y1, 17],
    seamPaint(fabric(SOFA_FABRIC), SOFA_FABRIC_SEAM, [14]),
  );
  scene.box([2, y0, 17], [30, y1, 17.6], solid(SOFA_TRIM));
  scene.box([0, 1, 2], [3, 14, 11], solid(SOFA_FRAME));
  scene.box([29, 1, 2], [32, 14, 11], solid(SOFA_FRAME));
  scene.box([0, 1, 11], [3, 14, 11.6], solid(SOFA_TRIM));
  scene.box([29, 1, 11], [32, 14, 11.6], solid(SOFA_TRIM));
  return scene.render();
}

function buildCushionedBench(): PixelImage {
  const scene = new IsoScene(2, 1, 10);
  for (const lx of [2, 13, 18, 29]) {
    scene.cylinder(lx + 1, 5, 1, 0, 2, solid(BENCH_FRAME));
  }
  scene.box(
    [1, 4, 2],
    [31, 12, CHAIR_SEAT_Z],
    seamPaint(fabric(BENCH_CUSHION), BENCH_CUSHION_SEAM, [9, 19]),
  );
  return scene.render();
}

function buildWoodenBench(): PixelImage {
  const scene = new IsoScene(2, 1, 8);
  for (const lx of [3, 29]) {
    for (const ly of [4, 10]) {
      scene.box([lx, ly, 0], [lx + 1, ly + 1, 5], solid(WOOD_LEG));
    }
  }
  scene.box([1, 3, 5], [31, 12, CHAIR_SEAT_Z], glossyTop(WOOD_SEAT, 30, 9, 0.3));
  return scene.render();
}

function buildExecChair(backHigh: boolean): PixelImage {
  const scene = new IsoScene(1, 1, 28);
  scene.cylinder(8, 8, 6.5, 0, 1, glossyTop(CHROME, 13, 13, 0.5));
  scene.cylinder(8, 8, 1.6, 1, 4, solid(CHROME));
  scene.box(
    [2, 2, 4],
    [14, 14, CHAIR_SEAT_Z],
    seamPaint(glossyTop(EXEC_SHELL, 12, 12, 0.5), EXEC_SHELL_SEAM, [6]),
  );
  const y0 = backHigh ? 11 : 1;
  const y1 = backHigh ? 15 : 5;
  scene.box(
    [1, y0, CHAIR_SEAT_Z],
    [15, y1, 22],
    seamPaint(glossyTop(EXEC_SHELL, 14, y1 - y0, 0.5), EXEC_SHELL_SEAM, [6, 14]),
  );
  scene.box([1, y0, 22], [15, y1, 22.5], solid(EXEC_TRIM));
  scene.box([0, 3, 7], [2, 11, 11], solid(EXEC_SHELL));
  scene.box([14, 3, 7], [16, 11, 11], solid(EXEC_SHELL));
  return scene.render();
}

function buildStool(): PixelImage {
  const scene = new IsoScene(1, 1, 18);
  const legTop = CHAIR_SEAT_Z - 1;
  const legPositions: Array<[number, number]> = [
    [8, 1.5],
    [2, 12],
    [14, 12],
  ];
  for (const [lx, ly] of legPositions) {
    scene.cylinder(lx, ly, 1.4, 0, legTop, solid(CHROME_DARK));
  }
  scene.cylinder(8, 8.5, 5.5, 2.6, 3.4, solid(CHROME));
  scene.cylinder(8, 8, 6.5, legTop, CHAIR_SEAT_Z, glossyTop(STOOL_SEAT, 13, 13, 0.5));
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
  {
    id: 'EXEC_CHAIR',
    name: 'Executive Chair',
    category: 'chairs',
    variants: fourWay(1, 1, buildExecChair(false), buildExecChair(true)),
  },
  {
    id: 'STOOL',
    name: 'Bar Stool',
    category: 'chairs',
    variants: [{ footprintW: 1, footprintH: 1, images: [buildStool()] }],
  },
];
