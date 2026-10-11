import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { migrateLegacyStateDir } from '../src/stateDirMigration.js';

describe('migrateLegacyStateDir', () => {
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'terrarium-migration-'));
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('moves the pre-rename state directory with its contents', () => {
    fs.mkdirSync(path.join(home, '.pixel-agents'));
    fs.writeFileSync(path.join(home, '.pixel-agents', 'config.json'), '{"modules":["herdr"]}');

    migrateLegacyStateDir(home);

    expect(fs.existsSync(path.join(home, '.pixel-agents'))).toBe(false);
    expect(fs.readFileSync(path.join(home, '.terrarium', 'config.json'), 'utf-8')).toBe(
      '{"modules":["herdr"]}',
    );
  });

  it('leaves both directories alone when the new one already exists', () => {
    fs.mkdirSync(path.join(home, '.pixel-agents'));
    fs.writeFileSync(path.join(home, '.pixel-agents', 'config.json'), 'old');
    fs.mkdirSync(path.join(home, '.terrarium'));
    fs.writeFileSync(path.join(home, '.terrarium', 'config.json'), 'new');

    migrateLegacyStateDir(home);

    expect(fs.readFileSync(path.join(home, '.pixel-agents', 'config.json'), 'utf-8')).toBe('old');
    expect(fs.readFileSync(path.join(home, '.terrarium', 'config.json'), 'utf-8')).toBe('new');
  });
});
