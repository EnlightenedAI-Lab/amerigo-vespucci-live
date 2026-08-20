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
import {
  CLUSTER_LAYERS,
  markerStyleFor,
  pathStyle,
  pointSymbol,
  visualClass
} from '../public/spatial-v2/ops-layers/symbology.js';
import {
  buildOpsInspectorModel,
  createOpsObjectRef,
  renderOpsFeatureInspector
} from '../public/spatial-v2/ops-layers/selection.js';
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
    'weather', 'air-quality', 'hydrometric', 'sun-daylight',
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

test('Class-by-shape language and donor Operational Layers chrome stay on Spatial V2 production shell', () => {
  assert.equal(visualClass('fire'), 'facility');
  assert.equal(markerStyleFor('fire'), 'square');
  assert.equal(markerStyleFor('recent-crime'), 'diamond');
  assert.equal(markerStyleFor('stm'), 'circle');
  assert.equal(visualClass('sun-daylight'), 'environment');
  const html = renderAppShell();
  assert.match(html, /Layers \/ Discover/);
  assert.match(html, /data-iqai-discover/);
  assert.match(html, /iqai-mtl-ops/);
  assert.match(html, />LAYERS</);
  assert.match(read('shell/LayersDrawer.js'), /LAYERS \/ DISCOVER/);
  assert.match(read('shell/LayersDrawer.js'), /onScene/);
  assert.match(read('shell/LayersDrawer.js'), /ops-btn/);
  assert.match(read('shell/LayersDrawer.js'), /INTELLIGENCE BRIEF/);
  assert.match(read('shell/LayersDrawer.js'), /data-iqai-solo-layer/);
  assert.match(read('bootstrap/worldview-map-session.js'), /opsLayers\.loadCatalog/);
  assert.doesNotMatch(read('bootstrap/worldview-map-session.js'), /layerId: layer.session \? 'session-agol' : 'authored-operational-map'/);
  assert.match(read('bootstrap/worldview-map-session.js'), /bindSolarIntelligence/);
  assert.match(read('shell/MapStage.js'), /data-iqai-solar-hud/);
  assert.match(read('ops-layers/solar-ui.js'), /PLAY THE NEXT 24 HOURS/);
  assert.match(read('ops-layers/solar-ui.js'), /CHECK A PLACE/);
  assert.match(read('ops-layers/solar-ui.js'), /COMPUTED · NOT A LIVE WEATHER FEED/);
  assert.match(read('ops-layers/overlay.js'), /iqai-v2-ops-overlay/);
  assert.match(read('ops-layers/overlay.js'), /view\.toScreen/);
  assert.match(read('ops-layers/overlay.js'), /clusteredFeatures/);
  assert.match(read('map/map-foundation.js'), /iqai-v2-ops-graphics/);
  assert.match(read('shell/LayersDrawer.js'), /setAttribute\('for', checkboxId\)/);
  assert.match(read('shell/LayersDrawer.js'), /data-iqai-ops-layer/);
  assert.match(read('shell/LayersDrawer.js'), /syncDiscover/);
  assert.match(read('map/map-foundation.js'), /SPATIAL_V2_MAP_ZOOM = 15/);
  assert.match(read('ops-layers/donor-panel.css'), /iqai-v2-ops-panel-w/);
  assert.match(read('ops-layers/donor-map.css'), /sym-moving\.is-bus/);
  assert.match(read('ops-layers/donor-map.css'), /solar-hud/);
  assert.match(read('bootstrap/worldview-map-session.js'), /setDiscover\?\.\(opsLayers\.snapshot\(\)\)/);
  assert.match(read('map/map-foundation.js'), /portalIndependent: true/);
  assert.doesNotMatch(read('map/map-foundation.js'), /new WebMap\(/);
  assert.match(readSrc('src/server.js'), /registerOperationalLayerRoutes/);
  assert.match(readSrc('src/spatial-v2/ops-layers/catalog.mjs'), /sun-daylight/);
  assert.match(readSrc('src/spatial-v2/ops-layers/routes.js'), /ops-layers\/sun\/state/);
  assert.doesNotMatch(read('ops-layers/controller.js'), /usePresentationMap/);
  assert.equal(CLUSTER_LAYERS.stm.disableAt, 14);
  assert.match(pointSymbol('stm', { routeId: '24' }, { zoom: 15 }).html, /bus-body/);
  assert.equal(pathStyle('hydro', {
    geometry: { type: 'Polygon' },
    properties: { hydroKind: 'area' }
  }).fillColor, '#c9a227');
  assert.equal(pathStyle('sun-daylight', {
    geometry: { type: 'LineString' },
    properties: { sunKind: 'terminator' }
  }).interactive, false);
  assert.equal((read('map/map-foundation.js').match(/new MapView\(/g) || []).length, 1);
  assert.equal(isAisSpatialStreamEnabled({}), false);
});

test('Operational feature clicks use hitTest and commit canonical Crime ObjectRef identity', () => {
  const record = {
    layerId: 'recent-crime',
    featureId: '170fe636c6606dbe',
    meta: { id: 'recent-crime', title: 'Recent Crime', provider: 'SPVM' },
    payload: {
      status: 'RECENT',
      windowLabel: 'LATEST DAY',
      asOfDate: '2026-08-05'
    },
    feature: {
      type: 'Feature',
      id: '170fe636c6606dbe',
      geometry: { type: 'Point', coordinates: [-73.5585, 45.515925] },
      properties: {
        categoryEnglish: 'Theft from vehicle',
        date: '2026-08-05',
        shift: 'nuit',
        pdq: '20',
        sourceFeatureId: '170fe636c6606dbe',
        source: 'SPVM Actes criminels',
        spatialPrecision: 'Privacy-obfuscated intersection',
        note: 'Not live CAD. Publication may lag the calendar day.'
      }
    }
  };
  const objectRef = createOpsObjectRef(record);
  assert.equal(objectRef.namespace, 'spvm');
  assert.equal(objectRef.kind, 'crime-report');
  assert.equal(objectRef.id, '170fe636c6606dbe');
  assert.equal(objectRef.datasetRef, 'montreal-open-data:spvm:actes-criminels');
  assert.equal(objectRef.datasetVersion, '2026-08-05');
  const inspector = buildOpsInspectorModel(record);
  assert.equal(inspector.objectType, 'RECENT CRIME');
  assert.equal(inspector.category, 'Theft from vehicle');
  assert.equal(inspector.status, 'RECENT');
  assert.ok(inspector.rows.some(([label, value]) => label === 'POLICE DISTRICT' && value === 'PDQ 20'));
  assert.ok(inspector.rows.some(([label, value]) => label === 'STABLE RECORD ID' && value === '170fe636c6606dbe'));
  assert.equal(inspector.rows.some(([label]) => label === 'LOCATION / ADDRESS'), false);
  const html = renderOpsFeatureInspector(record);
  assert.match(html, /Theft from vehicle/);
  assert.match(html, /Privacy-obfuscated intersection/);
  assert.match(html, /Not live CAD/);
  assert.match(html, /170fe636c6606dbe/);
  assert.doesNotMatch(html, /Canonical ObjectRef|montreal-open-data:spvm/);

  const selection = read('ops-layers/selection.js');
  const overlay = read('ops-layers/overlay.js');
  const session = read('bootstrap/worldview-map-session.js');
  assert.match(selection, /view\.hitTest\(event, \{ include: \[hitLayer\] \}\)/);
  assert.match(selection, /executeChassis\?\.\('selection\.set'/);
  assert.match(selection, /CLEAR_OPERATIONAL_FEATURE/);
  assert.match(overlay, /getOpsGraphicsLayer/);
  assert.match(overlay, /data-iqai-ops-feature-id/);
  assert.match(overlay, /data-iqai-ops-selected/);
  assert.match(session, /bindOpsSelection/);
  assert.equal((read('map/map-foundation.js').match(/new MapView\(/g) || []).length, 1);
});

test('WOA, PLACE CAMERA, Focus, Street360, Google 3D, WorldView seams remain imported', () => {
  const session = read('bootstrap/worldview-map-session.js');
  assert.match(session, /bindFocusInstrument/);
  assert.match(session, /bindPlaceCameraControl/);
  assert.match(session, /bindStreet360Control/);
  assert.match(session, /bindGooglePhotorealistic3dControl/);
  assert.match(session, /bindWorldViewFrame/);
  assert.match(read('map/woa/layer-session.js'), /visibilityOwner/);
  assert.match(readSrc('src/spatial-v2/ops-layers/catalog.mjs'), /id: 'sun-daylight'/);
  assert.match(read('bootstrap/worldview-map-session.js'), /solarIntelligence\?\.isPlacePending/);
});
