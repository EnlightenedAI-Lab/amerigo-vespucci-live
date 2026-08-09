import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  planStmVehicleEdits,
  prepareStmVehicleEditBundle,
  applyVehicleDataToGraphic,
  buildStaleStatus,
  captureFeedMeta,
  stableObjectId,
  __resetStmLiveBusTrackingForTests
} from '../public/spatial/stm-live-buses.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function mockPoint(attrs = {}) {
  return function Point(props) {
    Object.assign(this, props);
    this.type = 'point';
  };
}

function mockGraphic(initial = {}) {
  return {
    geometry: initial.geometry || null,
    attributes: { ...initial.attributes }
  };
}

function mockLayer(store = new Map()) {
  return {
    loaded: true,
    queryFeatures: async () => ({
      features: [...store.values()]
    }),
    applyEdits: async ({ addFeatures = [], updateFeatures = [], deleteFeatures = [] }) => {
      for (const graphic of addFeatures) {
        store.set(graphic.attributes.OBJECTID, graphic);
      }
      for (const graphic of updateFeatures) {
        store.set(graphic.attributes.OBJECTID, graphic);
      }
      for (const del of deleteFeatures) {
        store.delete(del.objectId);
      }
      return {
        addFeatureResults: addFeatures.map((g) => ({ objectId: g.attributes.OBJECTID })),
        updateFeatureResults: updateFeatures.map((g) => ({ objectId: g.attributes.OBJECTID })),
        deleteFeatureResults: deleteFeatures.map((d) => ({ objectId: d.objectId }))
      };
    },
    queryFeatureCount: async () => store.size
  };
}

const modules = {
  Graphic: function Graphic(props) {
    return props;
  },
  Point: mockPoint()
};

test('planStmVehicleEdits adds all vehicles on initial refresh', () => {
  const vehicles = [
    { vehicleId: '40065', longitude: -73.56, latitude: 45.5 },
    { vehicleId: '40066', longitude: -73.57, latitude: 45.48 }
  ];
  const plan = planStmVehicleEdits(vehicles, new Set());
  assert.deepEqual(plan.toAdd, ['40065', '40066']);
  assert.deepEqual(plan.toUpdate, []);
  assert.deepEqual(plan.toDelete, []);
  assert.equal(plan.currentIds.size, 2);
});

test('planStmVehicleEdits updates existing and adds new on second refresh', () => {
  const known = new Set(['40065']);
  const vehicles = [
    { vehicleId: '40065', longitude: -73.561, latitude: 45.501 },
    { vehicleId: '40067', longitude: -73.55, latitude: 45.49 }
  ];
  const plan = planStmVehicleEdits(vehicles, known);
  assert.deepEqual(plan.toAdd, ['40067']);
  assert.deepEqual(plan.toUpdate, ['40065']);
  assert.deepEqual(plan.toDelete, []);
});

test('planStmVehicleEdits deletes stale vehicles', () => {
  const known = new Set(['40065', '40066']);
  const vehicles = [{ vehicleId: '40065', longitude: -73.56, latitude: 45.5 }];
  const plan = planStmVehicleEdits(vehicles, known);
  assert.deepEqual(plan.toAdd, []);
  assert.deepEqual(plan.toUpdate, ['40065']);
  assert.deepEqual(plan.toDelete, ['40066']);
});

test('planStmVehicleEdits ignores duplicate vehicle IDs in one feed', () => {
  const vehicles = [
    { vehicleId: '40065', longitude: -73.56, latitude: 45.5 },
    { vehicleId: '40065', longitude: -73.57, latitude: 45.48 }
  ];
  const plan = planStmVehicleEdits(vehicles, new Set());
  assert.deepEqual(plan.toAdd, ['40065']);
  assert.equal(plan.currentIds.size, 1);
});

test('stm-live-buses uses applyEdits not post-load source mutation', () => {
  const src = readFileSync(join(root, 'public', 'spatial', 'stm-live-buses.js'), 'utf8');
  assert.match(src, /applyEdits/);
  assert.match(src, /queryFeatures/);
  assert.doesNotMatch(src, /source\.removeAll/);
  assert.doesNotMatch(src, /source\.addMany/);
  assert.doesNotMatch(src, /buildVehicleGraphic\(vehicle, objectId, Graphic, Point\);\s*updateFeatures\.push/);
});

test('initial feed adds features via applyEdits', async () => {
  __resetStmLiveBusTrackingForTests();
  const store = new Map();
  const layer = mockLayer(store);
  const payload = {
    vehicleCount: 2,
    retrievedAt: '2026-08-08T12:00:00.000Z',
    feedTimestampIso: '2026-08-08T11:59:50.000Z',
    vehicles: [
      { vehicleId: '40065', routeId: '57', longitude: -73.56, latitude: 45.5, timestamp: 100 },
      { vehicleId: '40066', routeId: '36', longitude: -73.57, latitude: 45.48, timestamp: 101 }
    ]
  };
  const bundle = await prepareStmVehicleEditBundle(layer, payload, new Set(), modules);
  assert.equal(bundle.addFeatures.length, 2);
  assert.equal(bundle.updateFeatures.length, 0);
  assert.equal(bundle.deleteFeatures.length, 0);
  const editResult = await layer.applyEdits(bundle);
  assert.equal(editResult.addFeatureResults.length, 2);
  assert.equal(store.size, 2);
});

