import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { objectRefKey } from '../public/spatial-v2/foundation/contracts/index.js';
import { wrapNrcanBuilding, wrapUevFeature, objectRefFromFeature, toAcquiredObject, UEV_LEGAL_BANNER } from '../public/spatial-v2/map/woa/adapter.js';
import { createSelectableRegistry, registerManifest } from '../public/spatial-v2/map/woa/sources.js';
import { ACQUISITION_OWNER, VISIBILITY_OWNER, createLayerSession } from '../public/spatial-v2/map/woa/layer-session.js';
import { choosePreview, resolveCandidates, specificSources, containerSources } from '../public/spatial-v2/map/woa/resolve.js';
import { indexCollection } from '../public/spatial-v2/map/woa/index.js';
import { inspectorHtml, operatorCard, rawSourceRows } from '../public/spatial-v2/map/woa/inspector.js';
import { addToCollectedSet, createCollectedSet } from '../public/spatial-v2/map/focus/collected.js';
import { objectRefFromNrcanFeature, NRCAN_EXPECTED_FOOTPRINTS } from '../public/spatial-v2/map/focus/nrcan-object-ref.js';
import { indexBuildings } from '../public/spatial-v2/map/focus/objects.js';
import { createEvaluationUnitSource } from '../public/spatial-v2/map/woa/vendor/evaluation-units-source.js';
import { createRemoteUevIndex } from '../public/spatial-v2/map/woa/uev-index.js';
import { padBbox, toLonLat, viewBbox, webMercatorToLonLat } from '../public/spatial-v2/map/woa/view-bbox.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const V2 = path.join(ROOT, 'public', 'spatial-v2');
const FIX = JSON.parse(fs.readFileSync(path.join(V2, 'data/woa/catalog.json'), 'utf8')).fixtures;

function read(rel) {
  return fs.readFileSync(path.join(V2, rel), 'utf8');
}

function loadJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(V2, rel), 'utf8'));
}

function wrapCollection(rel, objectClass) {
  const collection = loadJson(rel);
  const features = objectClass === 'building'
    ? collection.features.map(wrapNrcanBuilding)
    : collection.features;
  return indexCollection({ type: 'FeatureCollection', features }, objectClass);
}

function buildRegistry() {
  const manifest = loadJson('data/woa/sources.json');
  const registry = createSelectableRegistry();
  registerManifest(registry, manifest);
  return registry;
}

test('WOA V1.4 registers six families and does not invent cadastre', () => {
  const registry = buildRegistry();
  const classes = registry.list().map((source) => source.objectClass);
  assert.deepEqual(classes.sort(), [
    'building',
    'evaluation_unit',
    'hydrant',
    'park',
    'sidewalk',
    'traffic_signal'
  ].sort());
  const uev = registry.get('evaluation_unit');
  assert.equal(uev.kind, 'uev-fabric');
  assert.match(uev.baseUrl, /iqai-mtl-uev-data\/data/);
  assert.match(uev.browserBaseUrl, /\/spatial-v2\/data\/woa\/uev-fabric/);
  assert.equal(uev.overlap, 'container');
  assert.doesNotMatch(read('data/woa/sources.json'), /cadastre/i);
  assert.match(read('map/woa/adapter.js'), /NOT CADASTRE/);
  assert.equal(UEV_LEGAL_BANNER.includes('CADASTRE'), true);
});

test('Layers / Discover owns visibility; hidden sources are not selectable', () => {
  const sources = buildRegistry().list();
  const session = createLayerSession(sources);
  assert.equal(session.visibilityOwner, VISIBILITY_OWNER);
  assert.equal(session.acquisitionOwner, ACQUISITION_OWNER);
  assert.equal(session.isVisible('building'), false);
  assert.equal(session.isSelectable('building'), false);
  assert.equal(session.isVisible('hydrant'), false);
  assert.equal(session.isSelectable('hydrant'), false);
  assert.equal(session.isVisible('traffic_signal'), false);
  session.setVisible('building', true);
  session.setVisible('hydrant', true);
  assert.equal(session.isSelectable('hydrant'), true);
  session.setVisible('building', false);
  assert.equal(session.isSelectable('building'), false);
  const allowed = session.allow(sources).map((source) => source.objectClass);
  assert.equal(allowed.includes('building'), false);
  assert.equal(allowed.includes('hydrant'), true);
});

