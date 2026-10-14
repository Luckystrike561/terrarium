/**
 * Shared colours for generated furniture. Base colours are the fully-lit
 * (top face) tone; `lit()` in scene.ts derives the side shades, so keep
 * these light to mid and saturated: Habbo furniture reads as bright,
 * glossy plastic and lacquer, never the muted modern-office tones this
 * palette used to carry.
 */

import { hex } from './image.js';

export const PAL = {
  woodLight: hex('#e0a463'),
  wood: hex('#c4824a'),
  woodDark: hex('#8e5530'),
  woodGrain: hex('#73441f'),

  plasticWhite: hex('#f4f4f4'),
  plasticRed: hex('#e04b3f'),
  plasticBlue: hex('#3f8ee0'),
  plasticYellow: hex('#f2c23a'),
  plasticGreen: hex('#5cbf4a'),
  plasticDark: hex('#3a3c45'),

  upholsteryTeal: hex('#4bb3b0'),
  upholsteryOrange: hex('#ef8a3c'),
  upholsteryCream: hex('#efe3c4'),

  metal: hex('#e8ecf0'),
  metalMid: hex('#b9c1cb'),
  metalDark: hex('#6f7884'),
  chrome: hex('#e8ecf0'),

  screenOff: hex('#2b3140'),
  screenGlow: hex('#7fe0c8'),
  screenBlue: hex('#5aa6e8'),

  paper: hex('#ffffff'),
  paperCream: hex('#f4efe1'),

  leaf: hex('#4caf3c'),
  leafDark: hex('#2f7d2c'),
  leafLight: hex('#7ed957'),

  terracotta: hex('#d97b45'),
  terracottaDark: hex('#a3572b'),

  white: hex('#ffffff'),
  black: hex('#111111'),
  ink: hex('#111111'),

  bookRed: hex('#e04b3f'),
  bookBlue: hex('#3f8ee0'),
  bookGreen: hex('#5cbf4a'),
  bookYellow: hex('#f2c23a'),

  gold: hex('#f2c23a'),
  coffee: hex('#5b3622'),
} as const;
