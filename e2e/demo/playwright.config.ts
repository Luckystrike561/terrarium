import { defineConfig } from '@playwright/test';
import path from 'path';

// launchStandalone sizes the page to 1280x800; the video matches it so frames are not rescaled.
const VIDEO_SIZE = { width: 1280, height: 800 };

export default defineConfig({
  testDir: __dirname,
  testMatch: 'record.demo.ts',
  timeout: 180_000,
  reporter: [['list']],
  outputDir: path.join(__dirname, '../../test-results/demo'),
  workers: 1,
  retries: 0,
  use: {
    video: { mode: 'on', size: VIDEO_SIZE },
  },
});
