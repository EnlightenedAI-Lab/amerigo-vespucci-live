import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDemoMapData, finalizeDemoMapData, DEMO_MMSI } from '../test/demo/fixtures.js';
import { DemoMapApiService, createPreviewConfig, createPreviewState } from '../src/demo-map-api.js';
import { createServer } from '../src/server.js';
import { startPreviewServer } from '../src/preview.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

function request(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${urlPath}`, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    }).on('error', reject);
  });
}

test('preview mode blocks ArcGIS diagnostics endpoint', async () => {
  const config = createPreviewConfig();
  const state = createPreviewState();
  const app = createServer(state, config, null, { preview: true });
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const res = await request(port, '/api/arcgis-diagnostics');
    assert.equal(res.status, 503);
    assert.match(res.body.error, /preview/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('demo fixtures include all required map layers', () => {
  const data = finalizeDemoMapData(buildDemoMapData());
  assert.equal(data.vessel.empty, false);
  assert.equal(data.history.count, 7);
  assert.equal(data.travelledRoute.empty, false);
  assert.equal(data.destination.properties.PortCode, 'PTPDL');
  assert.equal(data.estimatedRoute.empty, false);
  assert.equal(data.conditions.empty, false);
  assert.equal(data.meta.preview, true);
  assert.equal(data.meta.mmsi, DEMO_MMSI);
});

test('demo fixtures use relative timestamps for freshness', () => {
  const now = Date.now();
  const data = finalizeDemoMapData(buildDemoMapData(now));
  assert.equal(data.vessel.freshness, 'fresh');
  assert.ok(data.vessel.ageSeconds < 600);
});

test('demo fixtures contain no credentials', () => {
  const json = JSON.stringify(buildDemoMapData());
  assert.doesNotMatch(json, /ARCGIS_TOKEN/i);
  assert.doesNotMatch(json, /DATADOCKED_API_KEY/i);
  assert.doesNotMatch(json, /AISSTREAM_API_KEY/i);
  assert.doesNotMatch(json, /password/i);
});

test('DemoMapApiService returns fixture data without network', async () => {
  const service = new DemoMapApiService();
  const data = await service.getMapData();
  assert.equal(data.meta.preview, true);
  assert.equal(data.meta.source, 'local-demo-fixture');
  assert.ok(data.vessel.geojson.features.length > 0);
});

test('preview server serves map data with preview flag', async () => {
  const server = startPreviewServer(0);
  const port = server.address().port;
  try {
    const res = await request(port, '/api/map-data');
    assert.equal(res.status, 200);
    assert.equal(res.body.meta.preview, true);
    assert.equal(res.body.vessel.properties.VesselName, 'AMERIGO VESPUCCI');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('preview health endpoint reports preview mode', async () => {
  const config = createPreviewConfig();
  const state = createPreviewState();
  const app = createServer(state, config, null, { preview: true });
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const res = await request(port, '/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.preview, true);
    assert.equal(res.body.aisConnected, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('preview mode does not import tracking client modules', () => {
  const previewSource = fs.readFileSync(path.join(ROOT, 'src', 'preview.js'), 'utf8');
  const demoSource = fs.readFileSync(path.join(ROOT, 'src', 'demo-map-api.js'), 'utf8');
  const forbiddenImports = /from\s+['"][^'"]*\/(aisstream|datadocked|openmeteo|arcgis|config)['"]/i;
  assert.doesNotMatch(previewSource, forbiddenImports, 'preview.js must not import tracking modules');
  assert.doesNotMatch(demoSource, forbiddenImports, 'demo-map-api.js must not import tracking modules');
  assert.doesNotMatch(previewSource, /dotenv/i, 'preview.js must not load dotenv');
});

test('preview entry does not initialize DataDockedClient, AISStreamClient, OpenMeteoClient or ArcGIS', async () => {
  const server = startPreviewServer(0);
  const port = server.address().port;
  const [mapData, health] = await Promise.all([
    request(port, '/api/map-data'),
    request(port, '/health')
  ]);
  await new Promise((resolve) => server.close(resolve));

  assert.equal(mapData.body.meta.source, 'local-demo-fixture');
  assert.equal(health.body.preview, true);
  assert.equal(health.body.aisConnected, false);
});

test('fixture data lives under test/demo directory', () => {
  const fixturePath = path.join(ROOT, 'test', 'demo', 'fixtures.js');
  assert.ok(fs.existsSync(fixturePath));
});
