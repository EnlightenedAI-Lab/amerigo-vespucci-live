import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  normalizeHydroMarkersPayload,
  normalizeHydroOutageRow,
  mapCrewStatus,
  mapCauseCategory,
  parseCoordinatePair,
  parseHydroVersionTimestamp,
  buildOutageId
} from '../src/spatial/hydro-quebec-outages-normalize.js';
import {
  fetchHydroQuebecOutages,
  fetchHydroQuebecOutageAreas,
  __resetHydroOutageCacheForTests
} from '../src/spatial/hydro-quebec-outages-client.js';
import {
  HYDRO_LAYER_ID,
  HYDRO_REFRESH_MS
} from '../src/spatial/hydro-quebec-outages-config.js';
import {
  planHydroOutageEdits,
  prepareHydroOutageEditBundle,
  stableOutageObjectId,
  __resetHydroOutageTrackingForTests
} from '../public/spatial/hydro-quebec-outages.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const markersFixture = JSON.parse(
  readFileSync(join(root, 'test/fixtures/hydro-quebec-bismarkers.json'), 'utf8')
);
const versionFixture = readFileSync(join(root, 'test/fixtures/hydro-quebec-bisversion.json'), 'utf8').trim();
const kmlFixture = readFileSync(join(root, 'test/fixtures/hydro-quebec-bispoly.kml'), 'utf8');

function buildKmzFromKml(kml, entryName = 'doc.kml') {
  const nameBytes = Buffer.from(entryName, 'utf8');
  const compressed = zlib.deflateRawSync(Buffer.from(kml, 'utf8'));
  const header = Buffer.alloc(30 + nameBytes.length);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(8, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt32LE(compressed.length, 14);
  header.writeUInt32LE(Buffer.byteLength(kml, 'utf8'), 18);
  header.writeUInt16LE(nameBytes.length, 26);
  header.writeUInt16LE(0, 28);
  nameBytes.copy(header, 30);
  return Buffer.concat([header, compressed]);
}

const kmzFixture = buildKmzFromKml(kmlFixture);

test('parseHydroVersionTimestamp converts bisversion to ISO', () => {
  const iso = parseHydroVersionTimestamp('20260808120009');
  assert.equal(iso, '2026-08-08T12:00:09.000Z');
});

test('mapCrewStatus maps documented codes and unknown', () => {
  assert.deepEqual(mapCrewStatus('A'), { crewStatusCode: 'A', crewStatusLabel: 'Work assigned' });
  assert.deepEqual(mapCrewStatus('R'), { crewStatusCode: 'R', crewStatusLabel: 'Crew en route' });
  assert.deepEqual(mapCrewStatus('L'), { crewStatusCode: 'L', crewStatusLabel: 'Crew at work' });
  assert.deepEqual(mapCrewStatus('N'), { crewStatusCode: 'N', crewStatusLabel: 'Unknown' });
  assert.deepEqual(mapCrewStatus(''), { crewStatusCode: '', crewStatusLabel: 'Unknown' });
});

test('mapCauseCategory maps documented families', () => {
  assert.equal(mapCauseCategory('24').causeCategory, 'Weather');
  assert.equal(mapCauseCategory('11').causeCategory, 'Equipment failure');
  assert.equal(mapCauseCategory('51').causeCategory, 'Vegetation damage');
  assert.equal(mapCauseCategory('52').causeCategory, 'Animal damage');
  assert.equal(mapCauseCategory('31').causeCategory, 'Accident / incident');
  assert.equal(mapCauseCategory('99').causeCategory, 'Unknown');
  assert.equal(mapCauseCategory('').causeCategory, 'Unknown');
});

test('normalizeHydroMarkersPayload handles fixture records', () => {
  const outages = normalizeHydroMarkersPayload(markersFixture, {
    version: '20260808120009',
    feedTimestamp: '2026-08-08T12:00:09.000Z',
    receivedAt: '2026-08-08T12:01:00.000Z'
  });
  assert.equal(outages.length, 4);
  const weather = outages.find((entry) => entry.causeCode === '24');
  assert.ok(weather);
  assert.equal(weather.causeCategory, 'Weather');
  assert.equal(weather.crewStatusLabel, 'Work assigned');
  const vegetation = outages.find((entry) => entry.causeCode === '51');
  assert.equal(vegetation.causeCategory, 'Vegetation damage');
  const withMessage = outages.find((entry) => entry.messageId === 'hydro-msg-1119');
  assert.equal(withMessage.outageId, 'msg:hydro-msg-1119');
});

test('normalizeHydroOutageRow rejects invalid coordinates', () => {
  const bad = normalizeHydroOutageRow([
    1, '2026-08-08 10:00:00', '', 'P', 'invalid', 'A', '', '24', '100', ''
  ]);
  assert.equal(bad, null);
});

test('parseCoordinatePair accepts bracketed lon/lat strings', () => {
  const coords = parseCoordinatePair('[-73.5, 45.5]');
  assert.deepEqual(coords, { longitude: -73.5, latitude: 45.5 });
});

test('fetchHydroQuebecOutages uses fixtures without live Hydro calls', async () => {
  __resetHydroOutageCacheForTests();
  const version = JSON.parse(versionFixture);
  const fetchFn = async (url) => {
    if (String(url).includes('bisversion.json')) {
      return { ok: true, text: async () => versionFixture };
    }
    if (String(url).includes('bismarkers')) {
      return { ok: true, text: async () => JSON.stringify(markersFixture) };
    }
    if (String(url).includes('bispoly')) {
      return {
        ok: true,
        headers: { get: () => 'application/vnd.google-earth.kmz' },
        arrayBuffer: async () => kmzFixture
      };
    }
    throw new Error(`unexpected url ${url}`);
  };

  const result = await fetchHydroQuebecOutages({ fetchFn, force: true });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'CURRENT');
  assert.equal(result.outageCount, 4);
  assert.equal(result.polygonCount, 3);
  assert.equal(result.polygonStatus, 'CURRENT');
  assert.equal(result.version, version);

  const cached = await fetchHydroQuebecOutages({ fetchFn });
  assert.equal(cached.fromCache, true);
  assert.equal(cached.outageCount, 4);
});

