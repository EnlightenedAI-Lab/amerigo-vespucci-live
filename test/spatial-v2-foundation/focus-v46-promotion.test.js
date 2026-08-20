import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSpatialV2Chassis } from '../../public/spatial-v2/bootstrap/spatial-v2-bootstrap.js';
import { MIGRATION_STATE, objectRefKey } from '../../public/spatial-v2/foundation/contracts/index.js';
import { objectRefFromNrcanFeature, NRCAN_EXPECTED_FOOTPRINTS } from '../../public/spatial-v2/map/focus/nrcan-object-ref.js';
import { indexBuildings } from '../../public/spatial-v2/map/focus/objects.js';
import {
  CSV_COLUMNS,
  addToCollectedSet,
  collectedSetToCsv,
  createCollectedSet
} from '../../public/spatial-v2/map/focus/collected.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const V2 = path.join(ROOT, 'public', 'spatial-v2');
const PVM = Object.freeze({ lat: 45.50169, lng: -73.56832 });

function read(rel) {
  return fs.readFileSync(path.join(V2, rel), 'utf8');
}

function loadBuildings() {
  return JSON.parse(fs.readFileSync(path.join(V2, 'data/focus/nrcan-buildings.geojson'), 'utf8'));
}

test('NRCan Montréal clip remains the 571-building Focus V4.6 baseline', () => {
  const collection = loadBuildings();
  const indexed = indexBuildings(collection);
  assert.equal(collection.features.length, NRCAN_EXPECTED_FOOTPRINTS);
  assert.equal(indexed.count, NRCAN_EXPECTED_FOOTPRINTS);
  const hit = indexed.findAt(PVM.lat, PVM.lng, 10);
  assert.equal(hit?.relation, 'inside');
  const ref = objectRefFromNrcanFeature(hit.item.feature, { label: 'Place Ville Marie' });
  assert.equal(ref.schemaId, 'iqai.spatial.object-ref/1.0.0');
  assert.equal(ref.namespace, 'nrcan');
  assert.equal(ref.kind, 'building');
  assert.equal(ref.identityStability, 'DATASET_VERSIONED');
  assert.equal(ref.label, 'Place Ville Marie');
  assert.doesNotMatch(ref.schemaId, /iqai\.lab\.objectref/);
});

test('collected set rejects duplicates and CSV keeps the V4.6 columns', () => {
  const collection = loadBuildings();
  const indexed = indexBuildings(collection);
  const hit = indexed.findAt(PVM.lat, PVM.lng, 10);
  const ref = objectRefFromNrcanFeature(hit.item.feature);
  let set = createCollectedSet();
  const first = addToCollectedSet(set, ref, { name: 'Place Ville Marie', centroid: PVM });
  assert.equal(first.ok, true);
  set = first.set;
  const dup = addToCollectedSet(set, ref, { name: 'Place Ville Marie', centroid: PVM });
  assert.equal(dup.ok, false);
  assert.equal(dup.reason, 'duplicate');
  const csv = collectedSetToCsv(set);
  assert.deepEqual(csv.split('\n')[0].split(','), [...CSV_COLUMNS]);
  assert.match(csv, /nrcan:building:/);
});

