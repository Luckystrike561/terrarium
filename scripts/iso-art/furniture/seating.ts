import type { PixelImage, RGBA } from '../lib/image.js';
import { hex, mix, shade } from '../lib/image.js';
import { CHAIR_SEAT_Z } from '../lib/iso.js';
import { PAL } from '../lib/palette.js';
import type { Paint } from '../lib/scene.js';
import { IsoScene, lit, solid } from '../lib/scene.js';
import type { FurnitureSpec, FurnitureVariant } from '../lib/furniture.js';

const MESH_BLACK = hex('#2c2e34');
const MESH_BLACK_DARK = mix(MESH_BLACK, PAL.black, 0.35);
const CHROME = PAL.chrome;
const MATTE_BLACK = hex('#26262c');
const SCANDI_LEG = hex('#d9b98a');
const SCANDI_SEAT = hex('#9cae8c');
const SOFA_FABRIC = hex('#9cae8c');
const SOFA_FABRIC_SEAM = mix(SOFA_FABRIC, PAL.black, 0.25);
const SOFA_LEG = hex('#26262c');
const BENCH_CUSHION = hex('#d9a93c');
const BENCH_CUSHION_SEAM = mix(BENCH_CUSHION, PAL.black, 0.3);
const BENCH_FRAME = hex('#26262c');
const EXEC_LEATHER = hex('#6a4028');
const EXEC_LEATHER_DARK = mix(EXEC_LEATHER, PAL.black, 0.3);
const STOOL_SEAT = hex('#d9b98a');

function seamPaint(base: RGBA, seam: RGBA, positions: number[], tol = 0.8): Paint {
  return (hit) => {
    const c = lit(base, hit.light);
    if (hit.face === 'top' && positions.some((p) => Math.abs(hit.a - p) < tol)) {
      return mix(c, seam, 0.55);
    }
    return c;
  };
}

function meshPaint(base: RGBA, dark: RGBA): Paint {
  return (hit) => {
    const c = lit(base, hit.light);
    if (hit.face === 'sphere') return c;
    const weave = (Math.floor(hit.a) + Math.floor(hit.b)) % 2 === 0;
    return weave ? mix(c, dark, 0.22) : c;
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
  scene.cylinder(8, 8, 6.5, 0, 1, solid(CHROME));
  scene.cylinder(8, 8, 1.4, 1, 4, solid(MATTE_BLACK));
  scene.box([2, 2, 4], [14, 14, CHAIR_SEAT_Z], meshPaint(MESH_BLACK, MESH_BLACK_DARK));
  const y0 = backHigh ? 12 : 1;
  const y1 = backHigh ? 15 : 4;
  scene.box([2, y0, CHAIR_SEAT_Z], [14, y1, 18], meshPaint(MESH_BLACK, MESH_BLACK_DARK));
  scene.box([1, 3, 7], [3, 11, 10], solid(MATTE_BLACK));
  scene.box([13, 3, 7], [15, 11, 10], solid(MATTE_BLACK));
  return scene.render();
}

function buildWoodenChair(backHigh: boolean): PixelImage {
  const scene = new IsoScene(1, 1, 20);
  for (const lx of [2, 11]) {
    for (const ly of [2, 11]) {
      scene.box([lx, ly, 0], [lx + 2, ly + 2, CHAIR_SEAT_Z], solid(SCANDI_LEG));
    }
  }
  scene.box([1, 1, 4], [15, 15, CHAIR_SEAT_Z], solid(SCANDI_SEAT));
  const sy0 = backHigh ? 13 : 1;
  const sy1 = backHigh ? 16 : 4;
  scene.box([2, sy0, CHAIR_SEAT_Z], [14, sy1, 17], solid(SCANDI_SEAT));
  return scene.render();
}

function buildSofa(backHigh: boolean): PixelImage {
  const scene = new IsoScene(2, 1, 18);
  for (const lx of [2, 29]) {
    for (const ly of [2, 11]) {
      scene.box([lx, ly, 0], [lx + 2, ly + 2, 2], solid(SOFA_LEG));
    }
  }
  scene.box([2, 2, 2], [15, 13, CHAIR_SEAT_Z], seamPaint(SOFA_FABRIC, SOFA_FABRIC_SEAM, [5.5]));
  scene.box([17, 2, 2], [30, 13, CHAIR_SEAT_Z], seamPaint(SOFA_FABRIC, SOFA_FABRIC_SEAM, [5.5]));
  const y0 = backHigh ? 13 : 0;
  const y1 = backHigh ? 16 : 3;
  scene.box([2, y0, CHAIR_SEAT_Z], [30, y1, 17], seamPaint(SOFA_FABRIC, SOFA_FABRIC_SEAM, [14]));
  scene.box([0, 1, 2], [3, 14, 11], solid(SOFA_FABRIC));
  scene.box([29, 1, 2], [32, 14, 11], solid(SOFA_FABRIC));
  return scene.render();
}

function buildCushionedBench(): PixelImage {
  const scene = new IsoScene(2, 1, 10);
  for (const lx of [2, 13, 18, 29]) {
    scene.box([lx, 4, 0], [lx + 2, 6, 2], solid(BENCH_FRAME));
  }
  scene.box(
    [1, 4, 2],
    [31, 12, CHAIR_SEAT_Z],
    seamPaint(BENCH_CUSHION, BENCH_CUSHION_SEAM, [9, 19]),
  );
  return scene.render();
}

function buildWoodenBench(): PixelImage {
  const scene = new IsoScene(2, 1, 8);
  for (const lx of [2, 29]) {
    for (const ly of [3, 10]) {
      scene.box([lx, ly, 0], [lx + 1, ly + 1, 5], solid(SCANDI_LEG));
    }
  }
  scene.box(
    [1, 3, 5],
    [31, 12, CHAIR_SEAT_Z],
    grainPaint(SCANDI_LEG, mix(SCANDI_LEG, PAL.woodGrain, 0.3)),
  );
  return scene.render();
}

function buildExecChair(backHigh: boolean): PixelImage {
  const scene = new IsoScene(1, 1, 28);
  scene.cylinder(8, 8, 6.5, 0, 1, solid(CHROME));
  scene.cylinder(8, 8, 1.6, 1, 4, solid(CHROME));
  scene.box([2, 2, 4], [14, 14, CHAIR_SEAT_Z], seamPaint(EXEC_LEATHER, EXEC_LEATHER_DARK, [6]));
  const y0 = backHigh ? 11 : 1;
  const y1 = backHigh ? 15 : 5;
  scene.box(
    [1, y0, CHAIR_SEAT_Z],
    [15, y1, 22],
    seamPaint(EXEC_LEATHER, EXEC_LEATHER_DARK, [6, 14]),
  );
  scene.box([0, 3, 7], [2, 11, 11], solid(EXEC_LEATHER));
  scene.box([14, 3, 7], [16, 11, 11], solid(EXEC_LEATHER));
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
    scene.cylinder(lx, ly, 1.4, 0, legTop, solid(MATTE_BLACK));
  }
  scene.cylinder(8, 8.5, 5.5, 2.6, 3.4, solid(CHROME));
  scene.cylinder(8, 8, 6.5, legTop, CHAIR_SEAT_Z, solid(STOOL_SEAT));
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
