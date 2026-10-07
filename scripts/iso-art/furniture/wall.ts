import type { FurnitureSpec, FurnitureVariant } from '../lib/furniture.js';
import type { RGBA } from '../lib/image.js';
import { mix } from '../lib/image.js';
import { TILE, WALL_HEIGHT } from '../lib/iso.js';
import { PAL } from '../lib/palette.js';
import type { Paint, SurfaceHit } from '../lib/scene.js';
import { IsoScene, solid } from '../lib/scene.js';

const HEIGHT_ABOVE = WALL_HEIGHT + 6;
const D = TILE;

type WallOrient = 'front' | 'right';
type Face = 'left' | 'right';

interface WallFrame {
  box(u0: number, u1: number, d0: number, d1: number, z0: number, z1: number, paint: Paint): void;
  cylinder(cu: number, cd: number, r: number, z0: number, z1: number, paint: Paint): void;
  sphere(
    cu: number,
    cd: number,
    cz: number,
    r: number,
    paint: Paint,
    zMin?: number,
    squashZ?: number,
  ): void;
  visibleFace: Face;
}

function wallFrame(scene: IsoScene, orient: WallOrient): WallFrame {
  const visibleFace: Face = orient === 'front' ? 'left' : 'right';
  return {
    box(u0, u1, d0, d1, z0, z1, paint) {
      if (orient === 'front') scene.box([u0, D - d1, z0], [u1, D - d0, z1], paint);
      else scene.box([D - d1, u0, z0], [D - d0, u1, z1], paint);
    },
    cylinder(cu, cd, r, z0, z1, paint) {
      if (orient === 'front') scene.cylinder(cu, D - cd, r, z0, z1, paint);
      else scene.cylinder(D - cd, cu, r, z0, z1, paint);
    },
    sphere(cu, cd, cz, r, paint, zMin, squashZ) {
      if (orient === 'front') scene.sphere(cu, D - cd, cz, r, paint, zMin, squashZ);
      else scene.sphere(D - cd, cu, cz, r, paint, zMin, squashZ);
    },
    visibleFace,
  };
}

function sceneFor(orient: WallOrient, itemWidth: number): { scene: IsoScene; wf: WallFrame } {
  const fw = orient === 'front' ? itemWidth : 1;
  const fh = orient === 'front' ? 1 : itemWidth;
  const scene = new IsoScene(fw, fh, HEIGHT_ABOVE);
  return { scene, wf: wallFrame(scene, orient) };
}

/** Restrict a flat decal to the visible mounting face only, so the item
 *  reads as a thin plane glued to the wall rather than a boxy slab. */
function flatPaint(face: Face, content: (a: number, z: number) => RGBA | null): Paint {
  return (hit: SurfaceHit) => (hit.face === face ? content(hit.a, hit.z) : null);
}

