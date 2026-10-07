import type { FurnitureSpec } from '../lib/furniture.js';
import type { RGBA } from '../lib/image.js';
import { mix, shade } from '../lib/image.js';
import { DESK_SURFACE_Z } from '../lib/iso.js';
import { PAL } from '../lib/palette.js';
import type { Paint } from '../lib/scene.js';
import { hash3, IsoScene, lit, solid } from '../lib/scene.js';

function deskTopPaint(top: RGBA, edge: RGBA): Paint {
  return (hit) => {
    if (hit.face === 'top') {
      const n = hash3(Math.floor(hit.a / 2), Math.floor(hit.b / 3), 7);
      const c = n > 0.84 ? mix(top, PAL.woodGrain, 0.4) : top;
      return lit(c, hit.light);
    }
    return lit(edge, hit.light);
  };
}

function pedestalPaint(base: RGBA, width: number, height: number, drawers: number): Paint {
  return (hit) => {
    if (hit.face === 'top') return lit(shade(base, 0.9), hit.light);
    const bandH = height / drawers;
    const bandIdx = Math.min(drawers - 1, Math.floor(hit.b / bandH));
    const localB = hit.b - bandIdx * bandH;
    let c = base;
    if (localB < 0.8) c = shade(base, 0.6);
    const hw = width / 2;
    if (hit.a > hw - 2.2 && hit.a < hw + 2.2 && localB > bandH - 2.6 && localB < bandH - 1.2) {
      c = PAL.metalDark;
    }
    return lit(c, hit.light);
  };
}

function buildDesk(alongX: boolean, mirror: boolean) {
  const fw = alongX ? 2 : 1;
  const fh = alongX ? 1 : 2;
  const scene = new IsoScene(fw, fh, 14);
  const W = fw * 16;
  const H = fh * 16;
  const z1 = DESK_SURFACE_Z;
  const z0 = z1 - 2;
  scene.box([0, 0, z0], [W, H, z1], deskTopPaint(PAL.woodLight, PAL.wood));

  const span = alongX ? W : H;
  const cross = alongX ? H : W;
  const pedA0 = mirror ? 2 : span / 2 + 1;
  const pedA1 = mirror ? span / 2 - 1 : span - 2;
  const legA = mirror ? span - 8 : 7;
  const pedestal = pedestalPaint(PAL.woodDark, pedA1 - pedA0, z0, 2);
  const leg = solid(PAL.woodDark);

  if (alongX) {
    scene.box([pedA0, 1, 0], [pedA1, cross - 1, z0], pedestal);
    scene.box([legA - 1, 2, 0], [legA + 1, 4, z0], leg);
    scene.box([legA - 1, cross - 4, 0], [legA + 1, cross - 2, z0], leg);
  } else {
    scene.box([1, pedA0, 0], [cross - 1, pedA1, z0], pedestal);
    scene.box([2, legA - 1, 0], [4, legA + 1, z0], leg);
    scene.box([cross - 4, legA - 1, 0], [cross - 2, legA + 1, z0], leg);
  }
  return scene.render();
}

const DESK: FurnitureSpec = {
  id: 'DESK',
  name: 'Desk',
  category: 'desks',
  canPlaceOnWalls: false,
  variants: [
    { orientation: 'front', footprintW: 2, footprintH: 1, images: [buildDesk(true, false)] },
    { orientation: 'right', footprintW: 1, footprintH: 2, images: [buildDesk(false, false)] },
    { orientation: 'back', footprintW: 2, footprintH: 1, images: [buildDesk(true, true)] },
    { orientation: 'left', footprintW: 1, footprintH: 2, images: [buildDesk(false, true)] },
  ],
};

function buildSmallTable() {
  const scene = new IsoScene(1, 1, 14);
  const z1 = DESK_SURFACE_Z;
  const z0 = z1 - 2;
  scene.box([1, 1, z0], [15, 15, z1], deskTopPaint(PAL.woodLight, PAL.wood));
  scene.cylinder(8, 8, 3, 0, z0, solid(PAL.woodDark));
  scene.box([5, 5, 0], [11, 11, 2], solid(shade(PAL.woodDark, 0.85)));
  return scene.render();
}

const SMALL_TABLE: FurnitureSpec = {
  id: 'SMALL_TABLE',
  name: 'Small Table',
  category: 'desks',
  canPlaceOnWalls: false,
  variants: [{ footprintW: 1, footprintH: 1, images: [buildSmallTable()] }],
};

