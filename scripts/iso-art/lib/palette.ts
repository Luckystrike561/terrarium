/**
 * Shared colours. Base colours are the fully-lit (top face) tone; `lit()` in
 * scene.ts derives the side shades, so keep these mid-to-light.
 */

import { hex } from './image.js';

export const PAL = {
  woodLight: hex('#c98b52'),
  wood: hex('#a8673a'),
  woodDark: hex('#7a4528'),
  woodGrain: hex('#8f5532'),
  metal: hex('#b7bcc8'),
  metalDark: hex('#6d7383'),
  chrome: hex('#dfe3ea'),
  plastic: hex('#e6e0d0'),
  plasticDark: hex('#a9a291'),
  screenOff: hex('#2b3140'),
  screenGlow: hex('#7fe0c8'),
  screenBlue: hex('#5aa6e8'),
  fabricRed: hex('#c04a4a'),
  fabricBlue: hex('#4b6fb4'),
  fabricGreen: hex('#5f9a6a'),
  fabricGrey: hex('#8b8796'),
  leather: hex('#9a5a3c'),
  leaf: hex('#5fae4e'),
  leafDark: hex('#3e7d3a'),
  leafLight: hex('#8fd36a'),
  terracotta: hex('#c8673f'),
  ceramic: hex('#f1ede4'),
  paper: hex('#f6f1e2'),
  ink: hex('#2a2238'),
  white: hex('#ffffff'),
  black: hex('#141018'),
  bookRed: hex('#c0463e'),
  bookBlue: hex('#3f6db0'),
  bookGreen: hex('#4c8a52'),
  bookYellow: hex('#d9a93c'),
  gold: hex('#e0b95a'),
  coffee: hex('#5b3622'),
} as const;
