/**
 * Build the bundled default office layout.
 *
 *   npx tsx scripts/iso-art/layout.ts
 *
 * Writes webview-ui/public/assets/default-layout-<REVISION>.json and removes
 * older default-layout-*.json files. Bump REVISION whenever the layout
 * changes. The server serves this default only when no `~/.terrarium/layout.json`
 * exists, and flags that in `LayoutLoaded.isDefault`: the webview then composes
 * its own layout from the live agent count (`office/engine/modularOffice.ts`)
 * instead of using this file's content, growing and shrinking team modules at
 * runtime with the same composer (`core/src/officeModules.ts`) this script
 * calls once to produce the bundled starting point (1 team module plus the CTO).
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { composeOffice } from '../../core/src/officeModules.ts';

const REVISION = 11;

const composed = composeOffice({ teamModules: 1, cto: true });

const layout = {
  version: 1,
  cols: composed.cols,
  rows: composed.rows,
  layoutRevision: REVISION,
  tiles: composed.tiles,
  tileColors: composed.tileColors,
  carpetTiles: composed.carpetTiles,
  furniture: composed.furniture,
  ctoOfficeArea: composed.ctoOfficeArea,
};

const assets = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../webview-ui/public/assets',
);
for (const file of fs.readdirSync(assets)) {
  if (/^default-layout-\d+\.json$/.test(file)) fs.rmSync(path.join(assets, file));
}
fs.writeFileSync(
  path.join(assets, `default-layout-${REVISION}.json`),
  `${JSON.stringify(layout)}\n`,
);
console.log(`[iso-art] default-layout-${REVISION}.json: ${composed.furniture.length} items`);
