import test from 'node:test';
import assert from 'node:assert/strict';
import { getApprovedExternalSource, SOURCE_IDS } from '../src/spatial/approved-external-source-registry.js';
import {
  resolveSemanticCategoryFromText,
  getSemanticCategoryById,
  CONCEPT_IDS
} from '../src/spatial/semantic-category-registry.js';
import {
  executeExternalFeatureQuery,
  validateGeographicCoordinates,
  DIRECT_FETCH_THRESHOLD,
  HARD_EXECUTION_MAX
} from '../src/spatial/external-feature-query.js';
import { planCompoundPrompt } from '../src/spatial/spatial-compound-planner.js';
import { buildMapFromPrompt } from '../src/spatial/iqai-mapper.js';

const ORIGIN = {
  latitude: 45.494180980834,
  longitude: -73.553221995734,
  matchedAddress: '997 de la Commune Rue O, Montréal, Quebec, H3C 1B8',
  locationText: '997 de la Commune'
};

const LAYER_META = {
  fields: [{ name: 'amenity' }, { name: 'OBJECTID' }, { name: 'name' }],
  types: [{ id: 'toilets', name: 'toilets' }],
  editingInfo: { dataLastEditDate: 1786186800000 }
};

function mockFetch(handlers = {}) {
  return async (url) => {
    const text = String(url);
    if (handlers.throwOn) {
      for (const pattern of handlers.throwOn) {
        if (text.includes(pattern)) throw new Error('network failure');
      }
    }
    if (text.includes('/0?f=json')) {
      return { ok: true, json: async () => handlers.layerMeta || LAYER_META };
    }
    if (text.includes('returnCountOnly=true')) {
      const count = handlers.count ?? 2;
      return { ok: true, json: async () => ({ count }) };
    }
    if (text.includes('/query?')) {
      return {
        ok: true,
        json: async () => ({
          features: handlers.features || [
            {
              attributes: { OBJECTID: 1, amenity: 'toilets', name: null },
              geometry: { x: -73.554, y: 45.495 }
            },
            {
              attributes: { OBJECTID: 2, amenity: 'toilets', name: 'Bathroom' },
              geometry: { x: -73.552, y: 45.493 }
            }
          ]
        })
      };
    }
    return { ok: false, status: 404, json: async () => ({ error: { message: 'not found' } }) };
  };
}

test('semantic resolution maps bathroom aliases to TOILETS', () => {
  for (const phrase of ['bathroom', 'bathrooms', 'restroom', 'washrooms']) {
    const category = resolveSemanticCategoryFromText(phrase);
    assert.equal(category?.conceptId, CONCEPT_IDS.TOILETS);
  }
});

test('TOILETS resolves to OSM_NA_AMENITIES source', () => {
  const category = getSemanticCategoryById(CONCEPT_IDS.TOILETS);
  assert.equal(category.sourceId, SOURCE_IDS.OSM_NA_AMENITIES);
  assert.equal(category.filter.field, 'amenity');
  assert.equal(category.filter.value, 'toilets');
});

test('approved external source registry registers OSM_NA_AMENITIES headless', () => {
  const source = getApprovedExternalSource(SOURCE_IDS.OSM_NA_AMENITIES);
  assert.ok(source);
  assert.equal(source.trustTier, 'TRUSTED_EXTERNAL');
  assert.equal(source.headless, true);
  assert.equal(source.categoryField, 'amenity');
  assert.equal(source.maxRecordCount, 2000);
});

test('compound planner builds TRUSTED_EXTERNAL WITHIN plan for bathrooms command', () => {
  const plan = planCompoundPrompt('Show bathrooms within 5 km of 997 de la Commune');
  assert.equal(plan.supported, true);
  assert.equal(plan.commands.length, 1);
  assert.equal(plan.commands[0].action, 'WITHIN');
  assert.equal(plan.commands[0].layerSource, 'TRUSTED_EXTERNAL');
  assert.equal(plan.commands[0].conceptId, CONCEPT_IDS.TOILETS);
  assert.equal(plan.commands[0].sourceId, SOURCE_IDS.OSM_NA_AMENITIES);
  assert.equal(plan.commands[0].radiusMeters, 5000);
});

