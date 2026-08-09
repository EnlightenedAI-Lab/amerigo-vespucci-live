import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  normalizeAdsbAircraftRow,
  normalizeAdsbAircraftPayload,
  classifyAircraft,
  normalizeHeadingDegrees,
  getAdsbStableId
} from '../src/spatial/adsb-lol-normalize.js';
import {
  fetchLiveAircraft,
  __resetAdsbCacheForTests,
  getAdsbAdapterInterface
} from '../src/spatial/adsb-lol-client.js';
import { planLiveObjectEdits } from '../src/spatial/live-object-engine.js';
import {
  stableAircraftObjectId,
  prepareAircraftEditBundle,
  __resetAircraftTrackingForTests
} from '../public/spatial/aircraft-live.js';
import { matchAircraftLiveIntent } from '../src/spatial/aircraft-live-intent.js';
import { AIRCRAFT_LAYER_TITLE } from '../src/spatial/adsb-lol-config.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(
  readFileSync(join(root, 'test/fixtures/adsb-lol-montreal.json'), 'utf8')
);

test('classifyAircraft maps ICAO categories deterministically', () => {
  assert.equal(classifyAircraft({ category: 'A7' }).aircraftClass, 'HELICOPTER');
  assert.equal(classifyAircraft({ category: 'A1' }).aircraftClass, 'LIGHT_AIRCRAFT');
  assert.equal(classifyAircraft({ category: 'A5' }).aircraftClass, 'AIRLINER');
  assert.equal(classifyAircraft({ category: 'A2', t: 'C56X' }).aircraftClass, 'BUSINESS_JET');
  assert.equal(classifyAircraft({ category: 'A3' }).aircraftClass, 'FIXED_WING');
});

test('normalizeAdsbAircraftRow rejects stale and invalid coordinates', () => {
  assert.equal(normalizeAdsbAircraftRow({ hex: 'abc', lat: 'bad', lon: -73 }), null);
  assert.equal(normalizeAdsbAircraftRow({
    hex: 'abc',
    lat: 45,
    lon: -73,
    seen: 999,
    seen_pos: 999
  }), null);
});

test('normalizeAdsbAircraftPayload normalizes fixture aircraft', () => {
  const result = normalizeAdsbAircraftPayload(fixture, {
    receivedAt: '2026-08-08T12:00:00.000Z'
  });
  assert.ok(result.objects.length > 0);
  const first = result.objects[0];
  assert.ok(first.liveObjectId.startsWith('adsb:'));
  assert.ok(Number.isFinite(first.latitude));
  assert.equal(getAdsbStableId(first), first.liveObjectId);
});

test('normalizeHeadingDegrees wraps bearing', () => {
  assert.equal(normalizeHeadingDegrees(271.74), 271.74);
  assert.equal(normalizeHeadingDegrees(-10), 350);
});

test('planLiveObjectEdits diffs add update remove', () => {
  const known = new Set(['a', 'b']);
  const objects = [{ liveObjectId: 'b' }, { liveObjectId: 'c' }];
  const plan = planLiveObjectEdits(objects, known);
  assert.deepEqual(plan.toAdd, ['c']);
  assert.deepEqual(plan.toUpdate, ['b']);
  assert.deepEqual(plan.toDelete, ['a']);
});

test('fetchLiveAircraft uses fixture without live ADSB calls', async () => {
  __resetAdsbCacheForTests();
  const fetchFn = async () => ({
    ok: true,
    json: async () => fixture
  });
  const result = await fetchLiveAircraft({ fetchFn, force: true });
  assert.equal(result.ok, true);
  assert.ok(result.aircraftCount > 0);
  assert.equal(result.status, 'CURRENT');
});

test('fetchLiveAircraft fails soft with stale snapshot', async () => {
  __resetAdsbCacheForTests();
  const fetchFn = async () => ({
    ok: true,
    json: async () => fixture
  });
  await fetchLiveAircraft({ fetchFn, force: true });
  const stale = await fetchLiveAircraft({
    fetchFn: async () => ({ ok: false }),
    force: true
  });
  assert.equal(stale.ok, true);
  assert.equal(stale.status, 'STALE');
  assert.ok(stale.aircraftCount > 0);
});

test('prepareAircraftEditBundle applies add update remove', async () => {
  __resetAircraftTrackingForTests(new Set(['adsb:old']));
  const objects = normalizeAdsbAircraftPayload(fixture, {
    receivedAt: '2026-08-08T12:00:00.000Z'
  }).objects.slice(0, 3);

  const store = new Map();
  store.set(stableAircraftObjectId('adsb:old', 1), {
    attributes: { OBJECTID: stableAircraftObjectId('adsb:old', 1), liveObjectId: 'adsb:old' },
    geometry: null
  });

  const layer = {
    queryFeatures: async () => ({ features: [...store.values()] }),
    applyEdits: async ({ addFeatures = [], updateFeatures = [], deleteFeatures = [] }) => {
      for (const graphic of addFeatures) store.set(graphic.attributes.OBJECTID, graphic);
      for (const graphic of updateFeatures) store.set(graphic.attributes.OBJECTID, graphic);
      for (const del of deleteFeatures) store.delete(del.objectId);
      return {
        addFeatureResults: addFeatures.map((g) => ({ objectId: g.attributes.OBJECTID })),
        updateFeatureResults: updateFeatures.map((g) => ({ objectId: g.attributes.OBJECTID })),
        deleteFeatureResults: deleteFeatures.map((d) => ({ objectId: d.objectId }))
      };
    },
    queryFeatureCount: async () => store.size
  };

  const bundle = await prepareAircraftEditBundle(layer, objects, new Set(['adsb:old']), {
    Graphic: function Graphic(props) { return props; },
    Point: function Point(props) { Object.assign(this, props); }
  });

  assert.ok(bundle.addFeatures.length >= 1);
  assert.deepEqual(bundle.deleteFeatures, [{ objectId: stableAircraftObjectId('adsb:old', 1) }]);
});

test('matchAircraftLiveIntent recognizes Show live aircraft', () => {
  assert.deepEqual(matchAircraftLiveIntent('Show live aircraft'), {
    phrase: AIRCRAFT_LAYER_TITLE,
    action: 'SHOW_LAYER'
  });
});

test('adapter interface documents fetch normalize getStableId', () => {
  const iface = getAdsbAdapterInterface();
  assert.equal(iface.sourceId, 'adsb_lol');
  assert.ok(iface.fetchSnapshot);
  assert.ok(iface.normalize);
  assert.ok(iface.getStableId);
});
