import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MONTREAL_OPERATIONAL_WEBMAP_ITEM_ID
} from '../public/spatial/montreal-operational-config.js';
import {
  MAP_FOUNDATION_STATES,
  RUNTIME_PLANE_ID
} from '../public/spatial-v2/map/map-foundation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const V2 = path.join(ROOT, 'public', 'spatial-v2');

function read(...parts) {
  return fs.readFileSync(path.join(V2, ...parts), 'utf8');
}

test('V2 map foundation is a single long-lived MapView contract', () => {
  const foundation = read('map', 'map-foundation.js');
  assert.equal((foundation.match(/mapViewCreateCount \+= 1/g) || []).length, 1);
  assert.equal((foundation.match(/new MapView\(/g) || []).length, 1);
  assert.match(foundation, /popupEnabled = false/);
  assert.match(foundation, /ui\.components = \['attribution'\]/);
  assert.doesNotMatch(foundation, /\.save\(/);
  assert.doesNotMatch(foundation, /portalItem\.update/);
  assert.doesNotMatch(foundation, /spatial-arcgis-runtime/);
  assert.doesNotMatch(foundation, /spatial-map-command/);
  assert.doesNotMatch(foundation, /LayerList/);
  assert.doesNotMatch(foundation, /applyStartupLayerVisibilityPolicy/);
  assert.equal(MAP_FOUNDATION_STATES.INITIALIZING, 'INITIALIZING');
  assert.equal(MAP_FOUNDATION_STATES.READY, 'READY');
  assert.equal(MAP_FOUNDATION_STATES.ERROR, 'ERROR');
  assert.equal(RUNTIME_PLANE_ID, 'iqai-v2-runtime-plane');
});

test('V2 map foundation reuses the existing Montréal WebMap id', () => {
  const foundation = read('map', 'map-foundation.js');
  assert.equal(MONTREAL_OPERATIONAL_WEBMAP_ITEM_ID, '2ec27986ecfb4dd188d058cae620be0d');
  assert.match(foundation, /montreal-operational-config\.js/);
  assert.match(foundation, /oauthConfig\.webmapItemId \|\| MONTREAL_OPERATIONAL_WEBMAP_ITEM_ID/);
  assert.doesNotMatch(foundation, /1c907de6411740a6a8ac463e40955d1a/);
});

test('V2 map foundation keeps authored and runtime planes distinct', () => {
  const foundation = read('map', 'map-foundation.js');
  assert.match(foundation, /RUNTIME_PLANE_ID/);
  assert.match(foundation, /new GroupLayer/);
  assert.match(foundation, /layers:\s*\[\]/);
  assert.match(foundation, /collectAuthoredLayerIds/);
  assert.match(foundation, /ensureImageryObservationSlot/);
  assert.match(foundation, /ensureAuthoredNearmapGroundSlot/);
  assert.match(foundation, /installMapViewHostCss/);
  assert.match(foundation, /box-sizing: content-box/);
  assert.match(foundation, /preserveMapViewDrawingBuffer/);
  assert.match(foundation, /preserveDrawingBuffer: true/);
  assert.ok(
    foundation.indexOf('ensureImageryObservationSlot') < foundation.indexOf('new MapView('),
    'observation WebTileLayer slot must exist before MapView construction'
  );
  assert.ok(
    foundation.indexOf('ensureAuthoredNearmapGroundSlot') < foundation.indexOf('new MapView('),
    'authored Nearmap WMS must be top-level before MapView construction'
  );
});

test('V2 map UI is shell-native and does not import V1 GIS chrome', () => {
  const nav = read('map', 'map-nav-controls.js');
  const stage = read('shell', 'MapStage.js');
  const app = read('shell', 'AppShell.js');
  const html = read('index.html');
  assert.match(nav, /data-iqai-map-nav="zoom-in"/);
  assert.match(nav, /data-iqai-map-nav="zoom-out"/);
  assert.match(nav, /data-iqai-map-nav="home"/);
  assert.doesNotMatch(nav, /widgets\/Zoom/);
  assert.doesNotMatch(nav, /widgets\/Search/);
  assert.match(stage, /data-iqai-map-host/);
  assert.match(stage, /INITIALIZING/);
  assert.match(stage, /ERROR/);
  assert.doesNotMatch(stage, /Operational map surface/);
  assert.match(app, /initMapFoundation/);
  assert.doesNotMatch(app, /initSpatialArcgisRuntime/);
  assert.match(html, /js\.arcgis\.com\/5\.1\/esri\/themes\/light\/main\.css/);
  assert.doesNotMatch(html, /\/spatial\/spatial\.js/);
});

test('V1 spatial index is unchanged by the V2 map foundation', () => {
  const v1 = fs.readFileSync(path.join(ROOT, 'public', 'spatial', 'index.html'), 'utf8');
  assert.match(v1, /src="\/spatial\/spatial\.js"/);
  assert.doesNotMatch(v1, /spatial-v2/);
});
