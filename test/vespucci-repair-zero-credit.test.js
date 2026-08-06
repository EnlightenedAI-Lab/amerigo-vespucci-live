import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('vespucci repair scripts never import Data Docked', () => {
  const files = [
    'scripts/repair-vespucci-layers.js',
    'src/vespucci-layer-repair.js'
  ];
  for (const file of files) {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(src, /datadocked/i);
    assert.doesNotMatch(src, /DataDockedClient/i);
  }
});
