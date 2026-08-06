import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('index.js gates DataDockedClient behind enableDataDocked', () => {
  const src = readFileSync(join(root, 'src', 'index.js'), 'utf8');
  assert.match(src, /if \(config\.enableDataDocked\)/);
  assert.match(src, /Data Docked disabled/);
  assert.doesNotMatch(src, /state\.dataDockedClient = new DataDockedClient[\s\S]*?\nstate\.dataDockedClient\.start\(\)/);
});

test('config defaults enableDataDocked to false without key', async () => {
  const { loadConfig } = await import('../src/config.js');
  const orig = { ...process.env };
  process.env.ARCGIS_ITEM_ID = process.env.ARCGIS_ITEM_ID || 'test-item';
  process.env.AISSTREAM_API_KEY = process.env.AISSTREAM_API_KEY || 'test-key';
  process.env.ARCGIS_TOKEN = process.env.ARCGIS_TOKEN || 'test-token';
  delete process.env.ENABLE_DATA_DOCKED;
  delete process.env.DATADOCKED_API_KEY;
  const config = loadConfig();
  assert.equal(config.enableDataDocked, false);
  Object.assign(process.env, orig);
});

test('spatial API responses contain no secrets', async () => {
  const { createServer } = await import('../src/server.js');
  const { createPreviewConfig, createPreviewState } = await import('../src/demo-map-api.js');
  const app = createServer(createPreviewState(), createPreviewConfig(), null, { preview: true });
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const cfg = await fetch(`http://127.0.0.1:${port}/api/spatial/config`).then((r) => r.text());
    const cat = await fetch(`http://127.0.0.1:${port}/api/spatial/catalog`).then((r) => r.text());
    assert.doesNotMatch(cfg, /AISSTREAM|ARCGIS_TOKEN|DATADOCKED/i);
    assert.doesNotMatch(cat, /password|secret|token=/i);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