function hash(x: number, y: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

function bookRow(
  wf: WallFrame,
  u0: number,
  u1: number,
  z0: number,
  topZ: number,
  seed: number,
): void {
  const colors = [
    PAL.bookRed,
    PAL.bookBlue,
    PAL.bookGreen,
    PAL.bookYellow,
    PAL.gold,
    PAL.fabricGreen,
  ];
  let u = u0;
  let i = 0;
  while (u < u1 - 1) {
    const w = 1.3 + ((seed + i) % 3) * 0.45;
    const uEnd = Math.min(u1, u + w);
    const h = (topZ - z0) * (0.6 + hash(seed + i, 3.1) * 0.35);
    const c = colors[(seed * 3 + i) % colors.length];
    wf.box(u, uEnd, 0.5, 3.6, z0, z0 + h, solid(c));
    u = uEnd + 0.3;
    i++;
  }
}

function buildBookshelf(orient: WallOrient): FurnitureVariant {
  const { scene, wf } = sceneFor(orient, 2);
  const uMax = 32;
  wf.box(0, uMax, 3, 4, 14, 36, solid(PAL.woodDark));
  wf.box(0, uMax, 0, 4, 14, 15.5, solid(PAL.wood));
  wf.box(0, uMax, 0, 4, 24, 25.5, solid(PAL.wood));
  wf.box(0, uMax, 0, 4, 34.5, 36, solid(PAL.wood));
  wf.box(0, 2, 0, 4, 14, 36, solid(PAL.woodDark));
  wf.box(uMax - 2, uMax, 0, 4, 14, 36, solid(PAL.woodDark));
  bookRow(wf, 2.5, uMax - 2.5, 15.5, 24, 1);
  wf.box(5, 12, 1, 3.4, 25.5, 26.4, solid(PAL.bookBlue));
  wf.box(5.4, 11.6, 1.2, 3.2, 26.4, 27.2, solid(PAL.bookYellow));
  bookRow(wf, 13.5, uMax - 2.5, 25.5, 34, 4);
  wf.cylinder(16, 1.8, 1.7, 36, 39, solid(PAL.terracotta));
  wf.sphere(16, 1.8, 41.2, 2.4, solid(PAL.leaf), 39, 0.85);
  return {
    orientation: orient,
    footprintW: scene.fw,
    footprintH: scene.fh,
    images: [scene.render()],
  };
}

function buildDoubleBookshelf(orient: WallOrient): FurnitureVariant {
  const { scene, wf } = sceneFor(orient, 2);
  const uMax = 32;
  wf.box(0, uMax, 5, 6, 0, 38, solid(PAL.woodDark));
  wf.box(0, 2, 0, 6, 0, 38, solid(PAL.woodDark));
  wf.box(uMax - 2, uMax, 0, 6, 0, 38, solid(PAL.woodDark));
  const shelves = [0, 9, 18, 27, 36.5];
  for (const z of shelves) wf.box(0, uMax, 0, 6, z, z + 1.5, solid(PAL.wood));
  bookRow(wf, 2.5, uMax - 2.5, 1.5, 9, 2);
  bookRow(wf, 2.5, uMax - 2.5, 10.5, 18, 5);
  wf.box(4, 10, 0.6, 5, 19.5, 23, solid(PAL.plastic));
  wf.box(4, 10, 0.6, 5, 23, 23.8, solid(PAL.plasticDark));
  wf.box(11, 18, 0.6, 5.2, 19.5, 22, solid(PAL.plasticDark));
  bookRow(wf, 19, uMax - 2.5, 19.5, 27, 7);
  bookRow(wf, 2.5, uMax - 2.5, 28.5, 36.5, 9);
  wf.cylinder(uMax - 6, 2.2, 1.7, 38, 41, solid(PAL.terracotta));
  wf.sphere(uMax - 6, 2.2, 43, 2.6, solid(PAL.leaf), 41, 0.8);
  wf.sphere(uMax - 9, 1.8, 42.2, 1.9, solid(PAL.leafLight), 40, 0.8);
  return {
    orientation: orient,
    footprintW: scene.fw,
    footprintH: scene.fh,
    images: [scene.render()],
  };
}

function buildClock(orient: WallOrient): FurnitureVariant {
  const { scene, wf } = sceneFor(orient, 1);
  const uMax = 16;
  const cu = uMax / 2;
  const cz = 27;
  const r = 6;
  const content = flatPaint(wf.visibleFace, (a, z) => {
    const dist = Math.hypot(a - cu, z - cz);
    if (dist > r) return null;
    if (dist > r - 1.3) return PAL.woodDark;
    if (dist > r - 1.7) return PAL.gold;
    if (dist < 0.9) return PAL.ink;
    if (a >= cu - 0.5 && a <= cu + 0.5 && z >= cz && z <= cz + 3.4) return PAL.ink;
    if (z >= cz - 0.5 && z <= cz + 0.5 && a >= cu && a <= cu + 4.4) return PAL.ink;
    const ticks: Array<[number, number]> = [
      [cu, cz + r - 1.4],
      [cu + r - 1.4, cz],
      [cu, cz - (r - 1.4)],
      [cu - (r - 1.4), cz],
    ];
    for (const [tx, tz] of ticks) if (Math.hypot(a - tx, z - tz) < 0.7) return PAL.ink;
    return PAL.paper;
  });
  wf.box(cu - r - 1, cu + r + 1, 0, 1.6, cz - r - 1, cz + r + 1, content);
  return {
    orientation: orient,
    footprintW: scene.fw,
    footprintH: scene.fh,
    images: [scene.render()],
  };
}

function landscapePaint(face: Face, uMax: number, variant: 1 | 2): Paint {
  const frameU0 = 1.3;
  const frameU1 = uMax - 1.3;
  const frameZ0 = 18.5;
  const frameZ1 = 33.5;
  const bt = 1.9;
  return flatPaint(face, (a, z) => {
    if (a < frameU0 || a > frameU1 || z < frameZ0 || z > frameZ1) return null;
    const border = a < frameU0 + bt || a > frameU1 - bt || z < frameZ0 + bt || z > frameZ1 - bt;
    if (border) return variant === 1 ? PAL.woodDark : PAL.wood;
    const ix0 = frameU0 + bt;
    const ix1 = frameU1 - bt;
    const iz0 = frameZ0 + bt;
    const iz1 = frameZ1 - bt;
    if (variant === 1) {
      const horizon = iz0 + (iz1 - iz0) * 0.42;
      if (z > horizon) {
        const t = (z - horizon) / (iz1 - horizon);
        const sunA = ix1 - 2.2;
        const sunZ = iz1 - 1.8;
        if (Math.hypot(a - sunA, z - sunZ) < 1.4) return PAL.gold;
        return mix(PAL.screenBlue, PAL.white, 0.25 + 0.45 * t);
      }
      const treeA = ix0 + (ix1 - ix0) * 0.3;
      if (a >= treeA - 0.45 && a <= treeA + 0.45 && z >= iz0 && z <= horizon - 1.4)
        return PAL.woodDark;
      if (Math.hypot(a - treeA, z - (horizon - 0.6)) < 2.4) return PAL.leafDark;
      const t = (z - iz0) / (horizon - iz0);
      return mix(PAL.terracotta, PAL.leaf, 0.3 + t * 0.4);
    }
    const centers: Array<[number, number, number, RGBA]> = [
      [ix0 + (ix1 - ix0) * 0.35, iz0 + (iz1 - iz0) * 0.4, 3.4, PAL.terracotta],
      [ix0 + (ix1 - ix0) * 0.62, iz0 + (iz1 - iz0) * 0.58, 2.6, PAL.screenBlue],
      [ix0 + (ix1 - ix0) * 0.48, iz0 + (iz1 - iz0) * 0.68, 1.7, PAL.gold],
    ];
    let best: RGBA | null = null;
    for (const [cx, cz2, r, c] of centers) if (Math.hypot(a - cx, z - cz2) < r) best = c;
    return best ?? PAL.paper;
  });
}

function buildPainting(orient: WallOrient, itemWidth: 1 | 2, variant: 1 | 2): FurnitureVariant {
  const { scene, wf } = sceneFor(orient, itemWidth);
  const uMax = itemWidth * 16;
  const paint = landscapePaint(wf.visibleFace, uMax, variant);
  wf.box(1.3, uMax - 1.3, 0, 1.4, 18.5, 33.5, paint);
  return {
    orientation: orient,
    footprintW: scene.fw,
    footprintH: scene.fh,
    images: [scene.render()],
  };
}

function whiteboardPaint(face: Face, uMax: number): Paint {
  const frameU0 = 1.5;
  const frameU1 = uMax - 1.5;
  const frameZ0 = 14;
  const frameZ1 = 34;
  const bt = 1;
  const ix0 = frameU0 + bt;
  const ix1 = frameU1 - bt;
  const iz0 = frameZ0 + bt;
  const iz1 = frameZ1 - bt;
  const notes: Array<[number, number, RGBA]> = [
    [ix1 - 4.5, iz1 - 3, PAL.bookYellow],
    [ix1 - 7.6, iz1 - 4.4, PAL.fabricGreen],
    [ix1 - 4.2, iz1 - 6.2, PAL.screenBlue],
  ];
  return flatPaint(face, (a, z) => {
    if (a < frameU0 || a > frameU1 || z < frameZ0 || z > frameZ1) return null;
    const border = a < ix0 || a > ix1 || z < iz0 || z > iz1;
    if (border) return PAL.plasticDark;
    for (const [nx, nz, c] of notes) {
      if (a >= nx && a <= nx + 2.2 && z >= nz && z <= nz + 2.2) return c;
    }
    const axisX = ix0 + 2.5;
    const axisZ = iz0 + 2.5;
    if (a >= axisX - 0.3 && a <= axisX + 0.3 && z >= axisZ && z <= iz0 + 9.5) return PAL.ink;
    if (z >= axisZ - 0.3 && z <= axisZ + 0.3 && a >= axisX && a <= axisX + 9.5) return PAL.ink;
    const waveA0 = axisX + 0.8;
    const waveA1 = axisX + 9;
    if (a >= waveA0 && a <= waveA1 && z >= axisZ + 0.6 && z <= iz0 + 9) {
      const t = (a - waveA0) / (waveA1 - waveA0);
      const wave = axisZ + 2.5 + Math.sin(t * Math.PI * 2.4) * 2.1;
      if (Math.abs(z - wave) < 0.55) return PAL.fabricRed;
    }
    const diagA0 = ix0 + 11;
    const diagA1 = ix1 - 1;
    if (a >= diagA0 && a <= diagA1 && z >= iz0 + 1.5 && z <= iz1 - 5) {
      const t = (a - diagA0) / (diagA1 - diagA0);
      const liney = iz1 - 5.5 - t * 6.5;
      if (Math.abs(z - liney) < 0.5) return PAL.screenBlue;
      if (a > diagA1 - 1.4 && Math.abs(z - liney) < 1.8) return PAL.screenBlue;
    }
    return PAL.white;
  });
}

function buildWhiteboard(orient: WallOrient): FurnitureVariant {
  const { scene, wf } = sceneFor(orient, 2);
  const uMax = 32;
  const paint = whiteboardPaint(wf.visibleFace, uMax);
  wf.box(1, uMax - 1, 0, 1.4, 13, 34.6, paint);
  wf.box(4, uMax - 4, 1.4, 2.6, 12, 13.4, solid(PAL.plasticDark));
  wf.box(6, 8, 1.6, 2.4, 13.4, 14.4, solid(PAL.fabricRed));
  wf.box(9.5, 11.5, 1.6, 2.4, 13.4, 14.4, solid(PAL.screenBlue));
  wf.box(13, 15, 1.6, 2.4, 13.4, 14.4, solid(PAL.ink));
  return {
    orientation: orient,
    footprintW: scene.fw,
    footprintH: scene.fh,
    images: [scene.render()],
  };
}

function buildHangingPlant(orient: WallOrient): FurnitureVariant {
  const { scene, wf } = sceneFor(orient, 1);
  const uMax = 16;
  const cu = uMax / 2;
  wf.box(cu - 2, cu + 2, 6, 7.5, 29, 36, solid(PAL.metalDark));
  wf.box(cu - 0.7, cu + 0.7, 0, 7, 32.5, 33.7, solid(PAL.metalDark));
  wf.box(cu - 0.4, cu + 0.4, 1, 1.8, 29, 32.5, solid(PAL.metalDark));
  wf.cylinder(cu, 2, 3.2, 20, 28, solid(PAL.terracotta));
  wf.box(cu - 3.5, cu + 3.5, -0.3, 5.5, 27.4, 28.6, solid(PAL.woodDark));
  wf.sphere(cu, 2, 30.5, 4.3, solid(PAL.leaf), 27.6, 0.85);
  wf.sphere(cu - 2.4, 1.3, 29.2, 2.6, solid(PAL.leafLight), 27, 0.85);
  wf.sphere(cu + 2.6, 2.6, 28.8, 2.4, solid(PAL.leafDark), 26.6, 0.85);
  const vines: Array<[number, number, number]> = [
    [cu - 2.6, 20, 12],
    [cu - 0.6, 22, 9],
    [cu + 1.4, 21, 10.5],
    [cu + 3.2, 23, 13.5],
  ];
  for (const [vu, topZ, botZ] of vines) {
    wf.box(vu - 0.5, vu + 0.5, 1.4, 2.4, botZ, topZ, solid(PAL.leafDark));
    wf.sphere(vu, 1.9, botZ + 1.6, 1.3, solid(PAL.leaf), botZ, 0.85);
    const side = vu > cu ? 0.9 : -0.9;
    wf.sphere(vu + side, 2.1, (botZ + topZ) / 2, 1.1, solid(PAL.leafLight), botZ, 0.85);
  }
  return {
    orientation: orient,
    footprintW: scene.fw,
    footprintH: scene.fh,
    images: [scene.render()],
  };
}

function pair(front: (o: WallOrient) => FurnitureVariant): FurnitureVariant[] {
  return [front('front'), front('right')];
}

export const ITEMS: FurnitureSpec[] = [
  {
    id: 'BOOKSHELF',
    name: 'Bookshelf',
    category: 'wall',
    canPlaceOnWalls: true,
    variants: pair(buildBookshelf),
  },
  {
    id: 'DOUBLE_BOOKSHELF',
    name: 'Tall Bookcase',
    category: 'wall',
    canPlaceOnWalls: true,
    variants: pair(buildDoubleBookshelf),
  },
  {
    id: 'CLOCK',
    name: 'Clock',
    category: 'wall',
    canPlaceOnWalls: true,
    variants: pair(buildClock),
  },
  {
    id: 'SMALL_PAINTING',
    name: 'Small Painting',
    category: 'wall',
    canPlaceOnWalls: true,
    variants: pair((o) => buildPainting(o, 1, 1)),
  },
  {
    id: 'SMALL_PAINTING_2',
    name: 'Small Painting 2',
    category: 'wall',
    canPlaceOnWalls: true,
    variants: pair((o) => buildPainting(o, 1, 2)),
  },
  {
    id: 'LARGE_PAINTING',
    name: 'Large Painting',
    category: 'wall',
    canPlaceOnWalls: true,
    variants: pair((o) => buildPainting(o, 2, 1)),
  },
  {
    id: 'WHITEBOARD',
    name: 'Whiteboard',
    category: 'wall',
    canPlaceOnWalls: true,
    variants: pair(buildWhiteboard),
  },
  {
    id: 'HANGING_PLANT',
    name: 'Hanging Plant',
    category: 'wall',
    canPlaceOnWalls: true,
    canPlaceOnSurfaces: true,
    variants: pair(buildHangingPlant),
  },
];
