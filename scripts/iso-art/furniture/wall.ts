import type { FurnitureSpec, FurnitureVariant } from '../lib/furniture.js';
import type { PixelImage, RGBA } from '../lib/image.js';
import { hex, mix } from '../lib/image.js';
import { TILE, WALL_HEIGHT } from '../lib/iso.js';
import { PAL } from '../lib/palette.js';
import type { Paint, SurfaceHit } from '../lib/scene.js';
import { IsoScene, solid } from '../lib/scene.js';

const HEIGHT_ABOVE = WALL_HEIGHT + 6;
const D = TILE;

const TEAL = hex('#4fb8a6');
const CORAL = hex('#ef8166');
const MUSTARD = hex('#e3a23c');
const SAGE = hex('#8ea87e');
const NOTE_PINK = hex('#f2789f');
const NOTE_LIME = hex('#c3d94c');
const SCREEN_BG = hex('#141c2b');

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
  const colors = [PAL.bookRed, PAL.bookBlue, PAL.bookGreen, PAL.bookYellow, TEAL];
  let u = u0;
  let i = 0;
  while (u < u1 - 1) {
    const w = 1.1 + ((seed + i) % 3) * 0.4;
    const uEnd = Math.min(u1, u + w);
    const h = (topZ - z0) * (0.55 + hash(seed + i, 3.1) * 0.35);
    const c = colors[(seed * 3 + i) % colors.length];
    wf.box(u, uEnd, 0.5, 3.4, z0, z0 + h, solid(c));
    u = uEnd + 0.55;
    i++;
  }
}

function buildBookshelf(orient: WallOrient): FurnitureVariant {
  const { scene, wf } = sceneFor(orient, 2);
  const uMax = 32;
  wf.box(0, uMax, 3, 4, 14, 36, solid(PAL.black));
  wf.box(0, uMax, 0, 4, 14, 15.3, solid(PAL.woodLight));
  wf.box(0, uMax, 0, 4, 24, 25.3, solid(PAL.woodLight));
  wf.box(0, uMax, 0, 4, 34.7, 36, solid(PAL.woodLight));
  wf.box(0, 1.4, 0, 4, 14, 36, solid(PAL.black));
  wf.box(uMax - 1.4, uMax, 0, 4, 14, 36, solid(PAL.black));
  bookRow(wf, 3, 14, 15.3, 23.2, 1);
  wf.cylinder(20, 1.9, 1.6, 15.3, 19.4, solid(PAL.terracotta));
  wf.sphere(20, 1.9, 21.1, 2.1, solid(PAL.leaf), 19.4, 0.85);
  wf.box(23, 28, 1.2, 3.2, 15.3, 18.6, solid(PAL.white));
  wf.box(23.4, 27.6, 1.4, 3, 18.4, 19.2, solid(PAL.black));
  bookRow(wf, 4, 16, 25.3, 33.5, 4);
  wf.box(19, 27, 1, 3.4, 25.3, 27.6, solid(PAL.plasticDark));
  wf.box(19.3, 26.7, 1.2, 3.2, 27.6, 28.3, solid(PAL.white));
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
  wf.box(0, uMax, 5, 6, 0, 38, solid(PAL.black));
  wf.box(0, 1.4, 0, 6, 0, 38, solid(PAL.black));
  wf.box(uMax - 1.4, uMax, 0, 6, 0, 38, solid(PAL.black));
  const shelves = [0, 9.5, 19, 28.5, 36.8];
  for (const z of shelves) wf.box(0, uMax, 0, 6, z, z + 1.2, solid(PAL.woodLight));
  bookRow(wf, 3, 14, 1.2, 8, 2);
  wf.cylinder(22, 2.4, 1.9, 1.2, 6.5, solid(PAL.terracotta));
  wf.sphere(22, 2.4, 8.4, 2.3, solid(PAL.leaf), 6.5, 0.85);
  bookRow(wf, 3, 14, 10.7, 17.5, 5);
  wf.box(18, 25, 1, 5, 10.7, 15.2, solid(PAL.white));
  wf.box(18.3, 24.7, 1.2, 4.8, 15, 15.9, solid(PAL.black));
  bookRow(wf, 17, 29, 20.2, 27.5, 7);
  wf.box(4, 12, 1, 5.2, 20.2, 24.5, solid(PAL.plasticDark));
  bookRow(wf, 3, 16, 29.7, 36.3, 9);
  wf.box(18, 27, 1, 4.6, 29.7, 33.8, solid(PAL.white));
  wf.cylinder(uMax - 6, 2.4, 1.8, 38, 41, solid(PAL.terracotta));
  wf.sphere(uMax - 6, 2.4, 43, 2.5, solid(PAL.leaf), 41, 0.8);
  wf.sphere(uMax - 9, 1.9, 42.2, 1.8, solid(PAL.leafLight), 40, 0.8);
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
  const r = 5.6;
  const content = flatPaint(wf.visibleFace, (a, z) => {
    const dist = Math.hypot(a - cu, z - cz);
    if (dist > r) return null;
    if (dist > r - 0.9) return PAL.black;
    if (dist < 0.7) return PAL.black;
    if (a >= cu - 0.35 && a <= cu + 0.35 && z >= cz && z <= cz + 3.2) return PAL.black;
    if (z >= cz - 0.35 && z <= cz + 0.35 && a >= cu && a <= cu + 4.2) return PAL.black;
    const ticks: Array<[number, number]> = [
      [cu, cz + r - 1.3],
      [cu + r - 1.3, cz],
      [cu, cz - (r - 1.3)],
      [cu - (r - 1.3), cz],
    ];
    for (const [tx, tz] of ticks) if (Math.hypot(a - tx, z - tz) < 0.55) return PAL.black;
    return PAL.white;
  });
  wf.box(cu - r - 0.6, cu + r + 0.6, 0, 1.3, cz - r - 0.6, cz + r + 0.6, content);
  return {
    orientation: orient,
    footprintW: scene.fw,
    footprintH: scene.fh,
    images: [scene.render()],
  };
}

