import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloneReadonlySnapshot } from './contracts.mjs';

const LAB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_PATH = path.join(LAB_ROOT, 'fixtures', 'synthetic-worldstates.json');

export function loadSyntheticFixtures() {
  const parsed = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
  if (!Array.isArray(parsed)) throw new TypeError('Synthetic fixture file must contain an array');
  return Object.freeze(parsed.map(cloneReadonlySnapshot));
}

export function fixtureById(snapshotId, fixtures = loadSyntheticFixtures()) {
  return fixtures.find((fixture) => fixture.snapshotId === snapshotId) ?? null;
}

export const syntheticFixturePath = FIXTURE_PATH;
