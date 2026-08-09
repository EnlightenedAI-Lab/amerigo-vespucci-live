#!/usr/bin/env node
/**
 * LAB-ONLY: build compact intelligence-lab fixtures from iqai-spvm-data.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pythonScript = path.join(__dirname, 'export-intelligence-lab-data.py');

const spvmRoot =
  process.env.IQAI_SPVM_DATA_ROOT ||
  path.resolve(__dirname, '..', '..', 'iqai-spvm-data');

const result = spawnSync(
  process.env.PYTHON || 'python',
  [pythonScript],
  {
    stdio: 'inherit',
    env: { ...process.env, IQAI_SPVM_DATA_ROOT: spvmRoot }
  }
);

if (result.status !== 0) {
  console.error('[intelligence-lab] bundle build failed');
  process.exit(result.status ?? 1);
}

console.log('[intelligence-lab] bundle build complete');
