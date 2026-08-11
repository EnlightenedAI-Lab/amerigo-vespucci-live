import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAcceptanceMatrix } from '../public/spatial/spatial-deterministic-acceptance.js';
import { A1_HARNESS_VERSION, A1_TRANSACTION_VERSION } from '../public/spatial/a1-runtime-provenance.js';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

test('buildAcceptanceMatrix includes NEAREST CLEAR RESET preservation steps', () => {
  const steps = buildAcceptanceMatrix();
  const ids = steps.map((step) => step.id);
  assert.ok(ids.includes('nearest-fire'));
  assert.ok(ids.includes('clear-result'));
  assert.ok(ids.includes('reset-map'));
});

test('amenities steps define extended autonomous timeouts', () => {
  const steps = buildAcceptanceMatrix();
  const amenities = steps.find((step) => step.id === 'amenities-within-3km');
  assert.ok(amenities.timeoutMs >= 300000);
  assert.ok(amenities.commandTimeoutMs >= 300000);
});

test('agent1 acceptance runner script exists', () => {
  const script = resolve(REPO_ROOT, 'scripts/agent1-spatial-acceptance.mjs');
  assert.ok(existsSync(script));
  assert.match(readFileSync(script, 'utf8'), /artifacts\/agent1-acceptance\/latest\.json/);
});

test('autonomous acceptance build identifiers are current', () => {
  assert.equal(A1_HARNESS_VERSION, 'A1-RP2-HARNESS-05');
  assert.equal(A1_TRANSACTION_VERSION, 'A1-RP2-TRANSACTION-05');
});
