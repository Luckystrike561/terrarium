/**
 * Regenerate the isometric art assets.
 *
 *   npx tsx scripts/iso-art/generate.ts [--preview <dir>]
 *
 * Rewrites webview-ui/public/assets/furniture/ from the furniture modules,
 * the character sheets (12 workers + the CTO) from ./characters.ts and the
 * floor patterns from ./floors.ts. With --preview, also writes upscaled
 * contact sheets (one per furniture module, plus characters and floors).
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { CTO_CHARACTER_FILE } from '../../core/src/assets/constants.js';
import { renderCharacterSheets, renderCtoSheet } from './characters.js';
import { renderFloorTiles } from './floors.js';
import { ITEMS as DECOR } from './furniture/decor.js';
import { ITEMS as DESKS } from './furniture/desks.js';
import { ITEMS as SEATING } from './furniture/seating.js';
import { ITEMS as WALL } from './furniture/wall.js';
import type { FurnitureSpec } from './lib/furniture.js';
import { writeFurniture } from './lib/furniture.js';
import { contactSheet } from './lib/image.js';

const MODULES: Record<string, FurnitureSpec[]> = {
  desks: DESKS,
  seating: SEATING,
  decor: DECOR,
  wall: WALL,
};

const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.resolve(here, '../../webview-ui/public/assets');
const furnitureDir = path.join(assets, 'furniture');
const previewIdx = process.argv.indexOf('--preview');
const previewDir = previewIdx >= 0 ? process.argv[previewIdx + 1] : null;

const specs = Object.values(MODULES).flat();
const ids = new Set<string>();
for (const spec of specs) {
  if (ids.has(spec.id)) throw new Error(`duplicate furniture id ${spec.id}`);
  ids.add(spec.id);
}

fs.rmSync(furnitureDir, { recursive: true, force: true });
for (const spec of specs) writeFurniture(spec, furnitureDir);

const sheets = renderCharacterSheets();
sheets.forEach((sheet, i) => sheet.writePng(path.join(assets, 'characters', `char_${i}.png`)));
const ctoSheet = renderCtoSheet();
ctoSheet.writePng(path.join(assets, 'characters', CTO_CHARACTER_FILE));

const floors = renderFloorTiles();
floors.forEach((img, i) => img.writePng(path.join(assets, 'floors', `floor_${i}.png`)));

if (previewDir) {
  for (const [name, items] of Object.entries(MODULES)) {
    if (items.length === 0) continue;
    contactSheet(items.flatMap((s) => s.variants.flatMap((v) => v.images))).writePng(
      path.join(previewDir, `furniture-${name}.png`),
    );
  }
  contactSheet([...sheets, ctoSheet], 4).writePng(path.join(previewDir, 'characters.png'));
  contactSheet(floors, 8).writePng(path.join(previewDir, 'floors.png'));
}

console.log(
  `[iso-art] ${specs.length} furniture items, ${sheets.length} character sheets, ${floors.length} floor tiles`,
);