test('fetchHydroQuebecOutages keeps markers when polygon fetch fails', async () => {
  __resetHydroOutageCacheForTests();
  const fetchFn = async (url) => {
    if (String(url).includes('bisversion.json')) {
      return { ok: true, text: async () => versionFixture };
    }
    if (String(url).includes('bismarkers')) {
      return { ok: true, text: async () => JSON.stringify(markersFixture) };
    }
    if (String(url).includes('bispoly')) {
      return { ok: false, headers: { get: () => 'text/plain' }, arrayBuffer: async () => Buffer.from('') };
    }
    throw new Error('unexpected');
  };

  const result = await fetchHydroQuebecOutages({ fetchFn, force: true });
  assert.equal(result.ok, true);
  assert.equal(result.outageCount, 4);
  assert.equal(result.polygonStatus, 'ERROR');
  assert.equal(result.polygonCount, 0);
});

test('fetchHydroQuebecOutages preserves stale polygons when refresh polygon fetch fails', async () => {
  __resetHydroOutageCacheForTests();
  const goodFetch = async (url) => {
    if (String(url).includes('bisversion.json')) {
      return { ok: true, text: async () => versionFixture };
    }
    if (String(url).includes('bismarkers')) {
      return { ok: true, text: async () => JSON.stringify(markersFixture) };
    }
    if (String(url).includes('bispoly')) {
      return {
        ok: true,
        headers: { get: () => 'application/vnd.google-earth.kmz' },
        arrayBuffer: async () => kmzFixture
      };
    }
    throw new Error('unexpected');
  };
  await fetchHydroQuebecOutages({ fetchFn: goodFetch, force: true });

  const staleFetch = async (url) => {
    if (String(url).includes('bisversion.json')) {
      return { ok: true, text: async () => versionFixture };
    }
    if (String(url).includes('bismarkers')) {
      return { ok: true, text: async () => JSON.stringify(markersFixture) };
    }
    if (String(url).includes('bispoly')) {
      return { ok: false, headers: { get: () => 'text/plain' }, arrayBuffer: async () => Buffer.from('') };
    }
    throw new Error('unexpected');
  };

  const result = await fetchHydroQuebecOutages({ fetchFn: staleFetch, force: true });
  assert.equal(result.ok, true);
  assert.equal(result.outageCount, 4);
  assert.equal(result.polygonStatus, 'STALE');
  assert.equal(result.polygonCount, 3);
});

