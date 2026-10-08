import fs from 'fs';
import path from 'path';

import { namespaceE2EPath } from './run-config';

const ALLURE_RESULTS_DIR = namespaceE2EPath(path.join(__dirname, '../allure-results/e2e'));

export default async function globalSetup(): Promise<void> {
  fs.rmSync(ALLURE_RESULTS_DIR, { recursive: true, force: true });
}
