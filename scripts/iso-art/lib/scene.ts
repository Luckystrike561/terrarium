/**
 * A tiny analytic ray tracer that renders isometric pixel art.
 *
 * Every image pixel center is traced along the view direction (1, 1, 1) in
 * world units (see iso.ts) against a list of primitives: the hit with the
 * largest ray parameter is nearest the viewer. Primitives are painted by a
 * callback that receives the hit (face, world point, face-local coordinates,
 * normal and a light level), so a box face can carry drawers, a screen or a
 * pixel template. A final pass adds the ink outline and rim highlights.
 *
 * Tracing instead of drawing polygons gives exact 2:1 iso edges and correct
 * occlusion between primitives for free.
 */

import type { RGBA } from './image.js';
import { hex, mix, PixelImage, shade } from './image.js';
import { footprintImageSize, TILE } from './iso.js';

export type Face = 'top' | 'left' | 'right' | 'side' | 'sphere';

export interface SurfaceHit {
  face: Face;
  /** World point of the hit. */
  gx: number;
  gy: number;
  z: number;
  /** Face-local coordinates from the primitive's min corner:
   *  top → (gx, gy); left (+row face) → (gx, z); right (+col face) → (gy, z);
   *  cylinder side → (angle 0..1 around the axis, z); sphere → (gx, gy). */
  a: number;
  b: number;
  normal: readonly [number, number, number];
  /** 0 (darkest) .. 1 (fully lit). Top = 1, left faces 0.8, right faces 0.6. */
  light: number;
}

export type Paint = (hit: SurfaceHit) => RGBA | null;

interface Hit extends SurfaceHit {
  t: number;
  prim: number;
}

interface Primitive {
  trace(gx0: number, gy0: number): Hit | null;
}

const LIGHT = [0.6, 0.8, 1] as const;
const SHADOW_TINT = hex('#2c3446');
const OUTLINE_INK = hex('#111111');
/** How far toward ink an edge where one primitive passes in front of
 *  another is pulled: a dark line, lighter than the silhouette. */
const INNER_EDGE_INK = 0.65;
/** How far toward ink the darker thread of a fabric dither is pulled. */
const FABRIC_THREAD_INK = 0.18;
const GLOSS_WHITE = hex('#ffffff');

function lightOf(n: readonly [number, number, number]): number {
  return Math.max(0.2, Math.min(1, LIGHT[0] * n[0] + LIGHT[1] * n[1] + LIGHT[2] * n[2]));
}

/** Shade `base` for a light level, toward a cool purple shadow rather than
 *  black, quantized into bands so curved surfaces read as pixel art. */
export function lit(base: RGBA, light: number, bands = 6): RGBA {
  const q = Math.round(light * bands) / bands;
  if (q >= 0.98) return shade(base, 1.06);
  return mix(SHADOW_TINT, base, 0.3 + 0.7 * q);
}

/** Paint a primitive one flat colour, lit per face. */
export function solid(base: RGBA): Paint {
  return (hit) => lit(base, hit.light);
}

/** Paint explicit colours per box face (top / left / right). */
export function faces(top: RGBA, left: RGBA, right: RGBA): Paint {
  return (hit) => (hit.face === 'top' ? top : hit.face === 'left' ? left : right);
}

/** Paint upholstery: the lit tone in a 1 px checker with a darker thread,
 *  laid on the face's own coordinates so the weave follows the iso grid. */
export function fabric(base: RGBA): Paint {
  return (hit) => {
    const c = lit(base, hit.light);
    const thread = (Math.floor(hit.a) + Math.floor(hit.b)) % 2 === 0;
    return thread ? mix(c, OUTLINE_INK, FABRIC_THREAD_INK) : c;
  };
}

/** Habbo's lacquer gloss: a soft white diagonal streak across a flat face,
 *  offset toward the back-left corner the key light favours. `aSpan`/`bSpan`
 *  are the face-local extent of `hit.a`/`hit.b` (a box face's own width and
 *  height, a cylinder top's `2 * radius`). */
export function glossStreak(
  c: RGBA,
  hit: SurfaceHit,
  aSpan: number,
  bSpan: number,
  strength = 0.5,
): RGBA {
  const u = hit.a / aSpan;
  const v = hit.b / bSpan;
  const band = 1 - Math.min(1, Math.abs(u - v - 0.25) / 0.22);
  return band > 0 ? mix(c, GLOSS_WHITE, strength * band) : c;
}

