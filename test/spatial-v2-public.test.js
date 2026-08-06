import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');

function walkJs(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkJs(p, out);
    else if (/\.(js|html)$/i.test(name)) out.push(p);
  }
  return out;
}

test('public browser assets never reference Data Docked provider', () => {
  const files = walkJs(publicDir);
  const hits = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    if (/datadocked|DataDocked|data-docked/i.test(text)) hits.push(file);
  }
  assert.deepEqual(hits, []);
});

test('built public IQAI modules do not embed AIS or ArcGIS secrets', () => {
  const files = walkJs(join(publicDir, 'js', 'iqai'));
  const pattern = /AISSTREAM_API_KEY|ARCGIS_TOKEN|DATADOCKED_API_KEY|x-api-key/i;
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, pattern, `secret pattern in ${file}`);
  }
});