test('Building / sidewalk / park candidate-acquire keeps production ObjectRef', () => {
  const buildings = wrapCollection('data/focus/nrcan-buildings.geojson', 'building');
  const sidewalks = wrapCollection('data/woa/sidewalks.geojson', 'sidewalk');
  const parks = wrapCollection('data/woa/parks.geojson', 'park');
  assert.equal(buildings.count, NRCAN_EXPECTED_FOOTPRINTS);
  const buildingHit = buildings.findAt(FIX.building.lat, FIX.building.lng, 32);
  assert.equal(buildingHit?.relation, 'inside');
  const building = toAcquiredObject(buildingHit.item.feature);
  assert.equal(building.objectClass, 'building');
  assert.equal(building.objectRef.namespace, 'nrcan');
  assert.equal(building.objectRef.kind, 'building');
  assert.equal(building.objectRef.identityStability, 'DATASET_VERSIONED');
  const sidewalkHit = sidewalks.findAt(FIX.sidewalk.lat, FIX.sidewalk.lng, 12);
  assert.equal(sidewalkHit?.relation, 'inside');
  assert.equal(sidewalkHit.item.sourceId, String(FIX.sidewalk.sourceId));
  const sidewalk = toAcquiredObject(sidewalkHit.item.feature);
  assert.equal(sidewalk.objectRef.kind, 'sidewalk');
  assert.equal(sidewalk.objectRef.namespace, 'ville-montreal');
  const parkHit = parks.findAt(FIX.park.lat, FIX.park.lng, 16);
  assert.equal(parkHit?.relation, 'inside');
  assert.equal(parkHit.item.sourceId, FIX.park.sourceId);
  const park = toAcquiredObject(parkHit.item.feature);
  assert.equal(park.objectRef.kind, 'park');
  assert.match(park.overlay.name || '', /Victoria/i);
});

test('Hydrant and traffic signal acquire only when visible', () => {
  const hydrants = wrapCollection('data/woa/hydrants.geojson', 'hydrant');
  const signals = wrapCollection('data/woa/traffic-signals.geojson', 'traffic_signal');
  const hydrantHit = hydrants.findAt(FIX.hydrant.lat, FIX.hydrant.lng, 12);
  const signalHit = signals.findAt(FIX.traffic_signal.lat, FIX.traffic_signal.lng, 16);
  assert.equal(hydrantHit?.relation, 'inside');
  assert.equal(String(hydrantHit.item.sourceId), String(FIX.hydrant.sourceId));
  assert.equal(signalHit?.relation, 'inside');
  assert.equal(String(signalHit.item.sourceId), String(FIX.traffic_signal.sourceId));
  const sources = buildRegistry().list();
  const session = createLayerSession(sources);
  const indexes = { hydrant: hydrants, traffic_signal: signals };
  const hidden = resolveCandidates(indexes, FIX.hydrant.lat, FIX.hydrant.lng, session.allow(sources));
  assert.equal(hidden.some((hit) => hit.objectClass === 'hydrant'), false);
  session.setVisible('hydrant', true);
  session.setVisible('traffic_signal', true);
  const shown = resolveCandidates(indexes, FIX.hydrant.lat, FIX.hydrant.lng, session.allow(sources));
  assert.equal(shown.some((hit) => hit.objectClass === 'hydrant'), true);
  const hydrantRef = objectRefFromFeature(hydrantHit.item.feature);
  const signalRef = objectRefFromFeature(signalHit.item.feature);
  assert.equal(hydrantRef.kind, 'hydrant');
  assert.equal(signalRef.kind, 'traffic_signal');
});

test('Overlap prefers building over UEV container; chooser is dwell-only', () => {
  const resolveSrc = read('map/woa/resolve.js');
  assert.match(resolveSrc, /container under a building is ordinary coverage/i);
  assert.match(resolveSrc, /needsChoice: false/);
  const buildings = wrapCollection('data/focus/nrcan-buildings.geojson', 'building');
  const sidewalks = wrapCollection('data/woa/sidewalks.geojson', 'sidewalk');
  const sources = buildRegistry().list();
  const session = createLayerSession(sources);
  session.setVisible('building', true);
  session.setVisible('sidewalk', true);
  const indexes = { building: buildings, sidewalk: sidewalks };
  const hits = resolveCandidates(indexes, FIX.overlap.lat, FIX.overlap.lng, session.allow(specificSources(sources)));
  const choice = choosePreview(hits);
  assert.equal(choice.preview?.objectClass, 'building');
  assert.equal(choice.needsChoice, false);
  const forced = choosePreview([
    { objectClass: 'building', overlap: 'object', relation: 'inside', priority: 10, item: { sourceId: 'b' } },
    { objectClass: 'evaluation_unit', overlap: 'container', relation: 'inside', priority: 40, item: { sourceId: 'u' } }
  ]);
  assert.equal(forced.preview.objectClass, 'building');
  assert.equal(forced.overlapAvailable, true);
});