function meetingTopPaint(stripeOnB: boolean): Paint {
  return (hit) => {
    if (hit.face !== 'top') return lit(shade(PAL.wood, 0.9), hit.light);
    const v = stripeOnB ? hit.b : hit.a;
    const n = hash3(Math.floor(hit.a / 3), Math.floor(hit.b / 3), 3);
    let c = n > 0.85 ? mix(PAL.woodLight, PAL.woodGrain, 0.35) : PAL.woodLight;
    if (v > 15 && v < 17) c = mix(c, PAL.gold, 0.3);
    return lit(c, hit.light);
  };
}

function buildMeetingTable(fw: number, fh: number, stripeOnB: boolean) {
  const scene = new IsoScene(fw, fh, 14);
  const W = fw * 16;
  const H = fh * 16;
  const z1 = DESK_SURFACE_Z;
  const z0 = z1 - 2;
  scene.box([0, 0, z0], [W, H, z1], meetingTopPaint(stripeOnB));
  const leg = solid(PAL.woodDark);
  const legInset = 4;
  const legThick = 8;
  if (stripeOnB) {
    scene.box([legInset, 4, 0], [legInset + legThick, H - 4, z0], leg);
    scene.box([W - legInset - legThick, 4, 0], [W - legInset, H - 4, z0], leg);
  } else {
    scene.box([4, legInset, 0], [W - 4, legInset + legThick, z0], leg);
    scene.box([4, H - legInset - legThick, 0], [W - 4, H - legInset, z0], leg);
  }
  return scene.render();
}

const MEETING_TABLE: FurnitureSpec = {
  id: 'MEETING_TABLE',
  name: 'Meeting Table',
  category: 'desks',
  canPlaceOnWalls: false,
  variants: [
    { orientation: 'front', footprintW: 3, footprintH: 2, images: [buildMeetingTable(3, 2, true)] },
    {
      orientation: 'right',
      footprintW: 2,
      footprintH: 3,
      images: [buildMeetingTable(2, 3, false)],
    },
  ],
};

function buildCoffeeTable(alongX: boolean) {
  const fw = alongX ? 2 : 1;
  const fh = alongX ? 1 : 2;
  const scene = new IsoScene(fw, fh, 10);
  const W = fw * 16;
  const H = fh * 16;
  const z1 = 7;
  const z0 = 5;
  scene.box([1, 1, z0], [W - 1, H - 1, z1], deskTopPaint(PAL.woodLight, PAL.wood));
  const leg = solid(PAL.metal);
  const insetX = 3;
  const insetY = 3;
  scene.box([insetX, insetY, 0], [insetX + 2, insetY + 2, z0], leg);
  scene.box([insetX, H - insetY - 2, 0], [insetX + 2, H - insetY, z0], leg);
  scene.box([W - insetX - 2, insetY, 0], [W - insetX, insetY + 2, z0], leg);
  scene.box([W - insetX - 2, H - insetY - 2, 0], [W - insetX, H - insetY, z0], leg);
  return scene.render();
}

const COFFEE_TABLE: FurnitureSpec = {
  id: 'COFFEE_TABLE',
  name: 'Coffee Table',
  category: 'desks',
  canPlaceOnWalls: false,
  variants: [
    { orientation: 'front', footprintW: 2, footprintH: 1, images: [buildCoffeeTable(true)] },
    { orientation: 'right', footprintW: 1, footprintH: 2, images: [buildCoffeeTable(false)] },
  ],
};

type PCOrientation = 'front' | 'right' | 'back' | 'left';

function screenPaint(
  state: 'on' | 'off',
  frame: number,
  bezel: RGBA,
  bigFace: 'left' | 'right',
): Paint {
  const w = 10;
  const h = 13;
  const margin = 1;
  return (hit) => {
    if (hit.face === 'top') return lit(shade(bezel, 1.05), hit.light);
    if (hit.face !== bigFace) return lit(shade(bezel, 0.8), hit.light);
    if (hit.a < margin || hit.a > w - margin || hit.b < margin || hit.b > h - margin) {
      return lit(shade(bezel, 0.85), hit.light);
    }
    if (state === 'off') {
      const refl = hit.a > w * 0.6 && hit.b < h * 0.4;
      return lit(mix(PAL.screenOff, PAL.black, refl ? 0.1 : 0.35), hit.light * 0.85 + 0.15);
    }
    const lineH = 2.2;
    const row = Math.floor((hit.b + frame * 1.6) / lineH);
    const lenHash = hash3(row, frame, 5);
    const litPixel = hit.a - margin < 1 + lenHash * (w - margin * 2 - 1);
    const cursorBlink =
      frame % 3 !== 2 && Math.floor(hit.b) === Math.floor(h * 0.5) && hit.a - margin < 1.2;
    const c = litPixel || cursorBlink ? PAL.screenGlow : PAL.screenOff;
    return [c[0], c[1], c[2], 255];
  };
}

