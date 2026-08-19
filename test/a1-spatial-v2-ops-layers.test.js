import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAYERS, PANEL_GROUPS } from '../src/spatial-v2/ops-layers/catalog.mjs';
import {
  DEFAULT_SCENES,
  defaultLayers,
  getScene,
  listScenes,
  sameSet,
  saveBuiltinLayers,
  resetBuiltin
} from '../public/spatial-v2/ops-layers/scenes.js';
import { buildLayerInfo } from '../public/spatial-v2/ops-layers/snapshot.js';
import { buildSceneBrief, truthLabel } from '../public/spatial-v2/ops-layers/scene-brief.js';
import { markerStyleFor, visualClass } from '../public/spatial-v2/ops-layers/symbology.js';
import { ACQUISITION_OWNER, VISIBILITY_OWNER, createLayerSession } from '../public/spatial-v2/map/woa/layer-session.js';
import { createSelectableRegistry, registerManifest } from '../public/spatial-v2/map/woa/sources.js';
import { renderAppShell } from '../public/spatial-v2/shell/AppShell.js';
import { isAisSpatialStreamEnabled } from '../src/spatial/aisstream-config.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const V2 = path.join(ROOT, 'public', 'spatial-v2');

function read(rel) {
  return fs.readFileSync(path.join(V2, rel), 'utf8');
}