function abstractPaint(face: Face, uMax: number, variant: 1 | 2): Paint {
  const frameU0 = 1.3;
  const frameU1 = uMax - 1.3;
  const frameZ0 = 18.5;
  const frameZ1 = 33.5;
  const bt = 1;
  return flatPaint(face, (a, z) => {
    if (a < frameU0 || a > frameU1 || z < frameZ0 || z > frameZ1) return null;
    const border = a < frameU0 + bt || a > frameU1 - bt || z < frameZ0 + bt || z > frameZ1 - bt;
    if (border) return PAL.black;
    const ix0 = frameU0 + bt;
    const ix1 = frameU1 - bt;
    const iz0 = frameZ0 + bt;
    const iz1 = frameZ1 - bt;
    if (variant === 1) {
      const t = (a - ix0) / (ix1 - ix0) + (z - iz0) / (iz1 - iz0);
      if (Math.abs(t - 1) < 0.1) return MUSTARD;
      return t < 1 ? TEAL : CORAL;
    }
    const centers: Array<[number, number, number, RGBA]> = [
      [ix0 + (ix1 - ix0) * 0.3, iz0 + (iz1 - iz0) * 0.35, 2.6, CORAL],
      [ix0 + (ix1 - ix0) * 0.62, iz0 + (iz1 - iz0) * 0.55, 2, TEAL],
      [ix0 + (ix1 - ix0) * 0.45, iz0 + (iz1 - iz0) * 0.72, 1.4, MUSTARD],
      [ix0 + (ix1 - ix0) * 0.72, iz0 + (iz1 - iz0) * 0.26, 1.1, SAGE],
    ];
    let best: RGBA | null = null;
    for (const [cx, cz2, r, c] of centers) if (Math.hypot(a - cx, z - cz2) < r) best = c;
    return best ?? PAL.white;
  });
}

