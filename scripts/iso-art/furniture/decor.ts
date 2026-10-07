import type { FurnitureCategory, FurnitureSpec } from '../lib/furniture.js';
import type { RGBA } from '../lib/image.js';
import { hex, mix, PixelImage } from '../lib/image.js';
import { DESK_SURFACE_Z } from '../lib/iso.js';
import { PAL } from '../lib/palette.js';
import type { Paint, SurfaceHit } from '../lib/scene.js';
import { hash3, IsoScene, lit } from '../lib/scene.js';

const CX = 8;
const CY = 8;

/** World (gx, gy, z) → pixel (x, y) for a 1×1-footprint canvas of
 *  `canvasHeight`, matching IsoScene's own projection (see iso.ts). */
function project(canvasHeight: number, gx: number, gy: number, z: number): [number, number] {
  const originX = 16;
  const originY = canvasHeight - 16;
  return [Math.round(originX + (gx - gy)), Math.round(originY + (gx + gy) / 2 - z)];
}

function spec(
  id: string,
  name: string,
  category: FurnitureCategory,
  images: PixelImage[],
  extra: Partial<Omit<FurnitureSpec, 'id' | 'name' | 'category' | 'variants'>> = {},
): FurnitureSpec {
  return { id, name, category, variants: [{ footprintW: 1, footprintH: 1, images }], ...extra };
}

/** Flat-shaded colour with per-cell hash noise speckled toward `dark`/`light`
 *  so curved organic surfaces (leaves, clay, ribs) don't read as flat blobs. */
function textured(base: RGBA, bands: number, dark: RGBA, light: RGBA, freq = 1): Paint {
  return (hit: SurfaceHit) => {
    const n = hash3(
      Math.floor(hit.gx * freq),
      Math.floor(hit.gy * freq),
      Math.floor((hit.z + hit.a * 5) * freq),
    );
    let col = lit(base, hit.light, bands);
    if (n < 0.22) col = mix(col, dark, 0.5);
    else if (n > 0.8) col = mix(col, light, 0.4);
    return col;
  };
}

const CLAY = hex('#c8673f');
const CLAY_DARK = hex('#8a4527');
const CLAY_LIGHT = hex('#e0916a');
const CLAY_RIM = hex('#a8552f');
const SOIL = hex('#3c2a1e');

/** Adds a flared pot (narrower base, wider rim) plus a soil cap to `scene`,
 *  centred at (cx, cy) with its rim at `rimZ`. */
function addPot(
  scene: IsoScene,
  cx: number,
  cy: number,
  baseR: number,
  rimR: number,
  rimZ: number,
  clay = CLAY,
  rim = CLAY_RIM,
): void {
  const bodyZ = rimZ - 1.5;
  scene
    .cylinder(cx, cy, baseR, 0, bodyZ, textured(clay, 4, CLAY_DARK, CLAY_LIGHT, 0.6))
    .cylinder(cx, cy, rimR, bodyZ, rimZ, (hit) => lit(rim, hit.light, 4))
    .cylinder(cx, cy, rimR - 0.9, rimZ - 0.6, rimZ + 0.1, (hit) => lit(SOIL, hit.light, 3));
}

// ---------------------------------------------------------------------------
// PLANT — ordinary potted leafy plant, ~20px tall.

function buildPlant(): PixelImage {
  const scene = new IsoScene(1, 1, 28);
  addPot(scene, CX, CY, 4.2, 5.2, 8);
  const leaf = textured(PAL.leaf, 4, PAL.leafDark, PAL.leafLight, 1.1);
  scene
    .sphere(CX - 2.5, CY - 1, 12, 4.6, leaf, 8, 0.85)
    .sphere(CX + 2.6, CY + 0.5, 13, 4.4, leaf, 8, 0.85)
    .sphere(CX + 0.5, CY + 2.8, 12.5, 4.2, leaf, 8, 0.85)
    .sphere(CX - 1, CY + 1, 18, 4.8, leaf, 8, 0.9)
    .sphere(CX + 1.5, CY - 1.5, 20.5, 3.6, leaf, 8, 0.9);
  return scene.render();
}

// ---------------------------------------------------------------------------
// PLANT_2 — snake plant, upright pointed blades.

