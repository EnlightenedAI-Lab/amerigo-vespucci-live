import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../src/server.js';
import { createPreviewConfig, createPreviewState } from '../src/demo-map-api.js';
import {
  DATE_KIND,
  ENABLED_GROUND_MODES,
  GROUND_MODE,
  IMAGERY_PLANE_ID,
  MATCH_KIND,
  PROVIDER_READINESS_STATE,
  deltaDays,
  nearestByIsoDate
} from '../public/spatial-v2/imagery/imagery-contract.js';
import {
  buildNearmapWmsGetMapUrl,
  isAuthoredNearmapWmsLayer
} from '../public/spatial-v2/imagery/providers/nearmap-wms-ground-provider.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const V2 = path.join(ROOT, 'public', 'spatial-v2');
const IMAGERY = path.join(V2, 'imagery');

const REQUIRED_FILES = [
  'imagery/imagery-contract.js',
  'imagery/imagery-plane.js',
  'imagery/ground-controller.js',
  'imagery/providers/canvas-provider.js',
  'imagery/providers/esri-world-imagery-provider.js',
  'imagery/providers/google-map-tiles-provider.js',
  'imagery/providers/legacy-google-satellite-demo-provider.js',
  'imagery/providers/nearmap-wms-ground-provider.js',
  'shell/ImageryPanel.js'
];

function read(...parts) {
  return fs.readFileSync(path.join(V2, ...parts), 'utf8');
}

