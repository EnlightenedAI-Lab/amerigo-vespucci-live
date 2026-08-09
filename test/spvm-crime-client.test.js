import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchSpvmCrimeGeojson, fetchSpvmStatus } from '../src/spatial/spvm-crime-client.js';

const GEOJSON_FIXTURE = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 'abc',
      geometry: { type: 'Point', coordinates: [-73.6, 45.5] },
      properties: { category: 'Méfait', date: '2026-08-05' }
    }
  ]
};

const STATUS_FIXTURE = {
  status: 'CURRENT',
  mappedRecords: 1,
  windowRecords: 1
};

test('SPVM proxy fetches and caches GeoJSON FeatureCollection', async () => {
  let fetchCount = 0;
  const fetchFn = async (url) => {
    fetchCount += 1;
    if (url.includes('geojson') || url.includes('spvm-crime-90d')) {
      return {
        ok: true,
        text: async () => JSON.stringify(GEOJSON_FIXTURE)
      };
    }
    throw new Error(`unexpected url ${url}`);
  };

  const first = await fetchSpvmCrimeGeojson({ fetchFn, force: true });
  assert.equal(first.ok, true);
  assert.equal(first.featureCount, 1);
  assert.equal(first.geojson.type, 'FeatureCollection');

  const second = await fetchSpvmCrimeGeojson({ fetchFn });
  assert.equal(second.cached, true);
  assert.equal(fetchCount, 1);
});

test('SPVM proxy retains stale GeoJSON on upstream failure', async () => {
  let fail = false;
  const fetchFn = async (url) => {
    if (url.includes('spvm-crime-90d')) {
      if (fail) throw new Error('upstream down');
      return { ok: true, text: async () => JSON.stringify(GEOJSON_FIXTURE) };
    }
    throw new Error(`unexpected url ${url}`);
  };

  await fetchSpvmCrimeGeojson({ fetchFn, force: true });
  fail = true;
  const stale = await fetchSpvmCrimeGeojson({ fetchFn, force: true });
  assert.equal(stale.ok, true);
  assert.equal(stale.stale, true);
  assert.equal(stale.featureCount, 1);
});

test('SPVM status proxy returns mappedRecords', async () => {
  const fetchFn = async (url) => {
    if (url.includes('status.json')) {
      return { ok: true, text: async () => JSON.stringify(STATUS_FIXTURE) };
    }
    throw new Error(`unexpected url ${url}`);
  };

  const result = await fetchSpvmStatus({ fetchFn, force: true });
  assert.equal(result.ok, true);
  assert.equal(result.status.mappedRecords, 1);
});
