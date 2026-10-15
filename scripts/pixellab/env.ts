/**
 * Reads PIXELLAB_API_KEY from the environment, falling back to the repo's
 * `.env` (gitignored). Never logs the key.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

function readDotEnv(): Record<string, string> {
  const file = path.join(repoRoot, '.env');
  if (!fs.existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function pixelLabApiKey(): string {
  const key = process.env.PIXELLAB_API_KEY ?? readDotEnv().PIXELLAB_API_KEY;
  if (!key) throw new Error('PIXELLAB_API_KEY is not set (checked env and .env)');
  return key;
}
