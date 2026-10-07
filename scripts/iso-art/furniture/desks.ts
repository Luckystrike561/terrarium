import type { FurnitureSpec } from '../lib/furniture.js';
import type { RGBA } from '../lib/image.js';
import { hex, mix, shade } from '../lib/image.js';
import { DESK_SURFACE_Z } from '../lib/iso.js';
import { PAL } from '../lib/palette.js';
import type { Paint } from '../lib/scene.js';
import { hash3, IsoScene, lit, solid } from '../lib/scene.js';

const MATTE_BLACK = hex('#26262c');
const GRAPHITE = hex('#3a3c43');
const DESK_TOP = hex('#dcbd91');
const DESK_EDGE = hex('#2c2d33');
const WHITE_TOP = hex('#f1efe7');
const WALNUT = hex('#4d3626');
const WALNUT_DARK = hex('#33231a');
const GOLD_ACCENT = PAL.gold;
const SCREEN_TEAL = hex('#4fd6c0');
const SCREEN_CORAL = hex('#f2765c');
const KEY_LIGHT = hex('#d9dbdf');

function deskTopPaint(top: RGBA, edge: RGBA): Paint {
  return (hit) => {
    if (hit.face === 'top') {
      const n = hash3(Math.floor(hit.a / 2), Math.floor(hit.b / 3), 7);
      const c = n > 0.88 ? mix(top, PAL.woodGrain, 0.3) : top;
      return lit(c, hit.light);
    }
    return lit(edge, hit.light);
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
  scene.box([0, 0, z0], [W, H, z1], deskTopPaint(DESK_TOP, DESK_EDGE));

  const span = alongX ? W : H;
  const cross = alongX ? H : W;
  const panelA0 = mirror ? 2 : span - 6;
  const panelA1 = mirror ? 6 : span - 2;
  const legA = mirror ? span - 7 : 7;
  const panel = solid(MATTE_BLACK);
  const leg = solid(MATTE_BLACK);
  const tray = solid(shade(MATTE_BLACK, 0.85));

  if (alongX) {
    scene.box([panelA0, 2, 0], [panelA1, cross - 2, z0], panel);
    scene.box([legA - 1, 2, 0], [legA + 1, 4, z0], leg);
    scene.box([legA - 1, cross - 4, 0], [legA + 1, cross - 2, z0], leg);
    scene.box([legA - 4, 3, 1], [legA + 4, cross - 3, 2], tray);
  } else {
    scene.box([2, panelA0, 0], [cross - 2, panelA1, z0], panel);
    scene.box([2, legA - 1, 0], [4, legA + 1, z0], leg);
    scene.box([cross - 4, legA - 1, 0], [cross - 2, legA + 1, z0], leg);
    scene.box([3, legA - 4, 1], [cross - 3, legA + 4, 2], tray);
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
  scene.cylinder(8, 8, 7, z0, z1, solid(WHITE_TOP));
  scene.cylinder(8, 8, 1.3, 1, z0, solid(MATTE_BLACK));
  scene.cylinder(8, 8, 4, 0, 1, solid(MATTE_BLACK));
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
    if (hit.face !== 'top') return lit(shade(DESK_EDGE, 1.1), hit.light);
    const v = stripeOnB ? hit.b : hit.a;
    const n = hash3(Math.floor(hit.a / 3), Math.floor(hit.b / 3), 3);
    let c = n > 0.88 ? mix(DESK_TOP, PAL.woodGrain, 0.25) : DESK_TOP;
    if (v > 15 && v < 17) c = mix(c, MATTE_BLACK, 0.6);
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
  const leg = solid(MATTE_BLACK);
  const legInset = 5;
  const legThick = 5;
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
  scene.box([1, 1, z0], [W - 1, H - 1, z1], deskTopPaint(DESK_TOP, DESK_EDGE));
  const leg = solid(MATTE_BLACK);
  const insetX = 3;
  const insetY = 3;
  scene.cylinder(insetX + 1, insetY + 1, 1, 0, z0, leg);
  scene.cylinder(insetX + 1, H - insetY - 1, 1, 0, z0, leg);
  scene.cylinder(W - insetX - 1, insetY + 1, 1, 0, z0, leg);
  scene.cylinder(W - insetX - 1, H - insetY - 1, 1, 0, z0, leg);
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

function execTopPaint(stripeOnB: boolean): Paint {
  return (hit) => {
    if (hit.face !== 'top') return lit(WALNUT_DARK, hit.light);
    const v = stripeOnB ? hit.b : hit.a;
    const n = hash3(Math.floor(hit.a / 2), Math.floor(hit.b / 3), 11);
    let c = n > 0.84 ? mix(WALNUT, WALNUT_DARK, 0.45) : WALNUT;
    if (v > 1 && v < 2.2) c = mix(c, GOLD_ACCENT, 0.55);
    return lit(c, hit.light);
  };
}

function buildExecDesk(alongX: boolean) {
  const fw = alongX ? 3 : 2;
  const fh = alongX ? 2 : 3;
  const scene = new IsoScene(fw, fh, 18);
  const W = fw * 16;
  const H = fh * 16;
  const z1 = DESK_SURFACE_Z;
  const z0 = z1 - 3;
  scene.box([0, 0, z0], [W, H, z1], execTopPaint(alongX));
  const span = alongX ? W : H;
  const cross = alongX ? H : W;
  const panelW = 7;
  const panel = solid(MATTE_BLACK);
  if (alongX) {
    scene.box([2, 2, 0], [2 + panelW, cross - 2, z0], panel);
    scene.box([span - 2 - panelW, 2, 0], [span - 2, cross - 2, z0], panel);
    scene.box([2, cross - 3, z0 - 2], [span - 2, cross - 1, z0], solid(shade(MATTE_BLACK, 1.1)));
  } else {
    scene.box([2, 2, 0], [cross - 2, 2 + panelW, z0], panel);
    scene.box([2, span - 2 - panelW, 0], [cross - 2, span - 2, z0], panel);
    scene.box([cross - 3, 2, z0 - 2], [cross - 1, span - 2, z0], solid(shade(MATTE_BLACK, 1.1)));
  }
  return scene.render();
}

const EXEC_DESK_FRONT = buildExecDesk(true);
const EXEC_DESK_RIGHT = buildExecDesk(false);

const EXEC_DESK: FurnitureSpec = {
  id: 'EXEC_DESK',
  name: 'Executive Desk',
  category: 'desks',
  canPlaceOnWalls: false,
  variants: [
    { orientation: 'front', footprintW: 3, footprintH: 2, images: [EXEC_DESK_FRONT] },
    { orientation: 'right', footprintW: 2, footprintH: 3, images: [EXEC_DESK_RIGHT] },
    { orientation: 'back', footprintW: 3, footprintH: 2, images: [EXEC_DESK_FRONT] },
    { orientation: 'left', footprintW: 2, footprintH: 3, images: [EXEC_DESK_RIGHT] },
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
    if (hit.face === 'top') return lit(shade(bezel, 1.25), hit.light);
    if (hit.face !== bigFace) return lit(shade(bezel, 0.8), hit.light);
    if (hit.a < margin || hit.a > w - margin || hit.b < margin || hit.b > h - margin) {
      return lit(shade(bezel, 0.9), hit.light);
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
    const accentRow = row % 4 === 1;
    const colour = accentRow ? SCREEN_CORAL : SCREEN_TEAL;
    const c = litPixel || cursorBlink ? colour : PAL.screenOff;
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
    if (hit.face === 'top') return lit(shade(bezel, 1.25), hit.light);
    if (hit.face !== bigFace) return lit(shade(bezel, 0.8), hit.light);
    const vent =
      hit.a > 1.5 && hit.a < w - 1.5 && hit.b > 3 && hit.b < 9 && Math.floor(hit.a) % 2 === 0;
    let c = vent ? shade(bezel, 0.7) : bezel;
    const ledLit =
      state === 'on' ? (frame % 2 === 0 ? SCREEN_TEAL : shade(SCREEN_TEAL, 0.55)) : PAL.plasticDark;
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
      return lit(key ? KEY_LIGHT : shade(KEY_LIGHT, 0.88), hit.light);
    }
    return lit(MATTE_BLACK, hit.light);
  };
}

function buildMonitor(orientation: PCOrientation, state: 'on' | 'off', frame: number) {
  const scene = new IsoScene(1, 1, 30);
  const bezel = MATTE_BLACK;
  const foot = solid(GRAPHITE);
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

export const ITEMS: FurnitureSpec[] = [
  DESK,
  SMALL_TABLE,
  MEETING_TABLE,
  COFFEE_TABLE,
  EXEC_DESK,
  PC,
];