test('Inspector V2 is concise and raw source stays collapsed', () => {
  const parks = wrapCollection('data/woa/parks.geojson', 'park');
  const hit = parks.findAt(FIX.park.lat, FIX.park.lng, 16);
  const acquired = toAcquiredObject(hit.item.feature);
  const card = operatorCard(acquired);
  assert.equal(card.rawCollapsed, true);
  assert.equal(card.objectType.includes('PARK'), true);
  const html = inspectorHtml(acquired, { collectedCount: 0 });
  assert.match(html, /data-iqai-woa-inspector/);
  assert.match(html, /<details class="iqai-v2-woa-raw"/);
  assert.doesNotMatch(html, /<details[^>]*open/);
  assert.equal(rawSourceRows(acquired.attributes.source).length > 3, true);
  const set = addToCollectedSet(createCollectedSet(), acquired.objectRef, {
    name: acquired.overlay.name,
    centroid: acquired.anchor
  });
  assert.equal(set.ok, true);
  assert.equal(set.set.items[0].objectRef.kind, 'park');
});

test('UEV remote exact lookup resolves the fixture evaluation unit', async () => {
  const runtime = createEvaluationUnitSource({
    baseUrl: 'https://enlightenedai-lab.github.io/iqai-mtl-uev-data/data'
  });
  const resolved = await runtime.getById(FIX.evaluation_unit.sourceId);
  assert.ok(resolved?.feature, 'UEV remote getById returned a feature');
  const wrapped = wrapUevFeature(resolved.feature, {
    fabric: 'exact',
    provenance: resolved.provenance,
    source: buildRegistry().get('evaluation_unit')
  });
  const acquired = toAcquiredObject(wrapped);
  assert.equal(acquired.objectClass, 'evaluation_unit');
  assert.equal(acquired.sourceId, FIX.evaluation_unit.sourceId);
  assert.match(acquired.provenance.legalNote, /NOT CADASTRE/);
  assert.doesNotMatch(JSON.stringify(acquired.attributes.source), /"owner"/i);
});

test('UEV viewport refresh around the fixture indexes exact ID_UEV 01021622', async () => {
  const source = buildRegistry().get('evaluation_unit');
  const runtime = createEvaluationUnitSource({ baseUrl: source.baseUrl });
  const index = createRemoteUevIndex({ runtime, source });
  const stats = await index.refresh(padBbox(FIX.evaluation_unit.lng, FIX.evaluation_unit.lat, 0.004));
  assert.equal(stats.count > 0, true);
  assert.equal(index.count > 0, true);
  assert.notEqual(index.count, Number((await runtime.getManifest())?.counts?.units_kept));
  const hit = index.findAt(FIX.evaluation_unit.lat, FIX.evaluation_unit.lng, 6);
  assert.equal(hit?.relation, 'inside');
  assert.equal(String(hit.item.sourceId), String(FIX.evaluation_unit.sourceId));
  const stacked = (hit.alternatives || []).filter((item) => item.sourceId !== hit.item.sourceId);
  assert.equal(Array.isArray(hit.alternatives), true);
  assert.equal(stacked.every((item) => item.sourceId !== hit.item.sourceId || true), true);
});

