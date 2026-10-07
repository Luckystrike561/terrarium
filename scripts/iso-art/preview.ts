/**
 * Render contact sheets for review without touching the asset folders.
 *
 *   npx tsx scripts/iso-art/preview.ts [desks|seating|decor|wall|characters ...]
 *
 * Writes /tmp/iso-preview/<name>.png (4× upscale). With no arguments, renders
 * everything.
 */

import * as path from 'path';

import { renderCharacterSheets } from './characters.js';
import { ITEMS as DECOR } from './furniture/decor.js';
import { ITEMS as DESKS } from './furniture/desks.js';
import { ITEMS as SEATING } from './furniture/seating.js';
import { ITEMS as WALL } from './furniture/wall.js';
import type { FurnitureSpec } from './lib/furniture.js';
import { contactSheet } from './lib/image.js';

const OUT = '/tmp/iso-preview';
const MODULES: Record<string, FurnitureSpec[]> = {
  desks: DESKS,
  seating: SEATING,
  decor: DECOR,
  wall: WALL,
};

const wanted = process.argv.slice(2);
const all = wanted.length === 0;

for (const [name, items] of Object.entries(MODULES)) {
  if (!all && !wanted.includes(name)) continue;
  for (const spec of items) {
    contactSheet(spec.variants.flatMap((v) => v.images)).writePng(
      path.join(OUT, name, `${spec.id}.png`),
    );
  }
  if (items.length > 0) {
    contactSheet(
      items.flatMap((s) => s.variants.flatMap((v) => v.images)),
      3,
    ).writePng(path.join(OUT, `${name}.png`));
  }
}

if (all || wanted.includes('characters')) {
  const sheets = renderCharacterSheets();
  if (sheets.length > 0) contactSheet(sheets, 4).writePng(path.join(OUT, 'characters.png'));
}

console.log(`[iso-art] previews in ${OUT}`);
