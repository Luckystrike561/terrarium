import type { FurnitureCategory, FurnitureSpec } from '../lib/furniture.js';
import type { RGBA } from '../lib/image.js';
import { hex, mix, PixelImage, shade } from '../lib/image.js';
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
 *  so curved organic surfaces (leaves, planter walls, ribs) don't read as
 *  flat blobs. */
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

// Modern palette: light matte planters, dark graphite metal, cool steel, warm
// terracotta/sage accents. Kept module-local since nothing else needs them.
const MATTE_WHITE = hex('#ece9e1');
const MATTE_WHITE_DARK = mix(MATTE_WHITE, PAL.black, 0.18);
const GRAPHITE = hex('#34343a');
const GRAPHITE_DARK = mix(GRAPHITE, PAL.black, 0.25);

const STEEL = hex('#c9ced6');
const STEEL_DARK = mix(STEEL, PAL.black, 0.28);
const TERRACOTTA = hex('#c98052');
const TERRACOTTA_DARK = mix(TERRACOTTA, PAL.black, 0.28);
const SAGE = hex('#8fae7a');
const SAGE_DARK = mix(SAGE, PAL.black, 0.32);
const SAGE_LIGHT = mix(SAGE, PAL.white, 0.25);
const SOIL = hex('#3c2a1e');

/** Adds a flared matte planter (narrower base, wider rim) plus a soil cap to
 *  `scene`, centred at (cx, cy) with its rim at `rimZ`. */
function addPot(
  scene: IsoScene,
  cx: number,
  cy: number,
  baseR: number,
  rimR: number,
  rimZ: number,
  base: RGBA = MATTE_WHITE,
  rim: RGBA = MATTE_WHITE_DARK,
): void {
  const dark = mix(base, PAL.black, 0.2);
  const light = shade(base, 1.12);
  const bodyZ = rimZ - 1.5;
  scene
    .cylinder(cx, cy, baseR, 0, bodyZ, textured(base, 4, dark, light, 0.6))
    .cylinder(cx, cy, rimR, bodyZ, rimZ, (hit) => lit(rim, hit.light, 4))
    .cylinder(cx, cy, rimR - 0.9, rimZ - 0.6, rimZ + 0.1, (hit) => lit(SOIL, hit.light, 3));
}

// ---------------------------------------------------------------------------
// PLANT — potted monstera, ~20px tall, matte white cylindrical planter.

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
// PLANT_2 — snake plant, upright pointed blades, matte white planter.