function buildPlant2(): PixelImage {
  const scene = new IsoScene(1, 1, 28);
  addPot(scene, CX, CY, 4, 5, 7, hex('#cfcabb'), hex('#aba58f'));
  const blades: [number, number, number, number][] = [
    [CX - 2.6, CY - 0.6, 18, -0.08],
    [CX - 0.8, CY - 2.2, 23, 0.04],
    [CX + 1.3, CY - 1.4, 20, -0.03],
    [CX + 2.4, CY + 1, 16, 0.1],
    [CX + 0.2, CY + 2.3, 19, -0.06],
    [CX - 1.8, CY + 1.6, 14, 0.07],
  ];
  const bladeW = 1.1;
  for (const [bx, by, h, lean] of blades) {
    const topX = bx + lean * h;
    const topY = by + lean * h * 0.4;
    scene.box([bx - bladeW, by - bladeW, 7], [bx + bladeW, by + bladeW, 7.001], () => null);
    const steps = 6;
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps;
      const t1 = (i + 1) / steps;
      const z0 = 7 + h * t0;
      const z1 = 7 + h * t1;
      const w = bladeW * (1 - 0.6 * t0);
      const x = bx + (topX - bx) * t0;
      const y = by + (topY - by) * t0;
      scene.box([x - w, y - w * 0.6, z0], [x + w, y + w * 0.6, z1], (hit) => {
        const edge = hit.face === 'left' || hit.face === 'right';
        const base = t1 > 0.8 ? mix(hex('#5f9a4e'), hex('#d9c45a'), 0.35) : hex('#3f7a3f');
        const col = edge ? mix(base, hex('#255527'), 0.25) : base;
        return lit(col, hit.light, 4);
      });
    }
  }
  return scene.render();
}

// ---------------------------------------------------------------------------
// LARGE_PLANT — tall floor plant (fiddle-leaf), ~36px, big pot.

function buildLargePlant(): PixelImage {
  const scene = new IsoScene(1, 1, 44);
  addPot(scene, CX, CY, 5.6, 6.6, 10, hex('#b85d35'), hex('#8f4423'));
  scene.cylinder(CX, CY, 1.1, 10, 26, (hit) =>
    lit(mix(PAL.woodDark, PAL.black, 0.2), hit.light, 4),
  );
  const leafBig = textured(hex('#3f8a4c'), 4, hex('#2a6236'), hex('#6fbf72'), 1.1);
  const pads: [number, number, number, number, number][] = [
    [CX - 3.5, CY - 2, 30, 5.2, 1],
    [CX + 3.8, CY - 1, 32, 5, 1],
    [CX - 1, CY + 3.5, 29, 4.8, 1],
    [CX + 2, CY + 2.8, 35, 5.4, 1],
    [CX - 0.5, CY - 0.5, 38, 4.6, 0.9],
    [CX + 0.5, CY + 0.5, 25, 4.2, 1],
  ];
  for (const [px, py, pz, r, sq] of pads) scene.sphere(px, py, pz, r, leafBig, 23, sq);
  return scene.render();
}

// ---------------------------------------------------------------------------
// CACTUS — small potted cactus with a flower.

function buildCactus(): PixelImage {
  const scene = new IsoScene(1, 1, 22);
  addPot(scene, CX, CY, 3.6, 4.4, 6);
  const ribbed: Paint = (hit) => {
    const ribs = 8;
    const band = Math.floor((((hit.a % 1) + 1) % 1) * ribs);
    const base = band % 2 === 0 ? hex('#4f9a55') : hex('#3c7c43');
    return lit(base, hit.light, 4);
  };
  scene
    .cylinder(CX, CY, 2.6, 6, 16, ribbed)
    .sphere(CX, CY, 16.8, 1.7, (hit) => lit(hex('#e0588f'), hit.light, 3), 15.6, 0.8);
  const img = scene.render();
  const [fx, fy] = project(img.height, CX, CY, 18.2);
  img.set(fx, fy, hex('#f6d23c'));
  return img;
}

// ---------------------------------------------------------------------------
// POT — empty decorative ceramic vase.