function walkFiles(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

function request(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${urlPath}`, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          body: Buffer.concat(chunks).toString('utf8')
        });
      });
    }).on('error', reject);
  });
}

test('Ground Controller V1 files exist', () => {
  for (const rel of REQUIRED_FILES) {
    assert.equal(fs.existsSync(path.join(V2, rel)), true, `missing ${rel}`);
  }
});

test('Ground Controller keeps only the required initial set statically enabled', () => {
  assert.deepEqual([...ENABLED_GROUND_MODES], [
    GROUND_MODE.AUTHORED_WEBMAP,
    GROUND_MODE.PURE_BLACK,
    GROUND_MODE.PURE_WHITE,
    GROUND_MODE.ESRI_WORLD_IMAGERY
  ]);
  assert.equal(PROVIDER_READINESS_STATE.READY, 'READY');
  assert.equal(PROVIDER_READINESS_STATE.NOT_CONFIGURED, 'NOT_CONFIGURED');
  assert.equal(PROVIDER_READINESS_STATE.ENTITLEMENT_REQUIRED, 'ENTITLEMENT_REQUIRED');
  assert.equal(PROVIDER_READINESS_STATE.NO_COVERAGE, 'NO_COVERAGE');
  assert.equal(PROVIDER_READINESS_STATE.UNAVAILABLE, 'UNAVAILABLE');
  const panel = read('shell', 'ImageryPanel.js');
  const contract = read('imagery', 'imagery-contract.js');
  for (const mode of [
    'AUTHORED_WEBMAP',
    'PURE_BLACK',
    'PURE_WHITE',
    'ESRI_WORLD_IMAGERY',
    'LEGACY_GOOGLE_SATELLITE_DEMO',
    'GOOGLE_SATELLITE',
    'NEARMAP',
    'LOCAL_HIGHRES'
  ]) {
    assert.match(contract, new RegExp(mode));
    assert.match(panel, /listGroundModes/);
  }
  const ground = read('imagery', 'ground-controller.js');
  const nearmap = read('imagery', 'providers', 'nearmap-wms-ground-provider.js');
  const google = read('imagery', 'providers', 'google-map-tiles-provider.js');
  assert.match(ground, /refreshProviderReadiness/);
  assert.match(ground, /readinessState/);
  assert.match(ground, /googleMapTilesProvider/);
  assert.match(ground, /nearmapWmsGroundProvider/);
  assert.match(ground, /No verified local WMS\/WMTS is configured/);
  assert.match(google, /\/api\/spatial-v2\/imagery\/google\/status/);
  assert.match(google, /currentGroundOnly: true/);
  assert.match(google, /analysis: RIGHTS\.PROHIBITED/);
  assert.match(nearmap, /\/api\/spatial-v2\/imagery\/nearmap\/wms/);
  assert.match(nearmap, /findAuthoredNearmapWmsLayer/);
  assert.match(nearmap, /ensureAuthoredNearmapGroundSlot/);
  assert.match(nearmap, /applyAuthoredNearmapGround/);
  assert.match(nearmap, /Nearmap\/Nearmap\/Canada/);
  assert.match(nearmap, /Aerial 3.5cm/);
  assert.match(nearmap, /layer\.refresh/);
  assert.match(nearmap, /webmap\.layers\.add\(layer, 0\)/);
  assert.match(nearmap, /BaseTileLayer/);
  assert.match(nearmap, /fetchTile\(level, row, col, options\)/);
  assert.match(nearmap, /set\('FORMAT', NEARMAP_WMS_FORMAT\)/);
  assert.match(nearmap, /set\('SRS', NEARMAP_WMS_SRS\)/);
  assert.match(nearmap, /request\.interceptors/);
  assert.match(nearmap, /NEARMAP_WMS_PATH/);
  assert.match(nearmap, /HTMLImageElement/);
  assert.match(ground, /applyAuthoredNearmapGround/);
  assert.doesNotMatch(nearmap, /new WMSLayer/);
  const foundation = read('map', 'map-foundation.js');
  assert.match(foundation, /ensureNearmapWmsInterceptor/);
  assert.match(foundation, /ensureAuthoredNearmapGroundSlot/);
  assert.match(foundation, /applyOperationalHome/);
  assert.ok(
    foundation.indexOf('ensureAuthoredNearmapGroundSlot') < foundation.indexOf('new MapView('),
    'Nearmap current-ground tile layer must exist before MapView construction'
  );
  assert.doesNotMatch(nearmap, /api\.nearmap\.com/);
  assert.doesNotMatch(nearmap, /NEARMAP_API_KEY/);
  assert.doesNotMatch(nearmap, /NEARMAP_WMS_URL/);
  assert.doesNotMatch(ground, /Nearmap as a ground canvas is not this milestone/);
});

test('Nearmap current ground identifies the authored Canada WMS layer', () => {
  assert.equal(isAuthoredNearmapWmsLayer({
    title: 'Aerial 3.5cm',
    type: 'wms',
    url: 'https://example.invalid/wms/v1/latest/apikey/redacted',
    visibleLayers: ['Nearmap/Nearmap/Canada']
  }), true);
  assert.equal(isAuthoredNearmapWmsLayer({
    title: 'Satelite',
    type: 'web-tile',
    url: ''
  }), false);
});

test('Nearmap current ground GetMap uses the authored Canada WMS parameters', () => {
  const url = buildNearmapWmsGetMapUrl({
    bbox: '-8250000,5680000,-8240000,5690000',
    origin: 'http://127.0.0.1'
  });
  assert.match(url, /\/api\/spatial-v2\/imagery\/nearmap\/wms/);
  assert.match(url, /REQUEST=GetMap/);
  assert.match(url, /VERSION=1\.1\.1/);
  assert.match(url, /LAYERS=Nearmap%2FNearmap%2FCanada/);
  assert.match(url, /FORMAT=image%2Fjpeg/);
  assert.match(url, /SRS=EPSG%3A3857/);
  assert.doesNotMatch(url, /api\.nearmap\.com/);
  assert.doesNotMatch(url, /TIME=/);
});

test('Nearmap display proof samples bounded isolated pixels, not the full 4K framebuffer', () => {
  const ground = read('imagery', 'ground-controller.js');
  assert.match(ground, /mapview-ground-layer-isolated-screenshot-v1/);
  assert.match(ground, /GROUND_PROOF_SAMPLE_PX = 512/);
  assert.match(ground, /groundProofSampleArea/);
  assert.match(ground, /layers: \[layer\]/);
  assert.match(ground, /area: \{ x: sample\.x, y: sample\.y, width: sample\.width, height: sample\.height \}/);
  assert.match(ground, /opaquePixelCount >= 256/);
  assert.match(ground, /opaqueShare >= 0\.05/);
  assert.match(ground, /contrast >= 16/);
  assert.match(ground, /waitGroundFrames/);
  assert.doesNotMatch(ground, /displayConfirmed = layerView/);
  assert.doesNotMatch(ground, /confirmed: layer\.loaded/);
  assert.doesNotMatch(ground, /confirmed: evidence\.network/);
});

test('Ground Controller V1 is session-only hybrid overlay architecture', () => {
  const ground = read('imagery', 'ground-controller.js');
  const plane = read('imagery', 'imagery-plane.js');
  const foundation = read('map', 'map-foundation.js');
  assert.equal(IMAGERY_PLANE_ID, 'iqai-v2-imagery-plane');
  assert.match(ground, /ensureImageryObservationSlot/);
  assert.match(plane, /webmap\.layers\.add\(imageryPlane, 0\)/);
  assert.match(ground, /authoredBasemap = webmap\.basemap/);
  assert.match(ground, /webmap\.basemap = authoredBasemap/);
  assert.match(ground, /new ColorBackground/);
  assert.match(ground, /view\.background = new ColorBackground/);
  assert.match(ground, /token !== generation/);
  assert.match(ground, /applyMode\(previous\)/);
  assert.match(ground, /whenLayerView/);
  assert.match(ground, /Map view settlement timed out/);
  assert.doesNotMatch(ground, /\.save\(/);
  assert.doesNotMatch(ground, /saveAs\(/);
  assert.doesNotMatch(ground, /portalItem\.update/);
  assert.doesNotMatch(ground, /TimeSlider/);
  assert.doesNotMatch(ground, /timeExtent/);
  assert.doesNotMatch(ground, /view\.goTo/);
  assert.doesNotMatch(ground, /authoredBasemap\.destroy/);
  assert.equal((foundation.match(/new MapView\(/g) || []).length, 1);
  assert.equal((ground.match(/new MapView\(/g) || []).length, 0);
});

test('Ground Controller V1 Esri World Imagery is imagery-only, not hybrid labels', () => {
  const esri = read('imagery', 'providers', 'esri-world-imagery-provider.js');
  assert.match(esri, /arcgis\/imagery/);
  assert.match(esri, /Basemap\.fromId\(FALLBACK_LEGACY_ID\)/);
  assert.match(esri, /satellite/);
  assert.doesNotMatch(esri, /imagery-hybrid/);
  assert.doesNotMatch(esri, /arcgis\/imagery\/labels/);
});

test('Ground Controller V1 Google demo is isolated, unofficial, and not an analysis source', () => {
  const demo = read('imagery', 'providers', 'legacy-google-satellite-demo-provider.js');
  const imageryFiles = walkFiles(IMAGERY).concat([
    path.join(V2, 'shell', 'ImageryPanel.js'),
    path.join(V2, 'shell', 'AppShell.js'),
    path.join(V2, 'shell', 'operator-session.js')
  ]);
  assert.match(demo, /mt\{subDomain\}\.google\.com\/vt\/lyrs=s/);
  assert.match(demo, /subDomains: \['0', '1', '2', '3'\]/);
  assert.match(demo, /copyright: 'Google'/);
  assert.match(demo, /analysis: RIGHTS\.PROHIBITED/);
  assert.match(demo, /Not Google Map Tiles API/);
  assert.equal(ENABLED_GROUND_MODES.includes(GROUND_MODE.LEGACY_GOOGLE_SATELLITE_DEMO), false);
  assert.doesNotMatch(demo, /GOOGLE_MAPS_BROWSER_API_KEY/);
  for (const file of imageryFiles) {
    const text = fs.readFileSync(file, 'utf8');
    if (file.endsWith('legacy-google-satellite-demo-provider.js')) continue;
    assert.equal(text.includes('mt.google.com'), false, `${file} must not embed Google XYZ`);
    assert.doesNotMatch(text, /GOOGLE_MAPS_BROWSER_API_KEY/);
    assert.doesNotMatch(text, /1c907de6411740a6a8ac463e40955d1a/);
  }
});

test('Ground Controller V1 canvas modes are empty basemaps plus ColorBackground', () => {
  const ground = read('imagery', 'ground-controller.js');
  const canvas = read('imagery', 'providers', 'canvas-provider.js');
  assert.match(ground, /baseLayers: \[\]/);
  assert.match(ground, /\[255, 255, 255, 1\]/);
  assert.match(ground, /\[0, 0, 0, 1\]/);
  assert.match(canvas, /PURE_BLACK/);
  assert.match(canvas, /PURE_WHITE/);
  assert.match(canvas, /Not imagery/);
});

test('Ground Controller V1 HUD and provenance are shell-native', () => {
  const panel = read('shell', 'ImageryPanel.js');
  const stage = read('shell', 'MapStage.js');
  const app = read('shell', 'operator-session.js');
  const css = read('iqai-spatial-v2.css');
  assert.match(stage, /data-iqai-imagery-dock/);
  assert.match(panel, /data-iqai-imagery-panel/);
  assert.match(panel, /setGroundMode/);
  assert.match(app, /bootImageryGround/);
  assert.match(app, /setInspectorRegion/);
  assert.match(app, /provenance-slot/);
  assert.match(css, /pointer-events: none/);
  assert.match(css, /\.iqai-v2-imagery-panel/);
  assert.match(css, /pointer-events: auto/);
  assert.doesNotMatch(panel, /TimeSlider/);
  assert.doesNotMatch(app, /view\.timeExtent/);
});

test('Imagery date helpers stay honest', () => {
  assert.equal(DATE_KIND.RELEASE, 'releaseDate');
  assert.equal(DATE_KIND.FIRST_PUBLIC, 'firstPublicDate');
  assert.equal(deltaDays('2024-01-10', '2024-01-12'), 2);
  const records = [
    { id: 'a', releaseDate: '2020-01-01' },
    { id: 'b', releaseDate: '2022-06-15' },
    { id: 'c', releaseDate: '2024-01-01' }
  ];
  const exact = nearestByIsoDate(records, '2022-06-15', 'releaseDate');
  assert.equal(exact.match, MATCH_KIND.EXACT);
  assert.equal(exact.record.id, 'b');
  assert.equal(exact.deltaDays, 0);
  const nearest = nearestByIsoDate(records, '2022-06-20', 'releaseDate');
  assert.equal(nearest.match, MATCH_KIND.NEAREST);
  assert.equal(nearest.record.id, 'b');
  assert.equal(nearest.deltaDays, -5);
});

test('preview server serves Ground Controller modules', async () => {
  const app = createServer(createPreviewState(), createPreviewConfig(), null, { preview: true });
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const ground = await request(port, '/spatial-v2/imagery/ground-controller.js');
    const panel = await request(port, '/spatial-v2/shell/ImageryPanel.js');
    assert.equal(ground.status, 200);
    assert.equal(panel.status, 200);
    assert.match(ground.body, /initGroundController/);
    assert.match(panel.body, /bindImageryPanel/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('V1 spatial surface is unchanged by Ground Controller V1', () => {
  const v1 = fs.readFileSync(path.join(ROOT, 'public', 'spatial', 'index.html'), 'utf8');
  assert.match(v1, /src="\/spatial\/spatial\.js"/);
  assert.doesNotMatch(v1, /spatial-v2/);
  assert.doesNotMatch(v1, /iqai-v2-imagery-plane/);
});