test('fetchHydroQuebecOutageAreas returns polygon feed slice', async () => {
  __resetHydroOutageCacheForTests();
  const fetchFn = async (url) => {
    if (String(url).includes('bisversion.json')) {
      return { ok: true, text: async () => versionFixture };
    }
    if (String(url).includes('bismarkers')) {
      return { ok: true, text: async () => JSON.stringify(markersFixture) };
    }
    if (String(url).includes('bispoly')) {
      return {
        ok: true,
        headers: { get: () => 'application/vnd.google-earth.kmz' },
        arrayBuffer: async () => kmzFixture
      };
    }
    throw new Error(`unexpected url ${url}`);
  };
  const areas = await fetchHydroQuebecOutageAreas({ fetchFn, force: true });
  assert.equal(areas.ok, true);
  assert.equal(areas.polygonCount, 3);
  assert.equal(areas.areas.length, 3);
});

test('fetchHydroQuebecOutages returns STALE snapshot on refresh failure', async () => {
  __resetHydroOutageCacheForTests();
  const fetchFn = async (url) => {
    if (String(url).includes('bisversion.json')) {
      return { ok: true, text: async () => versionFixture };
    }
    if (String(url).includes('bismarkers')) {
      return { ok: true, text: async () => JSON.stringify(markersFixture) };
    }
    if (String(url).includes('bispoly')) {
      return {
        ok: true,
        headers: { get: () => 'application/vnd.google-earth.kmz' },
        arrayBuffer: async () => kmzFixture
      };
    }
    throw new Error('unexpected');
  };
  await fetchHydroQuebecOutages({ fetchFn, force: true });

  const stale = await fetchHydroQuebecOutages({
    fetchFn: async () => ({ ok: false, text: async () => '' }),
    force: true
  });
  assert.equal(stale.ok, true);
  assert.equal(stale.status, 'STALE');
  assert.equal(stale.outageCount, 4);
  assert.match(stale.error, /HTTP/i);
});

test('planHydroOutageEdits diffs add update remove by outageId', () => {
  const known = new Set(['a', 'b']);
  const outages = [
    { outageId: 'b' },
    { outageId: 'c' }
  ];
  const plan = planHydroOutageEdits(outages, known);
  assert.deepEqual(plan.toAdd, ['c']);
  assert.deepEqual(plan.toUpdate, ['b']);
  assert.deepEqual(plan.toDelete, ['a']);
});

test('prepareHydroOutageEditBundle applies add update remove', async () => {
  __resetHydroOutageTrackingForTests(new Set(['old-id']));
  const outages = normalizeHydroMarkersPayload(markersFixture, {
    version: '20260808120009',
    feedTimestamp: '2026-08-08T12:00:09.000Z',
    receivedAt: '2026-08-08T12:01:00.000Z'
  });
  const updateTarget = outages.find((entry) => entry.messageId === 'hydro-msg-1119');

  const store = new Map();
  store.set(stableOutageObjectId('old-id', 1), {
    attributes: { OBJECTID: stableOutageObjectId('old-id', 1), outageId: 'old-id' },
    geometry: null
  });
  store.set(stableOutageObjectId(updateTarget.outageId, 2), {
    attributes: { OBJECTID: stableOutageObjectId(updateTarget.outageId, 2), outageId: updateTarget.outageId },
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

  const payload = { outages, outageCount: outages.length };
  const known = new Set(['old-id', updateTarget.outageId]);

  const bundle = await prepareHydroOutageEditBundle(layer, payload, known, {
    Graphic: function Graphic(props) { return props; },
    Point: function Point(props) { Object.assign(this, props); }
  });

  assert.ok(bundle.addFeatures.length >= 1);
  assert.ok(bundle.updateFeatures.length >= 1);
  assert.deepEqual(bundle.deleteFeatures, [{ objectId: stableOutageObjectId('old-id', 1) }]);
});

test('hydro refresh interval is 15 minutes', () => {
  assert.equal(HYDRO_REFRESH_MS, 15 * 60 * 1000);
  assert.equal(HYDRO_LAYER_ID, 'hydro-quebec-current-outages');
});

test('buildOutageId prefers messageId when present', () => {
  const id = buildOutageId({ messageId: 'abc', municipalityId: '1' }, { longitude: 1, latitude: 2 }, 'start');
  assert.equal(id, 'msg:abc');
});