function buildPainting(orient: WallOrient, itemWidth: 1 | 2, variant: 1 | 2): FurnitureVariant {
  const { scene, wf } = sceneFor(orient, itemWidth);
  const uMax = itemWidth * 16;
  const paint = abstractPaint(wf.visibleFace, uMax, variant);
  wf.box(1.3, uMax - 1.3, 0, 1.4, 18.5, 33.5, paint);
  return {
    orientation: orient,
    footprintW: scene.fw,
    footprintH: scene.fh,
    images: [scene.render()],
  };
}

interface KanbanColumn {
  label: RGBA;
  density: number;
}

function kanbanPaint(
  face: Face,
  uMax: number,
  columns: readonly KanbanColumn[],
  withChart: boolean,
): Paint {
  const frameU0 = 1;
  const frameU1 = uMax - 1;
  const frameZ0 = 12.5;
  const frameZ1 = 35;
  const bt = 1;
  const ix0 = frameU0 + bt;
  const ix1 = frameU1 - bt;
  const iz0 = frameZ0 + bt;
  const iz1 = frameZ1 - bt;
  const headerH = 3.4;
  const n = columns.length;
  const colW = (ix1 - ix0) / n;
  const noteColors = [PAL.bookYellow, NOTE_PINK, TEAL, CORAL, NOTE_LIME];
  const chartH = 6.5;
  return flatPaint(face, (a, z) => {
    if (a < frameU0 || a > frameU1 || z < frameZ0 || z > frameZ1) return null;
    const border = a < ix0 || a > ix1 || z < iz0 || z > iz1;
    if (border) return PAL.chrome;
    const colIndex = Math.min(n - 1, Math.floor((a - ix0) / colW));
    const colA0 = ix0 + colIndex * colW;
    const colA1 = colA0 + colW;
    if (colIndex < n - 1 && a > colA1 - 0.35 && a < colA1 + 0.35) return PAL.black;
    if (z > iz1 - headerH) return columns[colIndex].label;
    const chartZ1 = iz0 + chartH;
    const isChartCol = withChart && colIndex === n - 1;
    if (isChartCol && z <= chartZ1) {
      const chartA0 = colA0 + 0.4;
      const chartA1 = colA1 - 0.4;
      const chartZ0 = iz0 + 0.4;
      const chartTop = chartZ1 - 0.4;
      const onChartBorder = a < chartA0 || a > chartA1 || z < chartZ0 || z > chartTop;
      if (onChartBorder) return PAL.metalDark;
      const t = (a - chartA0) / (chartA1 - chartA0);
      const line = chartTop - 0.5 - t * (chartTop - chartZ0 - 1);
      if (Math.abs(z - line) < 0.4) return CORAL;
      return PAL.white;
    }
    const areaZ1 = iz1 - headerH - 0.4;
    const areaZ0 = isChartCol ? chartZ1 + 0.3 : iz0 + 0.5;
    const areaA0 = colA0 + 0.5;
    const areaA1 = colA1 - 0.5;
    if (areaZ1 <= areaZ0 || areaA1 <= areaA0) return PAL.white;
    const cellSize = 2.9;
    const gap = 0.5;
    const cols = Math.max(1, Math.floor((areaA1 - areaA0) / (cellSize + gap)));
    const rows = Math.max(1, Math.floor((areaZ1 - areaZ0) / (cellSize + gap)));
    const cellW = (areaA1 - areaA0) / cols;
    const cellH = (areaZ1 - areaZ0) / rows;
    const ci = Math.floor((a - areaA0) / cellW);
    const ri = Math.floor((areaZ1 - z) / cellH);
    if (ci >= 0 && ci < cols && ri >= 0 && ri < rows) {
      const seed = hash(colIndex * 17 + ci * 5, ri * 13 + colIndex * 2);
      if (seed < columns[colIndex].density) {
        const cellA0 = areaA0 + ci * cellW + gap / 2;
        const cellA1 = areaA0 + (ci + 1) * cellW - gap / 2;
        const cellZtop = areaZ1 - ri * cellH - gap / 2;
        const cellZbot = areaZ1 - (ri + 1) * cellH + gap / 2;
        if (a >= cellA0 && a <= cellA1 && z >= cellZbot && z <= cellZtop) {
          const colorIdx = Math.floor(
            hash(colIndex * 7 + ci * 3, ri * 5 + colIndex * 2 + 1) * noteColors.length,
          );
          const c = noteColors[colorIdx % noteColors.length];
          if (a < cellA0 + 0.5 && z > cellZtop - 0.5) return mix(c, PAL.white, 0.4);
          return c;
        }
      }
    }
    return PAL.white;
  });
}