function readSrc(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function catalogIds() {
  return LAYERS.map((layer) => layer.id);
}

function expectedFamilies() {
  return [
    'recent-crime', 'spvm-crime', 'pdq-territories', 'pdq', 'fire', 'fire-interventions', 'hospitals', 'civic-311',
    'stm', 'exo', 'rem', 'bixi', 'bike-counters', 'road-traffic', 'intersection-counts', 'road-works', 'qc-511', 'traffic-cameras', 'aircraft',
    'hydro', 'snow-ops',
    'weather', 'air-quality', 'hydrometric',
    'wildfire-active', 'wildfire-hotspots', 'wildfire-perimeters', 'wildfire-fwi'
  ];
}

test('Operational catalog V1.5 registers the accepted families with honest blocked states', () => {
  const ids = catalogIds();
  for (const id of expectedFamilies()) {
    assert.equal(ids.includes(id), true, `missing ${id}`);
  }
  assert.equal(ids.includes('hydrant'), false);
  assert.equal(ids.includes('traffic_signal'), false);
  assert.equal(ids.some((id) => /solar/i.test(id)), false);
  assert.equal(ids.some((id) => id === 'port' || id.startsWith('port-')), false);
  const byId = Object.fromEntries(LAYERS.map((layer) => [layer.id, layer]));
  assert.equal(byId.exo.expectedStatus, 'AUTH_REQUIRED');
  assert.equal(byId.rem.expectedStatus, 'UNAVAILABLE');
  assert.equal(byId['road-traffic'].expectedStatus, 'UNAVAILABLE');
  assert.equal(byId['snow-ops'].expectedStatus, 'AUTH_REQUIRED');
  assert.equal(byId.stm.expectedStatus, 'AUTH_REQUIRED');
  assert.equal(PANEL_GROUPS.map((g) => g.id).join(','), 'public-safety,wildfire,movement,infrastructure,environment');
});

test('Scene presets apply the accepted membership including ALL OFF / RESTORE / SOLO / CONFIGURE', () => {
  const scenes = listScenes({ scenes: {}, custom: [] });
  assert.deepEqual(scenes.map((s) => s.id), [
    'public-safety', 'movement', 'infrastructure', 'weather-impact', 'wildfire', 'police-picture'
  ]);
  const safety = defaultLayers('public-safety');
  assert.equal(safety.includes('recent-crime'), true);
  assert.equal(safety.includes('hydrant'), false);
  const movement = getScene('movement', { scenes: {}, custom: [] });
  assert.equal(movement.layers.includes('exo'), true);
  assert.equal(movement.layers.includes('rem'), true);
  const visible = [...safety];
  assert.equal(sameSet(visible, safety), true);
  const allOff = [];
  assert.equal(sameSet(allOff, safety), false);
  const restore = [...safety];
  assert.equal(sameSet(restore, safety), true);
  const solo = ['fire'];
  assert.equal(solo.length === 1 && solo[0] === 'fire', true);
  const configured = ['recent-crime', 'pdq'];
  const store = { scenes: { 'public-safety': configured }, custom: [] };
  assert.deepEqual(getScene('public-safety', store).layers, configured);
  resetBuiltin('public-safety');
  saveBuiltinLayers('public-safety', configured);
});

test('Layers / Discover owns visibility; hidden WOA hydrant and signal cannot be acquired', () => {
  const manifest = JSON.parse(read('data/woa/sources.json'));
  const registry = createSelectableRegistry();
  registerManifest(registry, manifest);
  const session = createLayerSession(registry.list());
  assert.equal(session.visibilityOwner, VISIBILITY_OWNER);
  assert.equal(session.acquisitionOwner, ACQUISITION_OWNER);
  assert.equal(session.isVisible('hydrant'), false);
  assert.equal(session.isSelectable('hydrant'), false);
  assert.equal(session.isVisible('traffic_signal'), false);
  assert.equal(session.isSelectable('traffic_signal'), false);
  session.setVisible('hydrant', true);
  session.setVisible('traffic_signal', true);
  assert.equal(session.isSelectable('hydrant'), true);
  assert.equal(session.isSelectable('traffic_signal'), true);
  session.setVisible('hydrant', false);
  assert.equal(session.isSelectable('hydrant'), false);
});

test('INFO and Intelligence Brief report observable data only', () => {
  const layer = LAYERS.find((item) => item.id === 'recent-crime');
  const payload = {
    status: 'RECENT',
    source: 'SPVM',
    featureCount: 12,
    asOfDate: '2026-08-18',
    latestSourceTimestamp: '2026-08-18',
    categories: [{ french: 'Vol', count: 7 }],
    geojson: { type: 'FeatureCollection', features: [] },
    limitation: 'Not live CAD.'
  };
  const info = buildLayerInfo(layer, payload, {});
  assert.equal(info.what.includes('criminal-act'), true);
  assert.equal(info.status, 'RECENT');
  assert.equal(info.source, 'SPVM');
  assert.equal(Boolean(info.limitation), true);
  assert.equal(Boolean(info.sourceRecord), true);
  const catalog = {
    layers: [
      { id: 'recent-crime', title: 'Recent Crime', status: 'RECENT', lastPayload: payload },
      { id: 'stm', title: 'STM', status: 'AUTH_REQUIRED', lastPayload: { ok: false, status: 'AUTH_REQUIRED', featureCount: 0, geojson: { type: 'FeatureCollection', features: [] } } },
      { id: 'road-traffic', title: 'Road Traffic', status: 'UNAVAILABLE', lastPayload: { ok: false, status: 'UNAVAILABLE' } },
      { id: 'exo', title: 'EXO', status: 'AUTH_REQUIRED', lastPayload: { ok: false, status: 'AUTH_REQUIRED' } },
      { id: 'rem', title: 'REM', status: 'UNAVAILABLE', lastPayload: { ok: false, status: 'UNAVAILABLE' } }
    ]
  };
  const safety = buildSceneBrief(DEFAULT_SCENES[0], { catalog, view: null });
  const factText = JSON.stringify(safety.facts);
  assert.doesNotMatch(factText, /risk score|threat score|predictive-policing score/i);
  assert.equal(safety.facts.some((row) => row.label === 'RECENT CRIME'), true);
  const police = buildSceneBrief(DEFAULT_SCENES.find((s) => s.id === 'police-picture'), { catalog, view: null });
  assert.match(police.warning || '', /Observable signals only/i);
  assert.doesNotMatch(JSON.stringify(police.facts), /risk score|threat score/i);
  assert.equal(truthLabel('AUTH_REQUIRED'), 'AUTH REQUIRED');
  assert.equal(truthLabel('UNAVAILABLE'), 'UNAVAILABLE');
});

test('Class-by-shape language and compact Discover chrome stay on Spatial V2 production shell', () => {
  assert.equal(visualClass('fire'), 'facility');
  assert.equal(markerStyleFor('fire'), 'square');
  assert.equal(markerStyleFor('recent-crime'), 'diamond');
  assert.equal(markerStyleFor('stm'), 'circle');
  const html = renderAppShell();
  assert.match(html, /LAYERS \/ DISCOVER/);
  assert.match(html, /data-iqai-discover/);
  assert.match(html, />LAYERS</);
  assert.match(read('shell/LayersDrawer.js'), /onScene/);
  assert.match(read('bootstrap/worldview-map-session.js'), /opsLayers\.loadCatalog/);
  assert.match(readSrc('src/server.js'), /registerOperationalLayerRoutes/);
  assert.doesNotMatch(readSrc('src/spatial-v2/ops-layers/catalog.mjs'), /solar intelligence|census-da|solar-ui/i);
  assert.doesNotMatch(read('ops-layers/controller.js'), /usePresentationMap/);
  assert.equal((read('map/map-foundation.js').match(/new MapView\(/g) || []).length, 1);
  assert.equal(isAisSpatialStreamEnabled({}), false);
});

test('WOA, PLACE CAMERA, Focus, Street360, Google 3D, WorldView seams remain imported', () => {
  const session = read('bootstrap/worldview-map-session.js');
  assert.match(session, /bindFocusInstrument/);
  assert.match(session, /bindPlaceCameraControl/);
  assert.match(session, /bindStreet360Control/);
  assert.match(session, /bindGooglePhotorealistic3dControl/);
  assert.match(session, /bindWorldViewFrame/);
  assert.match(read('map/woa/layer-session.js'), /visibilityOwner/);
  assert.doesNotMatch(readSrc('src/spatial-v2/ops-layers/catalog.mjs'), /sun\.mjs|census-da|solar-ui/);
});