test('second feed queries existing features and updates queried graphics', async () => {
  __resetStmLiveBusTrackingForTests(new Set(['40065']));
  const store = new Map();
  const existing = mockGraphic({
    attributes: { OBJECTID: 40065, vehicleId: '40065', routeId: '57' },
    geometry: { longitude: -73.56, latitude: 45.5 }
  });
  store.set(40065, existing);
  const layer = mockLayer(store);
  const payload = {
    vehicleCount: 1,
    retrievedAt: '2026-08-08T12:00:20.000Z',
    feedTimestampIso: '2026-08-08T12:00:10.000Z',
    vehicles: [
      { vehicleId: '40065', routeId: '57', longitude: -73.561, latitude: 45.501, timestamp: 200 }
    ]
  };
  const bundle = await prepareStmVehicleEditBundle(layer, payload, new Set(['40065']), modules);
  assert.equal(bundle.queriedCount, 1);
  assert.equal(bundle.addFeatures.length, 0);
  assert.equal(bundle.updateFeatures.length, 1);
  assert.equal(bundle.updateFeatures[0], existing);
  assert.equal(bundle.updateFeatures[0].geometry.longitude, -73.561);
  assert.equal(bundle.updateFeatures[0].geometry.latitude, 45.501);
  assert.equal(bundle.updateFeatures[0].attributes.vehicleTimestamp, 200);
  const editResult = await layer.applyEdits(bundle);
  assert.equal(editResult.updateFeatureResults[0].objectId, 40065);
  assert.equal(store.get(40065).geometry.longitude, -73.561);
});

test('second feed adds new buses and deletes missing buses', async () => {
  __resetStmLiveBusTrackingForTests(new Set(['40065', '40066']));
  const store = new Map();
  store.set(40065, mockGraphic({ attributes: { OBJECTID: 40065, vehicleId: '40065' } }));
  store.set(40066, mockGraphic({ attributes: { OBJECTID: 40066, vehicleId: '40066' } }));
  const layer = mockLayer(store);
  const payload = {
    vehicles: [
      { vehicleId: '40065', longitude: -73.56, latitude: 45.5, timestamp: 1 },
      { vehicleId: '40067', longitude: -73.55, latitude: 45.49, timestamp: 2 }
    ]
  };
  const bundle = await prepareStmVehicleEditBundle(layer, payload, new Set(['40065', '40066']), modules);
  assert.equal(bundle.addFeatures.length, 1);
  assert.equal(bundle.addFeatures[0].attributes.vehicleId, '40067');
  assert.equal(bundle.updateFeatures.length, 1);
  assert.equal(bundle.deleteFeatures.length, 1);
  assert.equal(bundle.deleteFeatures[0].objectId, 40066);
  await layer.applyEdits(bundle);
  assert.equal(store.has(40066), false);
  assert.equal(store.has(40067), true);
});

test('stable OBJECTIDs preserved across add and update', () => {
  const id = stableObjectId('40065', 1);
  assert.equal(id, 40065);
  assert.equal(stableObjectId('40065', 999), 40065);
  const graphic = mockGraphic({ attributes: { OBJECTID: 40065, vehicleId: '40065' } });
  applyVehicleDataToGraphic(
    graphic,
    { vehicleId: '40065', longitude: -73.56, latitude: 45.5, timestamp: 5 },
    40065,
    mockPoint()
  );
  assert.equal(graphic.attributes.OBJECTID, 40065);
});

test('buildStaleStatus preserves last known timestamps', () => {
  const meta = captureFeedMeta({
    retrievedAt: '2026-08-08T12:00:00.000Z',
    feedTimestampIso: '2026-08-08T11:59:50.000Z',
    vehicleCount: 369
  });
  const stale = buildStaleStatus(meta, 'STM applyEdits returned errors', 369);
  assert.equal(stale.stale, true);
  assert.equal(stale.retrievedAt, '2026-08-08T12:00:00.000Z');
  assert.equal(stale.feedTimestampIso, '2026-08-08T11:59:50.000Z');
  assert.equal(stale.vehicleCount, 369);
  assert.match(stale.error, /applyEdits/);
});

test('only one STM layer id in module', () => {
  const src = readFileSync(join(root, 'public', 'spatial', 'stm-live-buses.js'), 'utf8');
  const matches = src.match(/id:\s*STM_LAYER_ID|id:\s*'stm-live-buses'/g) || [];
  assert.equal(matches.length, 1);
});