test('selection.set writes WorldState ObjectRef; hover path cannot', async () => {
  let n = 0;
  const chassis = createSpatialV2Chassis({
    now: () => '2026-08-19T16:00:00.000Z',
    idFactory: () => `focus-${++n}`
  });
  assert.equal(chassis.capabilityRegistry.require('selection.set').migrationState, MIGRATION_STATE.MIGRATED);
  const collection = loadBuildings();
  const indexed = indexBuildings(collection);
  const a = objectRefFromNrcanFeature(indexed.findAt(PVM.lat, PVM.lng, 10).item.feature, { label: 'Place Ville Marie' });
  const hoverWorld = chassis.stateStore.getSnapshot();
  assert.equal(hoverWorld.selection.objectRefs.length, 0);
  assert.equal(hoverWorld.selection.primaryObjectRefId, null);
  const acquired = await chassis.executeChassis('selection.set', {
    objectRefs: [a],
    primaryObjectRefId: objectRefKey(a),
    sourceView: 'MAP',
    sourceAction: 'SELECT_FEATURE'
  });
  assert.equal(acquired.ok, true);
  const world = chassis.stateStore.getSnapshot();
  assert.equal(world.selection.objectRefs.length, 1);
  assert.equal(world.selection.objectRefs[0].id, a.id);
  assert.equal(world.selection.sourceAction, 'SELECT_FEATURE');
  assert.match(chassis.getViewModel().inspector.selection, /OBJECT ACQUIRED/);
  assert.match(chassis.getViewModel().inspector.selection, /Place Ville Marie|nrcan/);
  const instrument = read('map/focus/instrument.js');
  assert.match(instrument, /samplePointer/);
  assert.doesNotMatch(instrument, /samplePointer[\s\S]{0,400}executeChassis/);
  assert.match(instrument, /Only acquire writes WorldState\.selection/);
});

test('handoff replaces uncollected primary; collected members remain', async () => {
  let n = 0;
  const chassis = createSpatialV2Chassis({
    now: () => '2026-08-19T16:01:00.000Z',
    idFactory: () => `hand-${++n}`
  });
  const indexed = indexBuildings(loadBuildings());
  const pvm = objectRefFromNrcanFeature(indexed.findAt(PVM.lat, PVM.lng, 10).item.feature);
  const other = objectRefFromNrcanFeature(indexed.items.find((item) => item.feature !== indexed.findAt(PVM.lat, PVM.lng, 10).item.feature)?.feature
    || indexed.items[0].feature);
  assert.notEqual(other.id, pvm.id);
  await chassis.executeChassis('selection.set', {
    objectRefs: [pvm, other],
    primaryObjectRefId: objectRefKey(other),
    sourceView: 'MAP',
    sourceAction: 'SELECT_FEATURE'
  });
  const world = chassis.stateStore.getSnapshot();
  assert.equal(world.selection.objectRefs.length, 2);
  assert.equal(world.selection.objectRefs.some((ref) => ref.id === pvm.id), true);
  assert.equal(world.selection.primaryObjectRefId.includes(other.id), true);
});

test('Focus V4.6 promotion stays on one MapView and production ObjectRef', () => {
  const session = read('bootstrap/worldview-map-session.js');
  const footprints = read('map/focus/footprints.js');
  const instrument = read('map/focus/instrument.js');
  const stage = read('hosts/view-host.js');
  const inspector = read('shell/ContextInspector.js');
  const drop = read('shell/DropPinControl.js');
  assert.match(session, /bindFocusInstrument/);
  assert.match(session, /hasAcquiredObject/);
  assert.match(session, /data-iqai-woa/);
  assert.match(instrument, /async function activate/);
  assert.match(instrument, /function deactivate/);
  assert.doesNotMatch(instrument, /void start\(\)/);
  assert.equal((read('map/map-foundation.js').match(/new MapView\(/g) || []).length, 1);
  assert.doesNotMatch(instrument, /new MapView\(/);
  assert.doesNotMatch(footprints, /new GraphicsLayer|layers\/GraphicsLayer/);
  assert.match(footprints, /iqai-v2-focus-overlay/);
  assert.match(footprints, /#3DFF74/);
  assert.match(footprints, /#FF0000/);
  assert.match(stage, />FOCUS</);
  assert.match(stage, /data-iqai-drop-pin/);
  assert.match(inspector, /data-iqai-add-set/);
  assert.match(inspector, /data-iqai-export-csv/);
  assert.match(drop, /hasAcquiredObject/);
  assert.doesNotMatch(instrument, /iqai\.lab\.objectref/);
  assert.doesNotMatch(read('map/focus/nrcan-object-ref.js'), /iqai\.lab\.objectref/);
});