function buildWhiteboard(orient: WallOrient): FurnitureVariant {
  const { scene, wf } = sceneFor(orient, 2);
  const uMax = 32;
  const columns: KanbanColumn[] = [
    { label: PAL.metalDark, density: 0.6 },
    { label: PAL.screenBlue, density: 0.28 },
    { label: SAGE, density: 0.48 },
  ];
  const paint = kanbanPaint(wf.visibleFace, uMax, columns, false);
  wf.box(1, uMax - 1, 0, 1.4, 12.5, 35, paint);
  wf.box(4, uMax - 4, 1.4, 2.6, 11.5, 12.9, solid(PAL.chrome));
  wf.box(6, 8, 1.6, 2.4, 12.9, 13.9, solid(TEAL));
  wf.box(9.5, 11.5, 1.6, 2.4, 12.9, 13.9, solid(CORAL));
  wf.box(13, 15, 1.6, 2.4, 12.9, 13.9, solid(MUSTARD));
  return {
    orientation: orient,
    footprintW: scene.fw,
    footprintH: scene.fh,
    images: [scene.render()],
  };
}

function buildKanbanBoard(orient: WallOrient): FurnitureVariant {
  const { scene, wf } = sceneFor(orient, 3);
  const uMax = 48;
  const columns: KanbanColumn[] = [
    { label: PAL.metalDark, density: 0.38 },
    { label: PAL.metal, density: 0.55 },
    { label: PAL.screenBlue, density: 0.3 },
    { label: SAGE, density: 0.42 },
  ];
  const paint = kanbanPaint(wf.visibleFace, uMax, columns, true);
  wf.box(1, uMax - 1, 0, 1.4, 12.5, 35, paint);
  wf.box(6, uMax - 6, 1.4, 2.6, 11.5, 12.9, solid(PAL.chrome));
  wf.box(9, 11, 1.6, 2.4, 12.9, 13.9, solid(TEAL));
  wf.box(13.5, 15.5, 1.6, 2.4, 12.9, 13.9, solid(CORAL));
  wf.box(18, 20, 1.6, 2.4, 12.9, 13.9, solid(MUSTARD));
  wf.box(22.5, 24.5, 1.6, 2.4, 12.9, 13.9, solid(NOTE_PINK));
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
  wf.box(cu - 2, cu + 2, 6, 7.5, 29, 36, solid(PAL.black));
  wf.box(cu - 0.7, cu + 0.7, 0, 7, 32.5, 33.7, solid(PAL.black));
  wf.box(cu - 0.4, cu + 0.4, 1, 1.8, 29, 32.5, solid(PAL.black));
  wf.cylinder(cu, 2, 3.2, 20, 28, solid(PAL.terracotta));
  wf.box(cu - 3.5, cu + 3.5, -0.3, 5.5, 27.4, 28.6, solid(PAL.black));
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

function tvPaint(
  a: number,
  z: number,
  ix0: number,
  ix1: number,
  iz0: number,
  iz1: number,
  state: 'on' | 'off',
  frame: number,
): RGBA {
  if (state === 'off') {
    const refl = a > ix0 + (ix1 - ix0) * 0.62 && z > iz0 + (iz1 - iz0) * 0.6;
    return mix(SCREEN_BG, PAL.black, refl ? 0.1 : 0.3);
  }
  const midA = ix0 + (ix1 - ix0) * 0.5;
  if (a < midA - 0.4) {
    const barsA0 = ix0 + 0.6;
    const barsA1 = midA - 1;
    const n = 4;
    const bw = (barsA1 - barsA0) / n;
    const i = Math.floor((a - barsA0) / bw);
    if (i >= 0 && i < n) {
      const heights = [
        [0.5, 0.75, 0.4, 0.9],
        [0.62, 0.5, 0.8, 0.55],
        [0.42, 0.88, 0.6, 0.7],
      ][frame % 3];
      const h = heights[i] * (iz1 - iz0 - 1);
      const barTop = iz1 - 0.5;
      const barBottom = barTop - h;
      const gap = 0.35;
      const barA0 = barsA0 + i * bw + gap / 2;
      const barA1 = barsA0 + (i + 1) * bw - gap / 2;
      if (a >= barA0 && a <= barA1 && z >= barBottom && z <= barTop) {
        return i % 2 === 0 ? TEAL : CORAL;
      }
    }
    return SCREEN_BG;
  }
  const gA0 = midA + 0.4;
  const gA1 = ix1 - 0.6;
  if (a >= gA0 && a <= gA1) {
    const t = (a - gA0) / (gA1 - gA0);
    const wave = (iz0 + iz1) / 2 + Math.sin(t * Math.PI * 2.3 + frame * 1.1) * (iz1 - iz0) * 0.3;
    if (Math.abs(z - wave) < 0.55) return TEAL;
    const axisZ = iz0 + 0.6;
    if (Math.abs(z - axisZ) < 0.3) return mix(SCREEN_BG, PAL.white, 0.15);
  }
  return SCREEN_BG;
}

function buildWallTvImage(orient: WallOrient, state: 'on' | 'off', frame: number): PixelImage {
  const { scene, wf } = sceneFor(orient, 2);
  const uMax = 32;
  const bezelT = 1.1;
  const ix0 = bezelT;
  const ix1 = uMax - bezelT;
  const iz0 = 16 + bezelT;
  const iz1 = 34 - bezelT;
  const content = flatPaint(wf.visibleFace, (a, z) => {
    if (a < ix0 || a > ix1 || z < iz0 || z > iz1) return PAL.black;
    return tvPaint(a, z, ix0, ix1, iz0, iz1, state, frame);
  });
  wf.box(0, uMax, 0, 1.2, 16, 34, content);
  return scene.render();
}

function buildWallTvVariants(orient: WallOrient): FurnitureVariant[] {
  const fw = orient === 'front' ? 2 : 1;
  const fh = orient === 'front' ? 1 : 2;
  const specs: Array<{ state: 'off' | 'on'; frames: number }> = [
    { state: 'off', frames: 1 },
    { state: 'on', frames: 3 },
  ];
  return specs.map(({ state, frames }) => ({
    orientation: orient,
    state,
    footprintW: fw,
    footprintH: fh,
    images: Array.from({ length: frames }, (_, frame) => buildWallTvImage(orient, state, frame)),
  }));
}

const FONT: Record<string, readonly string[]> = {
  C: ['.##', '#..', '#..', '#..', '.##'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
};

function isTextPixel(
  text: string,
  a: number,
  z: number,
  px: number,
  left: number,
  top: number,
): boolean {
  const rowFromTop = Math.floor((top - z) / px);
  if (rowFromTop < 0 || rowFromTop >= 5) return false;
  const colGlobal = Math.floor((a - left) / px);
  if (colGlobal < 0) return false;
  const letterIndex = Math.floor(colGlobal / 4);
  if (letterIndex >= text.length) return false;
  const colInLetter = colGlobal - letterIndex * 4;
  if (colInLetter > 2) return false;
  const rows = FONT[text[letterIndex]];
  if (!rows) return false;
  return rows[rowFromTop][colInLetter] === '#';
}

function buildCtoSign(orient: WallOrient): FurnitureVariant {
  const { scene, wf } = sceneFor(orient, 1);
  const plaqueA0 = 0.3;
  const plaqueA1 = 15.7;
  const plaqueZ0 = 18;
  const plaqueZ1 = 34;
  const border = 0.5;
  const px = 1.3;
  const text = 'CTO';
  const tw = text.length * 3 * px + (text.length - 1) * px;
  const th = 5 * px;
  const left = (plaqueA0 + plaqueA1) / 2 - tw / 2;
  const top = (plaqueZ0 + plaqueZ1) / 2 + th / 2;
  const content = flatPaint(wf.visibleFace, (a, z) => {
    if (a < plaqueA0 || a > plaqueA1 || z < plaqueZ0 || z > plaqueZ1) return null;
    const onBorder =
      a < plaqueA0 + border ||
      a > plaqueA1 - border ||
      z < plaqueZ0 + border ||
      z > plaqueZ1 - border;
    if (onBorder) return PAL.black;
    if (isTextPixel(text, a, z, px, left, top)) return PAL.ink;
    return PAL.chrome;
  });
  wf.box(plaqueA0 - 0.3, plaqueA1 + 0.3, 0, 0.9, plaqueZ0 - 0.3, plaqueZ1 + 0.3, content);
  return {
    orientation: orient,
    footprintW: scene.fw,
    footprintH: scene.fh,
    images: [scene.render()],
  };
}

function buildWallShelf(orient: WallOrient): FurnitureVariant {
  const { scene, wf } = sceneFor(orient, 1);
  const uMax = 16;
  const cu = uMax / 2;
  const shelfZ0 = 23.6;
  const shelfZ1 = 24.7;
  wf.box(1.5, uMax - 1.5, 0, 3.4, shelfZ0, shelfZ1, solid(PAL.woodLight));
  wf.box(cu - 0.45, cu + 0.45, 0.3, 1.4, shelfZ0 - 2.6, shelfZ0, solid(PAL.black));
  wf.cylinder(cu - 3.2, 1.7, 1.3, shelfZ1, shelfZ1 + 2.1, solid(PAL.terracotta));
  wf.sphere(cu - 3.2, 1.7, shelfZ1 + 3.3, 1.7, solid(PAL.leaf), shelfZ1 + 2.1, 0.85);
  wf.sphere(cu - 1.8, 1.3, shelfZ1 + 2.6, 1, solid(PAL.leafLight), shelfZ1 + 1.9, 0.85);
  wf.cylinder(cu + 2.8, 1.9, 1.05, shelfZ1, shelfZ1 + 1.7, solid(PAL.white));
  wf.cylinder(cu + 2.8, 1.9, 1.05, shelfZ1 + 1.5, shelfZ1 + 1.7, solid(TEAL));
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
    name: 'Sprint Board',
    category: 'wall',
    canPlaceOnWalls: true,
    variants: pair(buildWhiteboard),
  },
  {
    id: 'KANBAN_BOARD',
    name: 'Kanban Board',
    category: 'wall',
    canPlaceOnWalls: true,
    variants: pair(buildKanbanBoard),
  },
  {
    id: 'HANGING_PLANT',
    name: 'Hanging Plant',
    category: 'wall',
    canPlaceOnWalls: true,
    canPlaceOnSurfaces: true,
    variants: pair(buildHangingPlant),
  },
  {
    id: 'WALL_TV',
    name: 'Wall Screen',
    category: 'electronics',
    canPlaceOnWalls: true,
    variants: (['front', 'right'] as WallOrient[]).flatMap(buildWallTvVariants),
  },
  {
    id: 'CTO_SIGN',
    name: 'Office Sign',
    category: 'wall',
    canPlaceOnWalls: true,
    variants: pair(buildCtoSign),
  },
  {
    id: 'WALL_SHELF',
    name: 'Wall Shelf',
    category: 'wall',
    canPlaceOnWalls: true,
    variants: pair(buildWallShelf),
  },
];
