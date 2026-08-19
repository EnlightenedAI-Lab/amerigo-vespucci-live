import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  mergeAisStreamMessage,
  mergeAisPositionMessage,
  mergeAisStaticMessage,
  normalizeVesselState,
  normalizeVesselSnapshot,
  classifyVesselShipType,
  resolveVesselHeading,
  getAisStableId
} from '../src/spatial/aisstream-normalize.js';
import {
  fetchLiveVessels,
  __resetAisVesselCacheForTests,
  __ingestAisMessagesForTests,
  getAisAdapterInterface
} from '../src/spatial/aisstream-client.js';
import { planLiveObjectEdits } from '../src/spatial/live-object-engine.js';
import {
  stableVesselObjectId,
  prepareVesselEditBundle,
  __resetVesselTrackingForTests
} from '../public/spatial/vessels-live.js';
import { matchVesselsLiveIntent } from '../src/spatial/vessels-live-intent.js';
import { VESSELS_LAYER_TITLE, isAisSpatialStreamEnabled } from '../src/spatial/aisstream-config.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(
  readFileSync(join(root, 'test/fixtures/aisstream-montreal.json'), 'utf8')
);

test('classifyVesselShipType maps AIS codes deterministically', () => {
  assert.equal(classifyVesselShipType(70).vesselClass, 'CARGO');
  assert.equal(classifyVesselShipType(80).vesselClass, 'TANKER');
  assert.equal(classifyVesselShipType(60).vesselClass, 'FERRY');
  assert.equal(classifyVesselShipType(52).vesselClass, 'TUG');
  assert.equal(classifyVesselShipType(30).vesselClass, 'FISHING');
  assert.equal(classifyVesselShipType(36).vesselClass, 'PLEASURE');
  assert.equal(classifyVesselShipType(51).vesselClass, 'SEARCH_AND_RESCUE');
  assert.equal(classifyVesselShipType(40).vesselClass, 'HIGH_SPEED_CRAFT');
  assert.equal(classifyVesselShipType(null).vesselClass, 'UNKNOWN');
});

test('mergeAisStreamMessage fuses position and static by MMSI', () => {
  let state = {};
  for (const message of fixture) {
    state = mergeAisStreamMessage(message, state);
  }
  assert.equal(state.mmsi, 316023456);
  assert.equal(state.vesselName, 'ST LAWRENCE TUG');
  assert.equal(state.callsign, 'CFZZ9999');
  assert.equal(state.vesselClass, 'TUG');
  assert.equal(state.navigationStatusLabel, 'Moored');
});

test('normalizeVesselState rejects invalid coordinates', () => {
  const bad = normalizeVesselState({
    mmsi: 1,
    latitude: 200,
    longitude: 0,
    positionObservedAt: new Date().toISOString()
  });
  assert.equal(bad, null);
});

test('resolveVesselHeading prefers true heading then course', () => {
  assert.equal(resolveVesselHeading(90, 180).headingDegrees, 90);
  assert.equal(resolveVesselHeading(511, 180).headingDegrees, 180);
  assert.equal(resolveVesselHeading(null, null, 45).headingDegrees, 45);
});

test('normalizeVesselSnapshot produces stable liveObjectId ais:{MMSI}', () => {
  __resetAisVesselCacheForTests();
  __ingestAisMessagesForTests(fixture);
  const snapshot = normalizeVesselSnapshot(new Map([
    [316041833, mergeAisStreamMessage(fixture[0], mergeAisStreamMessage(fixture[1], {}))],
    [316023456, mergeAisStreamMessage(fixture[2], mergeAisStreamMessage(fixture[3], {}))]
  ]), { receivedAt: '2026-08-08T16:01:00.000Z', nowMs: Date.parse('2026-08-08T16:01:00.000Z') });

  assert.equal(snapshot.vesselCount, 2);
  assert.equal(snapshot.objects[0].liveObjectId, 'ais:316041833');
  assert.equal(snapshot.objects[0].objectType, 'VESSEL');
  assert.equal(snapshot.objects[0].destination, 'MONTREAL');
  assert.equal(getAisStableId(snapshot.objects[0]), 'ais:316041833');
});