test('external query builds amenity toilets filter with bounded WITHIN geometry', async () => {
  const urls = [];
  const fetchFn = async (url) => {
    urls.push(String(url));
    return mockFetch()(url);
  };

  const result = await executeExternalFeatureQuery({
    action: 'WITHIN',
    layerSource: 'TRUSTED_EXTERNAL',
    conceptId: CONCEPT_IDS.TOILETS,
    sourceId: SOURCE_IDS.OSM_NA_AMENITIES,
    categoryFilter: { field: 'amenity', operator: 'EQ', value: 'toilets' },
    radiusMeters: 5000
  }, ORIGIN, { fetchFn });

  assert.equal(result.ok, true);
  assert.equal(result.features.length, 2);
  assert.ok(urls.some((u) => u.includes('amenity') && u.includes('toilets')));
  assert.ok(urls.some((u) => u.includes('distance=5000')));
  const featureFetchUrl = urls.find((u) => u.includes('/query?') && !u.includes('returnCountOnly=true'));
  assert.ok(featureFetchUrl?.includes('outSR=4326'), 'feature fetch must request WGS84 output');
});

test('validateGeographicCoordinates rejects Web Mercator values mislabeled as lon/lat', () => {
  const mercator = validateGeographicCoordinates(-8187831.1658, 5700337.817, SOURCE_IDS.OSM_NA_AMENITIES);
  assert.equal(mercator.ok, false);
  assert.match(mercator.message, /outside \[-180, 180\]|\[-90, 90\]/i);
});

test('validateGeographicCoordinates accepts Montreal WGS84 coordinates', () => {
  const montreal = validateGeographicCoordinates(-73.5525, 45.4985, SOURCE_IDS.OSM_NA_AMENITIES);
  assert.equal(montreal.ok, true);
});

test('validateGeographicCoordinates rejects invalid longitude', () => {
  const bad = validateGeographicCoordinates(200, 45.5, SOURCE_IDS.OSM_NA_AMENITIES);
  assert.equal(bad.ok, false);
  assert.match(bad.message, /longitude.*outside/i);
});

test('validateGeographicCoordinates rejects invalid latitude', () => {
  const bad = validateGeographicCoordinates(-73.5, 95, SOURCE_IDS.OSM_NA_AMENITIES);
  assert.equal(bad.ok, false);
  assert.match(bad.message, /latitude.*outside/i);
});

