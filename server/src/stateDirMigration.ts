import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { LAYOUT_FILE_DIR, LEGACY_STATE_DIR } from './constants.js';

/**
 * Move `~/.pixel-agents/` to `~/.terrarium/` once, so settings, consent, seats and connections survive the rename.
 * Skipped when `~/.terrarium/` already exists: that directory is authoritative and is never merged into or replaced.
 * The hook entries in Claude's settings still name the old script path. They are recognized as ours, so the next hook
 * install points them at the new one.
 */
export function migrateLegacyStateDir(home: string = os.homedir()): void {
  const legacyDir = path.join(home, LEGACY_STATE_DIR);
  const stateDir = path.join(home, LAYOUT_FILE_DIR);
  if (!fs.existsSync(legacyDir) || fs.existsSync(stateDir)) return;
  try {
    fs.renameSync(legacyDir, stateDir);
    console.log(`[Terrarium] Moved ${legacyDir} to ${stateDir}`);
  } catch (err) {
    console.error(
      `[Terrarium] Could not move ${legacyDir} to ${stateDir}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