test('planLiveObjectEdits diffs add update remove for vessels', () => {
  const rawStates = [
    { mmsi: 316041833, latitude: 45.5, longitude: -73.5, positionObservedAt: '2026-08-08T16:00:00.000Z' },
    { mmsi: 316099999, latitude: 45.6, longitude: -73.6, positionObservedAt: '2026-08-08T16:00:00.000Z' }
  ];
  const objects = rawStates
    .map((s) => normalizeVesselState(s, { nowMs: Date.parse('2026-08-08T16:01:00.000Z') }))
    .filter(Boolean);

  const known = new Set(['ais:316041833', 'ais:316023456']);
  const plan = planLiveObjectEdits(objects, known, 'liveObjectId');
  assert.deepEqual(plan.toAdd, ['ais:316099999']);
  assert.deepEqual(plan.toUpdate, ['ais:316041833']);
  assert.deepEqual(plan.toDelete, ['ais:316023456']);
});

test('fetchLiveVessels fails soft without API key', async () => {
  __resetAisVesselCacheForTests();
  const prev = process.env.AISSTREAM_API_KEY;
  process.env.AISSTREAM_API_KEY = '';
  const result = await fetchLiveVessels({ force: true });
  process.env.AISSTREAM_API_KEY = prev;
  assert.equal(result.ok, false);
  assert.equal(result.keyRequired, true);
  assert.match(result.error, /not configured/i);
});

test('fetchLiveVessels returns fixture snapshot without live socket', async () => {
  __resetAisVesselCacheForTests();
  __ingestAisMessagesForTests(fixture);
  const prev = process.env.AISSTREAM_API_KEY;
  process.env.AISSTREAM_API_KEY = 'test-key-for-unit';
  const result = await fetchLiveVessels({ force: true, skipStreamStart: true });
  process.env.AISSTREAM_API_KEY = prev;
  assert.equal(result.ok, true);
  assert.ok(result.vesselCount >= 2);
});

test('prepareVesselEditBundle applies add update remove', async () => {
  __resetVesselTrackingForTests(new Set(['ais:old']));
  let state = {};
  for (const message of fixture) {
    state = mergeAisStreamMessage(message, state);
  }
  const object = normalizeVesselState(state, { nowMs: Date.parse('2026-08-08T16:01:00.000Z') });
  const objects = object ? [object] : [];

  const layer = {
    queryFeatures: async () => ({ features: [] })
  };
  const bundle = await prepareVesselEditBundle(layer, objects, new Set(['ais:old']), {
    Graphic: function Graphic(props) { return props; },
    Point: function Point(props) { Object.assign(this, props); }
  });

  assert.ok(bundle.addFeatures.length >= 1);
  assert.deepEqual(bundle.deleteFeatures, [{ objectId: stableVesselObjectId('ais:old', 1) }]);
});

test('matchVesselsLiveIntent recognizes Show live vessels', () => {
  assert.deepEqual(matchVesselsLiveIntent('Show live vessels'), {
    phrase: VESSELS_LAYER_TITLE,
    action: 'SHOW_LAYER'
  });
});

test('adapter interface documents fetch normalize getStableId', () => {
  const iface = getAisAdapterInterface();
  assert.equal(iface.sourceId, 'aisstream');
  assert.ok(iface.fetchSnapshot);
  assert.ok(iface.normalize);
  assert.ok(iface.getStableId);
});

test('Spatial V2 chassis disables AISStream autostart unless IQAI_AIS_SPATIAL_STREAM is on', () => {
  assert.equal(isAisSpatialStreamEnabled({}), false);
  assert.equal(isAisSpatialStreamEnabled({ IQAI_AIS_SPATIAL_STREAM: '' }), false);
  assert.equal(isAisSpatialStreamEnabled({ IQAI_AIS_SPATIAL_STREAM: 'off' }), false);
  assert.equal(isAisSpatialStreamEnabled({ IQAI_AIS_SPATIAL_STREAM: 'on' }), true);
});
