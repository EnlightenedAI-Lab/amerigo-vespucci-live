import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../src/server.js';
import { createPreviewConfig, createPreviewState } from '../../src/demo-map-api.js';
import {
  SCHEMA_IDS,
  VIEW_ID,
  createWorldState
} from '../../public/spatial-v2/foundation/contracts/index.js';
import { createStateStore } from '../../public/spatial-v2/state/index.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const V2 = path.join(ROOT, 'public', 'spatial-v2');

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function read(rel) {
  return fs.readFileSync(path.join(V2, rel), 'utf8');
}

test('foundation modules load as public spatial-v2 ESM without wiring AppShell', async () => {
  const contracts = await import('../../public/spatial-v2/foundation/contracts/index.js');
  const state = await import('../../public/spatial-v2/state/index.js');
  assert.equal(contracts.SCHEMA_IDS.WORLD_STATE, SCHEMA_IDS.WORLD_STATE);
  const store = state.createStateStore({
    now: () => '2026-08-18T14:00:00.000Z',
    idFactory: (() => { let n = 0; return () => `boot-${++n}`; })()
  });
  assert.equal(store.getDiagnostic().primaryViewId, VIEW_ID.MAP);
  assert.doesNotMatch(read('spatial-v2.js'), /foundation\/contracts|state\/state-store/);
  assert.doesNotMatch(read('shell/AppShell.js'), /foundation\/contracts|createStateStore/);
});

test('World State defaults remain provider-independent and keep proven views migratable', () => {
  const world = createWorldState({}, {
    now: () => '2026-08-18T14:00:00.000Z',
    idFactory: (() => { let n = 0; return () => `w-${++n}`; })()
  });
  const json = JSON.stringify(world);
  assert.equal(json.includes('2ec27986ecfb4dd188d058cae620be0d'), false);
  assert.equal(json.includes('MapView'), false);
  assert.equal(world.views.byId[VIEW_ID.MAP].lifecycle, 'MOUNT_ONCE');
  assert.equal(world.views.byId[VIEW_ID.STREET_360].lifecycle, 'DEFERRED');
  assert.equal(world.views.byId[VIEW_ID.VISUAL_3D].lifecycle, 'DEFERRED');
  assert.equal(world.cameras.byViewId.MAP.retained, true);
  assert.equal(world.activeFocus, null);
  assert.equal(world.temporal.lens, 'CURRENT');
  assert.equal(world.temporal.requested, null);
  assert.equal(world.temporal.acquisition, null);
  assert.equal(world.worlds.activeWorldId, world.worlds.baselineWorldId);
});

test('foundation files do not write Portal items or import quarantined V1 routers', () => {
  const files = walk(path.join(V2, 'foundation')).concat(walk(path.join(V2, 'state')));
  assert.ok(files.length > 0);
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /\.save\(/);
    assert.doesNotMatch(text, /portalItem\.update/);
    assert.doesNotMatch(text, /spatial-capability-router/);
    assert.doesNotMatch(text, /spatial-arcgis-runtime/);
    assert.doesNotMatch(text, /spatial-map-command/);
    assert.doesNotMatch(text, /usePresentationMap/);
    assert.doesNotMatch(text, /new MapView\(/);
  }
});

test('preview serves foundation modules on /spatial-v2 without changing shell behavior', async () => {
  const app = createServer(createPreviewState(), createPreviewConfig(), null, { preview: true });
  const server = app.listen(0);
  const port = server.address().port;
  const get = (urlPath) => new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${urlPath}`, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    }).on('error', reject);
  });
  try {
    const page = await get('/spatial-v2/');
    const store = await get('/spatial-v2/state/state-store.js');
    const world = await get('/spatial-v2/foundation/contracts/world-state.js');
    assert.equal(page.status, 200);
    assert.equal(store.status, 200);
    assert.equal(world.status, 200);
    assert.match(page.body, /mountCommandCenter|spatial-v2\.js/);
    assert.doesNotMatch(page.body, /createStateStore/);
    assert.match(store.body, /createStateStore/);
    assert.match(world.body, /createWorldState/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('existing proven product files outside Mission 1 remain the checkpoint copies', () => {
  const app = read('shell/AppShell.js');
  const map = read('map/map-foundation.js');
  const ask = read('shell/ask-capability-bus.js');
  const focus = read('map/spatial-focus.js');
  assert.match(app, /mountCommandCenter/);
  assert.match(map, /new MapView\(/);
  assert.match(ask, /NO_CAPABILITY_MATCH/);
  assert.match(focus, /DROP_PIN/);
  assert.doesNotMatch(app, /createStateStore/);
  assert.doesNotMatch(map, /createWorldState/);
});