test('external query fails closed on Web Mercator geometry without outSR projection', async () => {
  const result = await executeExternalFeatureQuery({
    action: 'WITHIN',
    conceptId: CONCEPT_IDS.TOILETS,
    sourceId: SOURCE_IDS.OSM_NA_AMENITIES,
    radiusMeters: 5000
  }, ORIGIN, {
    fetchFn: mockFetch({
      features: [{
        attributes: { OBJECTID: 1, amenity: 'toilets' },
        geometry: { x: -8187831.1658, y: 5700337.817 }
      }]
    })
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /outside \[-180, 180\]|\[-90, 90\]/i);
});

test('scoped 5 km results stay within approximately 5 km', async () => {
  const result = await executeExternalFeatureQuery({
    action: 'WITHIN',
    conceptId: CONCEPT_IDS.TOILETS,
    sourceId: SOURCE_IDS.OSM_NA_AMENITIES,
    radiusMeters: 5000
  }, ORIGIN, { fetchFn: mockFetch() });

  assert.equal(result.ok, true);
  const maxDistance = Math.max(...result.features.map((f) => f.distanceMeters));
  assert.ok(maxDistance <= 5000 + 50, `max distance ${maxDistance}m exceeds 5 km AOI`);
  assert.ok(result.features.every((f) => f.longitude > -74 && f.longitude < -72));
  assert.ok(result.features.every((f) => f.latitude > 45 && f.latitude < 46));
});

test('external query safety blocks unregistered source and missing schema', async () => {
  const unregistered = await executeExternalFeatureQuery({
    action: 'WITHIN',
    conceptId: CONCEPT_IDS.TOILETS,
    sourceId: 'UNKNOWN_SOURCE',
    radiusMeters: 5000
  }, ORIGIN, { fetchFn: mockFetch() });
  assert.equal(unregistered.ok, false);

  const missingField = await executeExternalFeatureQuery({
    action: 'WITHIN',
    conceptId: CONCEPT_IDS.TOILETS,
    sourceId: SOURCE_IDS.OSM_NA_AMENITIES,
    radiusMeters: 5000
  }, ORIGIN, {
    fetchFn: mockFetch({ layerMeta: { fields: [{ name: 'OBJECTID' }], types: [] } })
  });
  assert.equal(missingField.ok, false);

  const unbounded = await executeExternalFeatureQuery({
    action: 'WITHIN',
    conceptId: CONCEPT_IDS.TOILETS,
    sourceId: SOURCE_IDS.OSM_NA_AMENITIES,
    radiusMeters: 0
  }, ORIGIN, { fetchFn: mockFetch() });
  assert.equal(unbounded.ok, false);
});

test('external query does not fetch when count exceeds direct threshold', async () => {
  let queryFetchCount = 0;
  const fetchFn = async (url) => {
    const text = String(url);
    if (text.includes('/query?')) queryFetchCount += 1;
    return mockFetch({ count: DIRECT_FETCH_THRESHOLD + 1 })(url);
  };

  const result = await executeExternalFeatureQuery({
    action: 'WITHIN',
    conceptId: CONCEPT_IDS.TOILETS,
    sourceId: SOURCE_IDS.OSM_NA_AMENITIES,
    radiusMeters: 5000
  }, ORIGIN, { fetchFn });

  assert.equal(result.ok, false);
  assert.equal(queryFetchCount, 1);
  assert.match(result.message, /exceeds safe display limit/);
});

test('external query blocks hard maximum counts', async () => {
  const result = await executeExternalFeatureQuery({
    action: 'WITHIN',
    conceptId: CONCEPT_IDS.TOILETS,
    sourceId: SOURCE_IDS.OSM_NA_AMENITIES,
    radiusMeters: 5000
  }, ORIGIN, {
    fetchFn: mockFetch({ count: HARD_EXECUTION_MAX + 1 })
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /hard execution maximum/);
});

test('normalization tolerates missing name and address fields', async () => {
  const result = await executeExternalFeatureQuery({
    action: 'WITHIN',
    conceptId: CONCEPT_IDS.TOILETS,
    sourceId: SOURCE_IDS.OSM_NA_AMENITIES,
    radiusMeters: 5000
  }, ORIGIN, {
    fetchFn: mockFetch({
      features: [{
        attributes: { OBJECTID: 9, amenity: 'toilets' },
        geometry: { x: -73.554, y: 45.495 }
      }]
    })
  });

  assert.equal(result.ok, true);
  assert.equal(result.features[0].name, null);
  assert.equal(result.features[0].address, '');
});

test('provenance records source trust filter operation radius attribution', async () => {
  const result = await executeExternalFeatureQuery({
    action: 'WITHIN',
    conceptId: CONCEPT_IDS.TOILETS,
    sourceId: SOURCE_IDS.OSM_NA_AMENITIES,
    radiusMeters: 5000
  }, ORIGIN, { fetchFn: mockFetch() });

  const provenance = result.datasetResults[0].provenance;
  assert.equal(provenance.sourceId, SOURCE_IDS.OSM_NA_AMENITIES);
  assert.equal(provenance.trustTier, 'TRUSTED_EXTERNAL');
  assert.equal(provenance.categoryFilter.value, 'toilets');
  assert.equal(provenance.spatialOperation, 'WITHIN');
  assert.equal(provenance.radiusMeters, 5000);
  assert.equal(provenance.attribution, '© OpenStreetMap contributors');
  assert.equal(provenance.licence, 'ODbL');
});

test('buildMapFromPrompt executes external toilets query end-to-end with mocks', async () => {
  const mapResult = await buildMapFromPrompt(
    'Show bathrooms within 5 km of 997 de la Commune',
    {
      geocodeFn: async () => ({
        ok: true,
        candidate: {
          latitude: ORIGIN.latitude,
          longitude: ORIGIN.longitude,
          resolvedAddress: ORIGIN.matchedAddress,
          score: 95,
          geocoder: 'ArcGIS World GeocodeServer'
        },
        extractedAddress: '997 de la Commune',
        normalizedQuery: '997 de la Commune',
        validation: 'PASS'
      }),
      fetchFn: mockFetch({ count: 2 })
    }
  );

  assert.equal(mapResult.supported, true);
  assert.equal(mapResult.datasetResults.length, 1);
  assert.equal(mapResult.datasetResults[0].sourceType, 'TRUSTED_EXTERNAL');
  assert.equal(mapResult.datasetResults[0].matchedFeatures, 2);
  assert.equal(mapResult.summary.layerSource, 'TRUSTED_EXTERNAL');
  assert.equal(mapResult.source.trust, 'TRUSTED_EXTERNAL');
});