function monitorBackPaint(
  state: 'on' | 'off',
  frame: number,
  bezel: RGBA,
  bigFace: 'left' | 'right',
): Paint {
  const w = 10;
  return (hit) => {
    if (hit.face === 'top') return lit(shade(bezel, 1.05), hit.light);
    if (hit.face !== bigFace) return lit(shade(bezel, 0.8), hit.light);
    const vent =
      hit.a > 1.5 && hit.a < w - 1.5 && hit.b > 3 && hit.b < 9 && Math.floor(hit.a) % 2 === 0;
    let c = vent ? shade(bezel, 0.7) : bezel;
    const ledLit =
      state === 'on'
        ? frame % 2 === 0
          ? PAL.screenGlow
          : shade(PAL.screenGlow, 0.55)
        : PAL.plasticDark;
    if (Math.abs(hit.a - w / 2) < 0.8 && Math.abs(hit.b - 1.2) < 0.8) c = ledLit;
    return lit(c, hit.light);
  };
}

function keyboardPaint(): Paint {
  return (hit) => {
    if (hit.face === 'top') {
      const kx = Math.floor(hit.a / 1.6);
      const ky = Math.floor(hit.b / 1.6);
      const key = (kx + ky) % 2 === 0;
      return lit(key ? PAL.plastic : shade(PAL.plastic, 0.9), hit.light);
    }
    return lit(PAL.plasticDark, hit.light);
  };
}

function buildMonitor(orientation: PCOrientation, state: 'on' | 'off', frame: number) {
  const scene = new IsoScene(1, 1, 30);
  const bezel = PAL.plastic;
  const foot = solid(PAL.plasticDark);
  if (orientation === 'front') {
    scene.box([5, 2, 12], [11, 6, 13], foot);
    scene.box([7, 3, 13], [9, 6, 14], foot);
    scene.box([3, 5, 14], [13, 7, 27], screenPaint(state, frame, bezel, 'left'));
    scene.box([3, 9, 12], [13, 15, 13], keyboardPaint());
  } else if (orientation === 'right') {
    scene.box([2, 5, 12], [6, 11, 13], foot);
    scene.box([3, 7, 13], [6, 9, 14], foot);
    scene.box([5, 3, 14], [7, 13, 27], screenPaint(state, frame, bezel, 'right'));
    scene.box([9, 3, 12], [15, 13, 13], keyboardPaint());
  } else if (orientation === 'back') {
    scene.box([5, 3, 12], [11, 7, 13], foot);
    scene.box([7, 4, 13], [9, 7, 14], foot);
    scene.box([3, 6, 14], [13, 8, 27], monitorBackPaint(state, frame, bezel, 'left'));
  } else {
    scene.box([3, 5, 12], [7, 11, 13], foot);
    scene.box([4, 7, 13], [7, 9, 14], foot);
    scene.box([7, 3, 14], [9, 13, 27], monitorBackPaint(state, frame, bezel, 'right'));
  }
  return scene.render();
}

function buildPCVariants(orientation: PCOrientation) {
  const specs: Array<{ state: 'off' | 'on'; frames: number }> = [
    { state: 'off', frames: 1 },
    { state: 'on', frames: 3 },
  ];
  return specs.map(({ state, frames }) => ({
    orientation,
    state,
    footprintW: 1,
    footprintH: 1,
    images: Array.from({ length: frames }, (_, frame) => buildMonitor(orientation, state, frame)),
  }));
}

const PC: FurnitureSpec = {
  id: 'PC',
  name: 'Computer',
  category: 'electronics',
  canPlaceOnWalls: false,
  canPlaceOnSurfaces: true,
  variants: (['front', 'right', 'back', 'left'] as PCOrientation[]).flatMap(buildPCVariants),
};

export const ITEMS: FurnitureSpec[] = [DESK, SMALL_TABLE, MEETING_TABLE, COFFEE_TABLE, PC];
