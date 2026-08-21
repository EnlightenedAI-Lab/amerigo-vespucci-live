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
  assert.doesNotMatch(foundation, /ui\.components\s*=/);
  assert.match(foundation, /required attribution in the default MapView UI/);
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

test('V2 map foundation publishes READY only after the MAP LayerView settles', () => {
  const foundation = read('map', 'map-foundation.js');
  const bootstrap = foundation.slice(foundation.indexOf('async function bootstrap'));
  const settled = bootstrap.indexOf('await waitForMapLayerViewReady(mapView, cartoBaseLayer, reactiveUtils)');
  const ready = bootstrap.indexOf('state = MAP_FOUNDATION_STATES.READY');

  assert.match(foundation, /MAP_READY_TIMEOUT_MS = 60000/);
  assert.match(foundation, /reactiveUtils\.whenOnce\(\(\) => layerView\.updating === false\)/);
  assert.match(foundation, /MAP_READY_TIMEOUT_MS, 'MAP VectorTileLayer readiness'/);
  assert.ok(settled >= 0 && ready > settled, 'READY follows settled MAP LayerView readiness');
});

test('V2 map foundation boots a Portal-independent IQAI Map', () => {
  const foundation = read('map', 'map-foundation.js');
  assert.equal(MONTREAL_OPERATIONAL_WEBMAP_ITEM_ID, '2ec27986ecfb4dd188d058cae620be0d');
  assert.match(foundation, /montreal-operational-config\.js/);
  assert.match(foundation, /portalIndependent: true/);
  assert.match(foundation, /createIqaiAerialBasemap/);
  assert.match(foundation, /aerialBasemap = await createIqaiAerialBasemap/);
  const boot = foundation.slice(
    foundation.indexOf('async function bootstrap'),
    foundation.indexOf('new MapView(')
  );
  assert.match(boot, /createIqaiMapBasemap/);
  assert.doesNotMatch(boot, /await createIqaiAerialBasemap/);
  assert.doesNotMatch(boot, /await prepareAerialBasemap/);
  assert.doesNotMatch(boot, /await ensureAuthoredNearmapGroundSlot/);
  assert.doesNotMatch(boot, /await ensureImageryObservationSlot/);
  assert.doesNotMatch(foundation, /mapBasemap\.baseLayers\.add\(aerialBaseLayer/);
  assert.match(foundation, /webMap\.basemap = nextBasemap/);
  assert.match(foundation, /presentIqaiMapSurface/);
  assert.doesNotMatch(foundation, /basemap: 'streets-vector'/);
  assert.doesNotMatch(foundation, /new WebMap\(/);
  assert.doesNotMatch(foundation, /signInToAgol/);
  assert.doesNotMatch(foundation, /registerAgolOAuth/);
  assert.doesNotMatch(foundation, /registerOAuthInfos/);
  assert.doesNotMatch(foundation, /oauthConfig\.webmapItemId \|\| MONTREAL_OPERATIONAL_WEBMAP_ITEM_ID/);
  assert.doesNotMatch(foundation, /1c907de6411740a6a8ac463e40955d1a/);
});

test('V2 MAP surface can switch working White/Black/Streets basemaps without a second MapView', () => {
  const foundation = read('map', 'map-foundation.js');
  const picker = read('shell', 'BasemapPicker.js');
  const session = read('bootstrap', 'worldview-map-session.js');
  const publicBasemap = read('map', 'iqai-public-basemap.js');
  assert.equal((foundation.match(/new MapView\(/g) || []).length, 1);
  assert.match(foundation, /IQAI_SESSION_BASEMAPS/);
  assert.match(foundation, /setSessionEsriBasemap/);
  assert.match(foundation, /title: 'White'/);
  assert.match(foundation, /title: 'Black'/);
  assert.match(foundation, /group: 'basemap'/);
  assert.match(foundation, /esriIds: \['satellite'\]/);
  assert.match(foundation, /esriIds: \['hybrid'\]/);
  assert.match(publicBasemap, /createIqaiWhiteBasemap/);
  assert.match(publicBasemap, /createIqaiBlackBasemap/);
  assert.match(publicBasemap, /ESRI_WORLD_BASEMAP_STYLE_URL/);
  assert.match(publicBasemap, /World_Basemap_v2\/VectorTileServer/);
  assert.match(publicBasemap, /if \(layer.type === 'symbol'\) return \[\];/);
  assert.match(publicBasemap, /land: '#ffffff'/);
  assert.doesNotMatch(publicBasemap, /sharing\/rest\/content\/items/);
  assert.doesNotMatch(publicBasemap, /portalItem/);
  assert.match(picker, /BASEMAPS/);
  assert.doesNotMatch(picker, /label: 'VECTOR'/);
  assert.match(picker, /setSessionEsriBasemap/);
  assert.match(picker, /setMapSurface/);
  assert.match(session, /bindBasemapPicker/);
  assert.doesNotMatch(foundation, /BasemapGallery/);
  assert.doesNotMatch(picker, /new MapView\(/);
});

test('V2 map foundation uses Esri vector streets MAP and Nearmap AERIAL', () => {
  const publicBasemap = read('map', 'iqai-public-basemap.js');
  const stage = read('shell', 'MapStage.js');
  const host = read('hosts', 'view-host.js');
  const command = read('shell', 'ImageryCommandSurface.js');
  const foundation = read('map', 'map-foundation.js');
  assert.match(publicBasemap, /World_Basemap_v2\/VectorTileServer/);
  assert.match(publicBasemap, /VectorTileLayer/);
  assert.match(publicBasemap, /iqai-esri-streets-vector/);
  assert.match(publicBasemap, /World_Street_Map\/MapServer\/tile/);
  assert.doesNotMatch(publicBasemap, /basemaps\.cartocdn\.com\/light_all/);
  assert.match(publicBasemap, /wayback\.maptiles\.arcgis\.com/);
  assert.match(publicBasemap, /AERIAL_PROOF_RELEASE = 26334/);
  assert.match(publicBasemap, /28 MAY 2025/);
  assert.match(publicBasemap, /WebTileLayer/);
  assert.match(publicBasemap, /IQAI_MAP_MAX_ZOOM = 22/);
  assert.match(publicBasemap, /IQAI_AERIAL_MAX_ZOOM = 23/);
  assert.match(publicBasemap, /createIqaiWaybackBasemap/);
  assert.match(publicBasemap, /createNearmapCurrentTileLayer/);
  assert.match(publicBasemap, /AERIAL_CURRENT_LABEL = 'NEARMAP CURRENT'/);
  assert.match(foundation, /maxZoom: IQAI_MAP_MAX_ZOOM/);
  assert.match(foundation, /2500, 'whenLayerView'/);
  assert.match(foundation, /Math.min\(maxZoom, next\)/);
  assert.match(foundation, /SPATIAL_V2_MAP_ZOOM = 15/);
  assert.doesNotMatch(command, /CURRENT AERIAL · DATE NOT PROVIDED/);
  assert.match(command, /NEARMAP CURRENT/);
  assert.doesNotMatch(command, /IMAGE DATE 28 MAY 2025/);
  assert.doesNotMatch(stage, /CURRENT AERIAL · DATE NOT PROVIDED/);
  assert.doesNotMatch(host, /CURRENT AERIAL · DATE NOT PROVIDED/);
  assert.doesNotMatch(stage, /Loading the authored Montréal WebMap/);
  assert.doesNotMatch(host, /authored operational WebMap/);
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
  assert.match(foundation, /ensureMapViewSurfaceSize/);
  assert.match(foundation, /waitForMapHostLayout/);
  assert.match(foundation, /box-sizing: content-box/);
  assert.match(foundation, /preserveMapViewDrawingBuffer/);
  assert.match(foundation, /preserveDrawingBuffer: true/);
  const boot = foundation.slice(
    foundation.indexOf('async function bootstrap'),
    foundation.indexOf('new MapView(')
  );
  assert.doesNotMatch(boot, /ensureImageryObservationSlot/);
  assert.doesNotMatch(boot, /ensureAuthoredNearmapGroundSlot/);
  assert.ok(
    foundation.indexOf('new MapView(') < foundation.lastIndexOf('ensureImageryObservationSlot'),
    'observation slot is lazy after MapView'
  );
});

test('V2 map UI is shell-native and does not import V1 GIS chrome', () => {
  const nav = read('map', 'map-nav-controls.js');
  const stage = read('shell', 'MapStage.js');
  const app = read('shell', 'operator-session.js');
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

test('V2 map pointer remains the ordinary OS cursor unless a placement tool is armed', () => {
  const css = read('iqai-spatial-v2.css');
  assert.doesNotMatch(css, /cursor:\s*none/);
  assert.match(css, /iqai-v2-map-host:not\(\.is-drop-pin\):not\(\.is-place-camera\)/);
  assert.match(css, /cursor:\s*default/);
  assert.match(css, /is-drop-pin/);
  assert.match(css, /is-place-camera[\s\S]{0,240}cursor:\s*crosshair/);
});

test('V1 spatial index is unchanged by the V2 map foundation', () => {
  const v1 = fs.readFileSync(path.join(ROOT, 'public', 'spatial', 'index.html'), 'utf8');
  assert.match(v1, /src="\/spatial\/spatial\.js"/);
  assert.doesNotMatch(v1, /spatial-v2/);
});