/** Paint a primitive one flat colour, with a gloss streak across its top
 *  face: Habbo lacquer and glossy plastic. `w`/`h` are the top face's
 *  world-unit width and depth (a box's x and y span, a cylinder's own
 *  `2 * radius`). */
export function glossyTop(base: RGBA, w: number, h: number, strength = 0.45): Paint {
  return (hit) => {
    const c = lit(base, hit.light);
    return hit.face === 'top' ? glossStreak(c, hit, w, h, strength) : c;
  };
}

/** Deterministic hash in [0, 1) for texture noise. */
export function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(Math.floor(x) | 0, 374761393) ^ Math.imul(Math.floor(y) | 0, 668265263);
  h = Math.imul(h ^ Math.imul(Math.floor(z) | 0, 2147483647), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export interface RenderOptions {
  /** Ink the silhouette and darken edges between primitives. Default true. */
  outline?: boolean;
  /** Lighten top-face pixels that sit on a box's front edges. Default true. */
  rimLight?: boolean;
}

export class IsoScene {
  readonly width: number;
  readonly height: number;
  private readonly prims: Primitive[] = [];
  private readonly paints: Paint[] = [];
  private readonly originX: number;
  private readonly originY: number;

  /** A canvas for an item with footprint fw × fh and `heightAbove` px of
   *  room above its floor diamond (see the anchor contract in iso.ts). */
  constructor(
    readonly fw: number,
    readonly fh: number,
    heightAbove: number,
  ) {
    const size = footprintImageSize(fw, fh, heightAbove);
    this.width = size.width;
    this.height = size.height;
    this.originX = fh * TILE;
    this.originY = this.height - (fw + fh) * (TILE / 2);
  }

  /** Axis-aligned box from min to max corner ([gx, gy, z]). */
  box(
    min: readonly [number, number, number],
    max: readonly [number, number, number],
    paint: Paint,
  ): this {
    const id = this.prims.length;
    const [x0, y0, z0] = min;
    const [x1, y1, z1] = max;
    this.prims.push({
      trace(gx0, gy0) {
        const tx = x1 - gx0;
        const ty = y1 - gy0;
        const tExit = Math.min(tx, ty, z1);
        const tEnter = Math.max(x0 - gx0, y0 - gy0, z0);
        if (tEnter > tExit + 1e-9) return null;
        const t = tExit;
        const gx = gx0 + t;
        const gy = gy0 + t;
        if (Math.abs(z1 - t) < 1e-9) {
          const normal = [0, 0, 1] as const;
          return {
            t,
            prim: id,
            face: 'top',
            gx,
            gy,
            z: t,
            a: gx - x0,
            b: gy - y0,
            normal,
            light: 1,
          };
        }
        if (tx <= ty) {
          const normal = [1, 0, 0] as const;
          return {
            t,
            prim: id,
            face: 'right',
            gx,
            gy,
            z: t,
            a: gy - y0,
            b: t - z0,
            normal,
            light: lightOf(normal),
          };
        }
        const normal = [0, 1, 0] as const;
        return {
          t,
          prim: id,
          face: 'left',
          gx,
          gy,
          z: t,
          a: gx - x0,
          b: t - z0,
          normal,
          light: lightOf(normal),
        };
      },
    });
    this.paints[id] = paint;
    return this;
  }

  /** Vertical cylinder around (cx, cy) with radius r from z0 to z1. */
  cylinder(cx: number, cy: number, r: number, z0: number, z1: number, paint: Paint): this {
    const id = this.prims.length;
    this.prims.push({
      trace(gx0, gy0) {
        const a = gx0 - cx;
        const b = gy0 - cy;
        if ((a + z1) ** 2 + (b + z1) ** 2 <= r * r) {
          const normal = [0, 0, 1] as const;
          return {
            t: z1,
            prim: id,
            face: 'top',
            gx: gx0 + z1,
            gy: gy0 + z1,
            z: z1,
            a: a + z1 + r,
            b: b + z1 + r,
            normal,
            light: 1,
          };
        }
        const disc = (a + b) ** 2 - 2 * (a * a + b * b - r * r);
        if (disc < 0) return null;
        const t = (-(a + b) + Math.sqrt(disc)) / 2;
        if (t < z0 || t > z1) return null;
        const nx = (a + t) / r;
        const ny = (b + t) / r;
        const normal = [nx, ny, 0] as const;
        const angle = (Math.atan2(ny, nx) / (2 * Math.PI) + 1) % 1;
        return {
          t,
          prim: id,
          face: 'side',
          gx: gx0 + t,
          gy: gy0 + t,
          z: t,
          a: angle,
          b: t - z0,
          normal,
          light: lightOf(normal),
        };
      },
    });
    this.paints[id] = paint;
    return this;
  }

  /** Sphere (or ellipsoid squashed by `squashZ`) cut below zMin. */
  sphere(
    cx: number,
    cy: number,
    cz: number,
    r: number,
    paint: Paint,
    zMin = -Infinity,
    squashZ = 1,
  ): this {
    const id = this.prims.length;
    this.prims.push({
      trace(gx0, gy0) {
        // Scale z so the ellipsoid becomes a unit sphere problem.
        const a = gx0 - cx;
        const b = gy0 - cy;
        const s = 1 / squashZ;
        // P(t) - C = (a + t, b + t, (t - cz) * s)
        const A = 2 + s * s;
        const B = 2 * (a + b) - 2 * cz * s * s;
        const C = a * a + b * b + cz * cz * s * s - r * r;
        const disc = B * B - 4 * A * C;
        if (disc < 0) return null;
        const t = (-B + Math.sqrt(disc)) / (2 * A);
        if (t < zMin) return null;
        const px = a + t;
        const py = b + t;
        const pz = (t - cz) * s;
        const len = Math.hypot(px, py, pz) || 1;
        const normal = [px / len, py / len, pz / len] as const;
        return {
          t,
          prim: id,
          face: 'sphere',
          gx: gx0 + t,
          gy: gy0 + t,
          z: t,
          a: px + r,
          b: py + r,
          normal,
          light: lightOf(normal),
        };
      },
    });
    this.paints[id] = paint;
    return this;
  }

  render(options: RenderOptions = {}): PixelImage {
    const { outline = true, rimLight = true } = options;
    const img = new PixelImage(this.width, this.height);
    const prim = new Int32Array(this.width * this.height).fill(-1);
    const faceAt: (Face | null)[] = new Array(this.width * this.height).fill(null);
    const depth = new Float64Array(this.width * this.height).fill(-Infinity);

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const u = x + 0.5 - this.originX;
        const w = y + 0.5 - this.originY;
        const gx0 = w + u / 2;
        const gy0 = w - u / 2;
        const hits: Hit[] = [];
        for (const p of this.prims) {
          const h = p.trace(gx0, gy0);
          if (h) hits.push(h);
        }
        hits.sort((p, q) => q.t - p.t);
        for (const h of hits) {
          const color = this.paints[h.prim](h);
          if (!color) continue;
          img.set(x, y, color);
          const i = y * this.width + x;
          prim[i] = h.prim;
          faceAt[i] = h.face;
          depth[i] = h.t;
          break;
        }
      }
    }

    if (!outline && !rimLight) return img;
    const out = new PixelImage(this.width, this.height);
    out.data.set(img.data);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const c = img.get(x, y);
        if (!c) continue;
        const i = y * this.width + x;
        const neighbours = [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1],
        ] as const;
        const silhouette = neighbours.some(([nx, ny]) => !img.get(nx, ny));
        if (outline && silhouette) {
          out.set(x, y, OUTLINE_INK);
          continue;
        }
        if (outline) {
          const behindEdge = neighbours.some(([nx, ny]) => {
            const j = ny * this.width + nx;
            return prim[j] !== -1 && prim[j] !== prim[i] && depth[j] - depth[i] > 3;
          });
          if (behindEdge) {
            out.set(x, y, mix(c, OUTLINE_INK, INNER_EDGE_INK));
            continue;
          }
        }
        if (rimLight && faceAt[i] === 'top') {
          const below = (y + 1) * this.width + x;
          if (y + 1 < this.height && prim[below] === prim[i] && faceAt[below] !== 'top') {
            out.set(x, y, shade(c, 1.12));
          }
        }
      }
    }
    return out;
  }
}