function buildPlant2(): PixelImage {
  const scene = new IsoScene(1, 1, 28);
  addPot(scene, CX, CY, 4, 5, 7);
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
// LARGE_PLANT — tall floor plant (fiddle-leaf), ~36px, terracotta planter.

function buildLargePlant(): PixelImage {
  const scene = new IsoScene(1, 1, 44);
  addPot(scene, CX, CY, 5.6, 6.6, 10, TERRACOTTA, TERRACOTTA_DARK);
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
// CACTUS — small potted cactus with a flower, square matte-white planter cube.

function buildCactus(): PixelImage {
  const scene = new IsoScene(1, 1, 24);
  const dark = mix(MATTE_WHITE, PAL.black, 0.18);
  scene.box([CX - 5, CY - 5, 0], [CX + 5, CY + 5, 8], (hit) => {
    if (hit.face === 'top') return lit(SOIL, hit.light, 3);
    return lit(hit.face === 'left' ? MATTE_WHITE : dark, hit.light, 4);
  });
  const ribbed: Paint = (hit) => {
    const ribs = 8;
    const band = Math.floor((((hit.a % 1) + 1) % 1) * ribs);
    const base = band % 2 === 0 ? hex('#4f9a55') : hex('#3c7c43');
    return lit(base, hit.light, 4);
  };
  scene
    .cylinder(CX, CY, 3, 7, 18, ribbed)
    .sphere(CX, CY, 18.8, 1.9, (hit) => lit(hex('#e0588f'), hit.light, 3), 17.4, 0.8);
  const img = scene.render();
  const [fx, fy] = project(img.height, CX, CY, 20.4);
  img.set(fx, fy, hex('#f6d23c'));
  return img;
}

// ---------------------------------------------------------------------------
// POT — minimalist empty matte graphite vase.

function buildPot(): PixelImage {
  const scene = new IsoScene(1, 1, 20);
  const base = GRAPHITE;
  const dark = mix(base, PAL.black, 0.25);
  const light = mix(base, PAL.white, 0.14);
  scene
    .cylinder(CX, CY, 3.4, 0, 2, textured(dark, 4, mix(dark, PAL.black, 0.2), base, 0.8))
    .cylinder(CX, CY, 4.6, 2, 9, textured(base, 4, dark, light, 0.7))
    .cylinder(CX, CY, 3.2, 9, 11, textured(base, 4, dark, light, 0.7))
    .cylinder(CX, CY, 3.9, 11, 12.2, (hit) => lit(dark, hit.light, 4))
    .cylinder(CX, CY, 2.2, 11.6, 12.3, (hit) => lit(hex('#0d0b10'), hit.light, 3));
  return scene.render();
}

// ---------------------------------------------------------------------------
// BIN — slim matte-black bin with a chrome rim band.

function buildBin(): PixelImage {
  const scene = new IsoScene(1, 1, 24);
  const body = GRAPHITE;
  const bodyDark = mix(body, PAL.black, 0.22);
  scene
    .cylinder(CX, CY, 3, 0, 1, (hit) => lit(bodyDark, hit.light, 4))
    .cylinder(CX, CY, 3.6, 1, 16, textured(body, 4, bodyDark, mix(body, PAL.white, 0.1), 0.6))
    .cylinder(CX, CY, 3.9, 16, 17.2, (hit) => lit(STEEL, hit.light, 4))
    .cylinder(CX, CY, 3.2, 16.6, 17.3, (hit) => lit(STEEL_DARK, hit.light, 3));
  return scene.render();
}

// ---------------------------------------------------------------------------
// COFFEE — mug sitting on a desk surface (z starts at DESK_SURFACE_Z).

function buildCoffee(): PixelImage {
  const scene = new IsoScene(1, 1, 20);
  const z0 = DESK_SURFACE_Z;
  const rimZ = z0 + 5.5;
  const mug = MATTE_WHITE;
  const mugDark = GRAPHITE;
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

// ---------------------------------------------------------------------------
// COFFEE_MACHINE — chrome/black espresso machine sitting on a counter
// (z starts at DESK_SURFACE_Z). 'on' animates rising steam and a blinking LED.

function coffeeMachineBody(): Paint {
  const body = GRAPHITE;
  return (hit) => {
    if (hit.face === 'top') return lit(mix(body, PAL.black, 0.1), hit.light, 4);
    return lit(body, hit.light, 4);
  };
}

function buildCoffeeMachine(state: 'on' | 'off', frame: number): PixelImage {
  const scene = new IsoScene(1, 1, 18);
  const z0 = DESK_SURFACE_Z;
  const bodyTop = z0 + 11;
  scene
    .box([CX - 5, CY - 5, z0], [CX + 5, CY + 1, bodyTop], coffeeMachineBody())
    .box([CX - 5, CY - 5, bodyTop], [CX + 5, CY + 1, bodyTop + 1], (hit) =>
      lit(STEEL, hit.light, 4),
    )
    .box([CX - 1.8, CY + 1, z0 + 3], [CX + 1.8, CY + 3, z0 + 7], (hit) => lit(STEEL, hit.light, 4))
    .box([CX - 0.8, CY + 3, z0 + 3.3], [CX + 0.8, CY + 4.6, z0 + 4.3], (hit) =>
      lit(GRAPHITE_DARK, hit.light, 4),
    )
    .box([CX - 2.6, CY + 1, z0], [CX + 2.6, CY + 4.6, z0 + 0.8], (hit) => lit(STEEL, hit.light, 4))
    .cylinder(CX, CY + 3, 1.4, z0 + 0.8, z0 + 3.2, (hit) => lit(MATTE_WHITE, hit.light, 4));
  const ledOn = state === 'on' && frame % 2 === 0;
  scene.box([CX + 2.4, CY + 0.7, z0 + 8], [CX + 3.6, CY + 1.3, z0 + 8.8], (hit) =>
    lit(ledOn ? hex('#4fe08a') : mix(GRAPHITE, PAL.black, 0.3), hit.light, 3),
  );
  const img = scene.render();
  if (state === 'on') {
    const steamPoints: [number, number, number][] = [
      [CX, CY + 3, z0 + 4 + frame],
      [CX - 0.6, CY + 2.6, z0 + 6.5 + frame],
      [CX + 0.5, CY + 3.4, z0 + 9 + frame],
    ];
    steamPoints.forEach(([gx, gy, z], i) => {
      const [sx, sy] = project(img.height, gx, gy, z);
      if (!img.get(sx, sy)) img.set(sx, sy, [225, 228, 233, 130 - i * 25]);
    });
  }
  return img;
}

const COFFEE_MACHINE: FurnitureSpec = {
  id: 'COFFEE_MACHINE',
  name: 'Coffee Machine',
  category: 'electronics',
  canPlaceOnWalls: false,
  canPlaceOnSurfaces: true,
  variants: [
    { state: 'off', footprintW: 1, footprintH: 1, images: [buildCoffeeMachine('off', 0)] },
    {
      state: 'on',
      footprintW: 1,
      footprintH: 1,
      images: [0, 1, 2].map((frame) => buildCoffeeMachine('on', frame)),
    },
  ],
};

// ---------------------------------------------------------------------------
// KITCHEN_COUNTER — white cabinets, light stone top, a steel sink basin.

function cabinetDoorPaint(base: RGBA, leftSpan: number, rightSpan: number, height: number): Paint {
  const dark = mix(base, PAL.black, 0.2);
  return (hit) => {
    if (hit.face === 'top') return lit(shade(base, 0.9), hit.light, 4);
    const span = hit.face === 'left' ? leftSpan : rightSpan;
    const half = span / 2;
    let c = base;
    if (Math.abs(hit.a - half) < 0.4) c = dark;
    const doorA = hit.a < half ? hit.a : hit.a - half;
    const handle =
      doorA > half - 2.4 && doorA < half - 1.6 && hit.b > height * 0.32 && hit.b < height * 0.68;
    if (handle) c = GRAPHITE;
    return lit(c, hit.light, 4);
  };
}

function counterTopPaint(sink: [number, number, number, number]): Paint {
  const stone = hex('#e3ded2');
  const [a0, a1, b0, b1] = sink;
  return (hit) => {
    if (hit.face !== 'top') return lit(shade(stone, 0.78), hit.light, 4);
    if (hit.a > a0 && hit.a < a1 && hit.b > b0 && hit.b < b1) {
      const edge = hit.a < a0 + 0.6 || hit.a > a1 - 0.6 || hit.b < b0 + 0.6 || hit.b > b1 - 0.6;
      return lit(edge ? STEEL_DARK : STEEL, hit.light, 4);
    }
    const n = hash3(Math.floor(hit.a / 2), Math.floor(hit.b / 2), 11);
    const c = n > 0.86 ? shade(stone, 1.06) : stone;
    return lit(c, hit.light, 4);
  };
}

function buildCounter(alongX: boolean): PixelImage {
  const fw = alongX ? 2 : 1;
  const fh = alongX ? 1 : 2;
  const scene = new IsoScene(fw, fh, 16);
  const W = fw * 16;
  const H = fh * 16;
  const z1 = DESK_SURFACE_Z;
  const z0 = z1 - 2;
  const sinkCenter = alongX ? W * 0.72 : H * 0.72;
  const sinkBounds: [number, number, number, number] = alongX
    ? [sinkCenter - 5, sinkCenter + 5, 3, H - 3]
    : [3, W - 3, sinkCenter - 5, sinkCenter + 5];
  scene.box([0, 0, z0], [W, H, z1], counterTopPaint(sinkBounds));
  scene.box([1, 1, 0], [W - 1, H - 1, z0], cabinetDoorPaint(MATTE_WHITE, W - 2, H - 2, z0));
  if (alongX) {
    scene
      .cylinder(sinkCenter, 3, 0.8, z1, z1 + 5, (hit) => lit(STEEL, hit.light, 4))
      .box([sinkCenter - 0.8, 3, z1 + 4], [sinkCenter + 0.8, 7, z1 + 5], (hit) =>
        lit(STEEL, hit.light, 4),
      );
  } else {
    scene
      .cylinder(3, sinkCenter, 0.8, z1, z1 + 5, (hit) => lit(STEEL, hit.light, 4))
      .box([3, sinkCenter - 0.8, z1 + 4], [7, sinkCenter + 0.8, z1 + 5], (hit) =>
        lit(STEEL, hit.light, 4),
      );
  }
  return scene.render();
}

const KITCHEN_COUNTER: FurnitureSpec = {
  id: 'KITCHEN_COUNTER',
  name: 'Kitchen Counter',
  category: 'desks',
  canPlaceOnWalls: false,
  variants: [
    { orientation: 'front', footprintW: 2, footprintH: 1, images: [buildCounter(true)] },
    { orientation: 'right', footprintW: 1, footprintH: 2, images: [buildCounter(false)] },
  ],
};

// ---------------------------------------------------------------------------
// FRIDGE — tall stainless fridge, door handle on the visible face.

function fridgePaint(bigFace: 'left' | 'right', span: number, height: number): Paint {
  const body = hex('#d9dce0');
  const drawerSeam = height * 0.32;
  return (hit) => {
    if (hit.face === 'top') return lit(shade(body, 1.08), hit.light, 4);
    if (hit.face !== bigFace) return lit(shade(body, 0.78), hit.light, 4);
    let c = body;
    if (Math.abs(hit.b - drawerSeam) < 0.35) c = mix(body, PAL.black, 0.3);
    const handle = hit.a > span - 2.6 && hit.a < span - 1.6 && hit.b > 2 && hit.b < height - 3;
    if (handle) c = GRAPHITE;
    return lit(c, hit.light, 4);
  };
}

function buildFridge(orientation: 'front' | 'right'): PixelImage {
  const scene = new IsoScene(1, 1, 38);
  const topZ = 34;
  const bigFace = orientation === 'front' ? 'left' : 'right';
  scene.box([1, 1, 0], [15, 15, topZ], fridgePaint(bigFace, 14, topZ));
  return scene.render();
}

const FRIDGE: FurnitureSpec = {
  id: 'FRIDGE',
  name: 'Fridge',
  category: 'misc',
  canPlaceOnWalls: false,
  variants: [
    { orientation: 'front', footprintW: 1, footprintH: 1, images: [buildFridge('front')] },
    { orientation: 'right', footprintW: 1, footprintH: 1, images: [buildFridge('right')] },
  ],
};

// ---------------------------------------------------------------------------
// WATER_COOLER — blue bottle on a white dispenser.

function buildWaterCooler(): PixelImage {
  const scene = new IsoScene(1, 1, 32);
  const body = MATTE_WHITE;
  const bodyDark = mix(body, PAL.black, 0.16);
  const bottle = hex('#2e86c7');
  const bottleLight = mix(bottle, PAL.white, 0.3);
  scene
    .box([3, 3, 0], [13, 13, 1], (hit) => lit(bodyDark, hit.light, 4))
    .cylinder(CX, CY, 4.6, 1, 16, textured(body, 4, bodyDark, shade(body, 1.1), 0.6))
    .cylinder(CX, CY, 3.4, 16, 17, (hit) => lit(bodyDark, hit.light, 4))
    .sphere(CX, CY, 21, 5.2, (hit) => lit(bottle, hit.light, 4), 16.5, 0.9)
    .cylinder(
      CX,
      CY,
      3.6,
      21,
      27,
      textured(bottle, 4, mix(bottle, PAL.black, 0.22), bottleLight, 0.7),
    )
    .sphere(CX, CY, 29, 3.4, (hit) => lit(bottleLight, hit.light, 3), 27, 0.8);
  const img = scene.render();
  const lights: [number, number, number, RGBA][] = [
    [CX - 1.5, CY + 4.5, 10, hex('#4fd67a')],
    [CX + 1.5, CY + 4.5, 10, hex('#e0588f')],
  ];
  lights.forEach(([gx, gy, z, c]) => {
    const [sx, sy] = project(img.height, gx, gy, z);
    img.set(sx, sy, c);
  });
  return img;
}

// ---------------------------------------------------------------------------
// FLOOR_LAMP — matte-black pole, warm drum shade.

function buildFloorLamp(): PixelImage {
  const scene = new IsoScene(1, 1, 36);
  const pole = GRAPHITE;
  const shadeColor = hex('#e8c27a');
  const shadeDark = mix(shadeColor, PAL.black, 0.22);
  scene
    .cylinder(CX, CY, 3.4, 0, 1, (hit) => lit(mix(pole, PAL.black, 0.2), hit.light, 4))
    .cylinder(CX, CY, 0.9, 1, 30, (hit) => lit(pole, hit.light, 4))
    .cylinder(CX, CY, 4.2, 30, 34, (hit) => lit(shadeColor, hit.light, 4))
    .cylinder(CX, CY, 4.4, 33.4, 34, (hit) => lit(shadeDark, hit.light, 3))
    .cylinder(CX, CY, 1, 34, 34.6, (hit) => lit(pole, hit.light, 3));
  const img = scene.render();
  const [gx, gy] = project(img.height, CX, CY, 31.5);
  if (img.get(gx, gy)) img.set(gx, gy, [255, 244, 214, 160]);
  return img;
}

// ---------------------------------------------------------------------------
// RUG_PLANT — long low planter box with ornamental grasses, a room divider.

function addBlade(
  scene: IsoScene,
  bx: number,
  by: number,
  baseZ: number,
  h: number,
  lean: number,
  width = 0.9,
): void {
  const topX = bx + lean * h;
  const topY = by + lean * h * 0.4;
  const steps = 5;
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps;
    const t1 = (i + 1) / steps;
    const z0 = baseZ + h * t0;
    const z1 = baseZ + h * t1;
    const w = width * (1 - 0.55 * t0);
    const x = bx + (topX - bx) * t0;
    const y = by + (topY - by) * t0;
    scene.box([x - w, y - w * 0.6, z0], [x + w, y + w * 0.6, z1], (hit) => {
      const edge = hit.face === 'left' || hit.face === 'right';
      const base = t1 > 0.75 ? SAGE_LIGHT : SAGE;
      const col = edge ? mix(base, SAGE_DARK, 0.3) : base;
      return lit(col, hit.light, 4);
    });
  }
}

function buildPlanterBox(alongX: boolean): PixelImage {
  const fw = alongX ? 2 : 1;
  const fh = alongX ? 1 : 2;
  const scene = new IsoScene(fw, fh, 26);
  const W = fw * 16;
  const H = fh * 16;
  const boxTop = 10;
  const planter = GRAPHITE;
  const planterLight = mix(planter, PAL.white, 0.1);
  scene.box([1, 1, 0], [W - 1, H - 1, boxTop], (hit) => {
    if (hit.face === 'top') return lit(SOIL, hit.light, 3);
    return lit(hit.face === 'left' ? planter : planterLight, hit.light, 4);
  });
  const centers = alongX ? [W * 0.18, W * 0.5, W * 0.82] : [H * 0.18, H * 0.5, H * 0.82];
  const mid = alongX ? H / 2 : W / 2;
  for (const c of centers) {
    const seeds: [number, number, number][] = [
      [-2.4, 14, -0.1],
      [-0.6, 18, 0.03],
      [1.2, 15.5, -0.04],
      [2.6, 12, 0.12],
    ];
    for (const [off, h, lean] of seeds) {
      if (alongX) addBlade(scene, c + off, mid, boxTop, h, lean);
      else addBlade(scene, mid, c + off, boxTop, h, lean);
    }
  }
  return scene.render();
}

const RUG_PLANT: FurnitureSpec = {
  id: 'RUG_PLANT',
  name: 'Planter Box',
  category: 'misc',
  canPlaceOnWalls: false,
  variants: [
    { orientation: 'front', footprintW: 2, footprintH: 1, images: [buildPlanterBox(true)] },
    { orientation: 'right', footprintW: 1, footprintH: 2, images: [buildPlanterBox(false)] },
  ],
};

export const ITEMS: FurnitureSpec[] = [
  spec('PLANT', 'Plant', 'decor', [buildPlant()]),
  spec('PLANT_2', 'Plant 2', 'decor', [buildPlant2()]),
  spec('LARGE_PLANT', 'Large Plant', 'decor', [buildLargePlant()]),
  spec('CACTUS', 'Cactus', 'decor', [buildCactus()]),
  spec('POT', 'Pot', 'decor', [buildPot()]),
  spec('BIN', 'Bin', 'misc', [buildBin()]),
  spec('COFFEE', 'Coffee', 'misc', [buildCoffee()], { canPlaceOnSurfaces: true }),
  COFFEE_MACHINE,
  KITCHEN_COUNTER,
  FRIDGE,
  spec('WATER_COOLER', 'Water Cooler', 'misc', [buildWaterCooler()]),
  spec('FLOOR_LAMP', 'Floor Lamp', 'misc', [buildFloorLamp()]),
  RUG_PLANT,
];