function buildPot(): PixelImage {
  const scene = new IsoScene(1, 1, 20);
  const ceramic = PAL.ceramic;
  const ceramicDark = mix(ceramic, PAL.black, 0.22);
  const ceramicLight = mix(ceramic, PAL.white, 0.15);
  scene
    .cylinder(
      CX,
      CY,
      3.4,
      0,
      2,
      textured(mix(ceramic, PAL.black, 0.1), 4, ceramicDark, ceramic, 0.8),
    )
    .cylinder(CX, CY, 4.6, 2, 9, textured(ceramic, 4, ceramicDark, ceramicLight, 0.7))
    .cylinder(CX, CY, 3.2, 9, 11, textured(ceramic, 4, ceramicDark, ceramicLight, 0.7))
    .cylinder(CX, CY, 3.9, 11, 12.2, (hit) => lit(mix(ceramic, PAL.black, 0.15), hit.light, 4))
    .cylinder(CX, CY, 2.2, 11.6, 12.3, (hit) => lit(hex('#151018'), hit.light, 3));
  return scene.render();
}

// ---------------------------------------------------------------------------
// BIN — office waste bin, could hold crumpled paper.

function buildBin(): PixelImage {
  const scene = new IsoScene(1, 1, 22);
  const metal = PAL.metalDark;
  const metalLight = PAL.metal;
  scene
    .cylinder(CX, CY, 3.6, 0, 1, (hit) => lit(mix(metal, PAL.black, 0.2), hit.light, 4))
    .cylinder(CX, CY, 4.6, 1, 14, textured(metal, 4, mix(metal, PAL.black, 0.25), metalLight, 0.6))
    .cylinder(CX, CY, 5, 14, 15.4, (hit) => lit(metalLight, hit.light, 4));
  const paper = (hit: SurfaceHit) => lit(mix(PAL.paper, PAL.white, 0.1), hit.light, 3);
  scene
    .sphere(CX - 1.2, CY - 0.6, 16.5, 1.9, paper, 15, 0.9)
    .sphere(CX + 1.5, CY + 0.8, 17, 1.6, paper, 15, 0.9);
  return scene.render();
}

// ---------------------------------------------------------------------------
// COFFEE — mug sitting on a desk surface (z starts at DESK_SURFACE_Z).

function buildCoffee(): PixelImage {
  const scene = new IsoScene(1, 1, 20);
  const z0 = DESK_SURFACE_Z;
  const rimZ = z0 + 5.5;
  const mug = hex('#eae6dc');
  const mugDark = mix(mug, PAL.black, 0.2);
  scene
    .cylinder(CX, CY, 2.1, z0, rimZ - 0.6, (hit) => lit(mug, hit.light, 4))
    .cylinder(CX, CY, 2.2, rimZ - 0.6, rimZ, (hit) => lit(mugDark, hit.light, 4))
    .cylinder(CX, CY, 1.6, rimZ - 0.6, rimZ - 0.2, (hit) => lit(PAL.coffee, hit.light, 3))
    .box([CX + 1.9, CY - 1, z0 + 1], [CX + 3.1, CY + 1, z0 + 3.6], (hit) => lit(mug, hit.light, 4));
  const img = scene.render();
  const steamPoints: [number, number, number][] = [
    [CX, CY, rimZ + 1.5],
    [CX - 0.8, CY + 0.6, rimZ + 4],
    [CX + 0.7, CY - 0.5, rimZ + 6.5],
  ];
  steamPoints.forEach(([gx, gy, z], i) => {
    const [sx, sy] = project(img.height, gx, gy, z);
    if (!img.get(sx, sy)) img.set(sx, sy, [220, 224, 230, i === 0 ? 120 : 90 - i * 10]);
  });
  return img;
}

export const ITEMS: FurnitureSpec[] = [
  spec('PLANT', 'Plant', 'decor', [buildPlant()]),
  spec('PLANT_2', 'Plant 2', 'decor', [buildPlant2()]),
  spec('LARGE_PLANT', 'Large Plant', 'decor', [buildLargePlant()]),
  spec('CACTUS', 'Cactus', 'decor', [buildCactus()]),
  spec('POT', 'Pot', 'decor', [buildPot()]),
  spec('BIN', 'Bin', 'misc', [buildBin()]),
  spec('COFFEE', 'Coffee', 'misc', [buildCoffee()], { canPlaceOnSurfaces: true }),
];
