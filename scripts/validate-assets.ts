/**
 * Validate the office manifest against the sprite sheets beside it.
 *
 *   npx tsx scripts/validate-assets.ts [assetsDir]
 *
 * Prints one line per mismatch, naming the asset and the expected vs actual
 * value, and exits non-zero when there is any. `assetsDir` defaults to
 * webview-ui/public/assets.
 */

import * as path from 'path';
import { fileURLToPath } from 'url';

import { OFFICE_MANIFEST_FILE } from '../core/src/assets/officeManifest.js';
import { validateOfficeManifest } from '../core/src/assets/officeManifestValidation.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.resolve(process.argv[2] ?? path.join(here, '../webview-ui/public/assets'));

const issues = validateOfficeManifest(assetsDir);
for (const { asset, message } of issues) console.error(`[assets] ${asset}: ${message}`);
if (issues.length > 0) {
  console.error(
    `[assets] ${issues.length} mismatch(es) between ${OFFICE_MANIFEST_FILE} and the sheets`,
  );
  process.exit(1);
}
console.log(`[assets] ${OFFICE_MANIFEST_FILE} matches every sheet in ${assetsDir}`);