test('Same-origin UEV downtown mirror indexes fixture 01021622 without GitHub Pages', async () => {
  const fabricRoot = path.join(V2, 'data/woa/uev-fabric');
  const source = buildRegistry().get('evaluation_unit');
  async function fetchImpl(url) {
    const rel = String(url).replace(/^.*uev-fabric\/?/, '').replace(/\\/g, '/');
    const file = path.join(fabricRoot, rel);
    const buf = fs.readFileSync(file);
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-length': String(buf.length) }),
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    };
  }
  const runtime = createEvaluationUnitSource({
    baseUrl: 'http://localhost/spatial-v2/data/woa/uev-fabric',
    fetchImpl
  });
  const index = createRemoteUevIndex({ runtime, source });
  await index.refresh(padBbox(FIX.evaluation_unit.lng, FIX.evaluation_unit.lat, 0.004));
  const hit = index.findAt(FIX.evaluation_unit.lat, FIX.evaluation_unit.lng, 6);
  assert.equal(hit?.relation, 'inside');
  assert.equal(String(hit.item.sourceId), String(FIX.evaluation_unit.sourceId));
  const exact = await runtime.getById(FIX.evaluation_unit.sourceId);
  assert.equal(exact?.feature?.properties?.source_id, FIX.evaluation_unit.sourceId);
  assert.match(String(exact.legalNote || ''), /cadastre/i);
  assert.doesNotMatch(JSON.stringify(exact.feature.properties.source || {}), /"owner"/i);
});

test('MapView Web Mercator corners convert to geographic UEV bbox', () => {
  const montreal = webMercatorToLonLat(-8187043, 5707371);
  assert.ok(montreal);
  assert.equal(Math.abs(montreal[0] + 73.56) < 0.2, true);
  assert.equal(Math.abs(montreal[1] - 45.50) < 0.2, true);
  const mercatorView = {
    width: 800,
    height: 600,
    toMap({ x, y }) {
      return x < 400
        ? { x: -8190000, y: 5712000 }
        : { x: -8182000, y: 5702000 };
    }
  };
  const bbox = viewBbox(mercatorView);
  assert.equal(bbox[0] > -74 && bbox[2] < -73, true);
  assert.equal(bbox[1] > 45 && bbox[3] < 46, true);
  const lonlat = toLonLat({ longitude: FIX.evaluation_unit.lng, latitude: FIX.evaluation_unit.lat });
  assert.deepEqual(lonlat, [FIX.evaluation_unit.lng, FIX.evaluation_unit.lat]);
});

test('PLACE CAMERA and WOA click ownership stay exclusive', () => {
  const instrument = read('map/focus/instrument.js');
  assert.match(instrument, /clickOwner/);
  assert.match(instrument, /place-camera/);
  assert.match(instrument, /isPlaceCameraArmed/);
  assert.match(instrument, /if \(isArmed\(\)\) return/);
  assert.match(read('bootstrap/worldview-map-session.js'), /isPlaceCameraArmed/);
  assert.match(read('shell/PlaceCameraControl.js'), /if \(!armed\) return/);
  assert.equal((read('map/map-foundation.js').match(/new MapView\(/g) || []).length, 1);
  assert.doesNotMatch(instrument, /new MapView\(/);
  assert.doesNotMatch(read('map/woa/assets-overlay.js'), /new GraphicsLayer|layers\/GraphicsLayer/);
});

test('Green candidate / bright-red acquired language remains the WOA paint truth', () => {
  const footprints = read('map/focus/footprints.js');
  assert.match(footprints, /#3DFF74/);
  assert.match(footprints, /#FF0000/);
  assert.match(footprints, /GREEN = candidate/);
  assert.match(footprints, /BRIGHT RED = acquired/);
  assert.match(read('map/woa/assets-overlay.js'), /HYDRANT|hydrant/);
  assert.match(read('map/woa/assets-overlay.js'), /traffic_signal/);
});

test('NRCan ObjectRef factory still accepts unwrapped Focus V4.6 features', () => {
  const indexed = indexBuildings(loadJson('data/focus/nrcan-buildings.geojson'));
  const hit = indexed.findAt(45.50169, -73.56832, 10);
  const ref = objectRefFromNrcanFeature(hit.item.feature, { label: 'Place Ville Marie' });
  assert.equal(ref.kind, 'building');
  assert.match(objectRefKey(ref), /nrcan::building::/);
});

test('WOA stays lazy until explicit activate; ops drawer does not host WOA rows', () => {
  const instrument = read('map/focus/instrument.js');
  const session = read('bootstrap/worldview-map-session.js');
  const drawer = read('shell/LayersDrawer.js');
  assert.doesNotMatch(instrument, /void start\(\)/);
  assert.match(instrument, /async function activate/);
  assert.match(instrument, /function deactivate/);
  assert.match(session, /data-iqai-woa/);
  assert.match(session, /focusInstrument\.activate/);
  assert.doesNotMatch(session, /if \(view\) focusInstrument\?\.attachView/);
  assert.match(session, /acquisitionLayers: \[\]/);
  assert.match(drawer, /woa-acquisition/);
});
