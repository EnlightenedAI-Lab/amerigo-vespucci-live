import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSpatialIntent } from '../src/spatial/mapper-intent.js';
import { SOURCE_IDS } from '../src/spatial/approved-external-source-registry.js';
import {
  executeCategoryCountsWithin,
  normalizeCategoryCountFeatures
} from '../src/spatial/external-feature-xray.js';
import { buildMapFromPrompt } from '../src/spatial/iqai-mapper.js';
import { expandConversationInput } from '../public/spatial/spatial-conversation-resolve.js';
import { getConversationState, patchConversationState } from '../public/spatial/spatial-conversation-state.js';
import { DATASET_IDS } from '../src/spatial/dataset-registry.js';
import { planCompoundPrompt } from '../src/spatial/spatial-compound-planner.js';
import { buildCategorySummaryTableModel } from '../public/spatial/results-table-model.js';

const ORIGIN = {
  latitude: 45.494180980834,
  longitude: -73.553221995734,
  matchedAddress: '997 de la Commune Rue O, Montréal, Quebec, H3C 1B8',
  locationText: '997 de la Commune'
};

const GROUPED_FEATURES = [
  { attributes: { amenity: 'restaurant', category_count: 421 } },
  { attributes: { amenity: 'pharmacy', category_count: 31 } },
  { attributes: { amenity: 'toilets', category_count: 33 } },
  { attributes: { amenity: '', category_count: 5 } },
  { attributes: { amenity: null, category_count: 2 } }
];

let queryUrlSeen = '';

function mockGroupedFetch() {
  return async (url) => {
    queryUrlSeen = String(url);
    if (queryUrlSeen.includes('groupByFieldsForStatistics')) {
      return { ok: true, json: async () => ({ features: GROUPED_FEATURES }) };
    }
    if (queryUrlSeen.includes('/0?f=json')) {
      return { ok: true, json: async () => ({ fields: [{ name: 'amenity' }, { name: 'OBJECTID' }] }) };
    }
    if (queryUrlSeen.includes('returnCountOnly=true')) {
      return { ok: true, json: async () => ({ count: 31 }) };
    }
    if (queryUrlSeen.includes('/query?') && queryUrlSeen.includes('returnGeometry=true')) {
      return {
        ok: true,
        json: async () => ({
          features: [{
            attributes: { OBJECTID: 1, amenity: 'pharmacy', name: 'Pharmacy' },
            geometry: { x: -73.554, y: 45.495 }
          }]
        })
      };
    }
    if (queryUrlSeen.includes('/query?')) {
      return {
        ok: true,
        json: async () => ({
          features: [{
            attributes: { OBJECTID: 1, amenity: 'pharmacy', name: 'Pharmacy' },
            geometry: { x: -73.554, y: 45.495 }
          }]
        })
      };
    }
    return { ok: false, status: 404, json: async () => ({ error: { message: 'not found' } }) };
  };
}

test('CATEGORY_COUNTS_WITHIN intent parses amenities x-ray command', () => {
  const intent = parseSpatialIntent('What amenities exist within 3 km of 997 de la Commune?');
  assert.equal(intent.supported, true);
  assert.equal(intent.request.action, 'CATEGORY_COUNTS_WITHIN');
  assert.equal(intent.request.sourceId, SOURCE_IDS.OSM_NA_AMENITIES);
  assert.equal(intent.request.semanticField, 'amenity');
  assert.equal(intent.request.radiusMeters, 3000);
  assert.equal(intent.request.locationText, '997 de la Commune');
});

test('normalizeCategoryCountFeatures sorts count DESC then value ASC and excludes blanks', () => {
  const normalized = normalizeCategoryCountFeatures(GROUPED_FEATURES, 'amenity');
  assert.deepEqual(normalized.categories.map((c) => c.value), ['restaurant', 'toilets', 'pharmacy']);
  assert.equal(normalized.categories[0].count, 421);
  assert.equal(normalized.totalCategories, 3);
  assert.equal(normalized.totalFeaturesRepresented, 485);
});

test('executeCategoryCountsWithin uses grouped statistics with AOI and no geometry', async () => {
  queryUrlSeen = '';
  const result = await executeCategoryCountsWithin({
    action: 'CATEGORY_COUNTS_WITHIN',
    sourceId: SOURCE_IDS.OSM_NA_AMENITIES,
    semanticField: 'amenity',
    radiusMeters: 3000
  }, ORIGIN, { fetchFn: mockGroupedFetch() });

  assert.equal(result.ok, true);
  assert.ok(queryUrlSeen.includes('groupByFieldsForStatistics=amenity'));
  assert.ok(queryUrlSeen.includes('returnGeometry=false'));
  assert.ok(queryUrlSeen.includes('distance=3000'));
  assert.equal(result.xrayResult.categories[0].value, 'restaurant');
  assert.equal(result.xrayResult.totalFeaturesRepresented, 485);
});

test('executeCategoryCountsWithin fails closed without radius', async () => {
  const result = await executeCategoryCountsWithin({
    action: 'CATEGORY_COUNTS_WITHIN',
    sourceId: SOURCE_IDS.OSM_NA_AMENITIES,
    semanticField: 'amenity'
  }, ORIGIN, { fetchFn: mockGroupedFetch() });
  assert.equal(result.ok, false);
});

test('buildMapFromPrompt executes x-ray end-to-end with mocks', async () => {
  const mapResult = await buildMapFromPrompt(
    'What amenities exist within 3 km of 997 de la Commune?',
    {
      fetchFn: mockGroupedFetch(),
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
      })
    }
  );
  assert.equal(mapResult.supported, true);
  assert.equal(mapResult.action, 'CATEGORY_COUNTS_WITHIN');
  assert.equal(mapResult.xrayResult.semanticField, 'amenity');
  assert.equal(mapResult.xrayResult.categories[0].value, 'restaurant');
  assert.equal(mapResult.features.length, 0);
});

test('conversation state stores x-ray context', () => {
  patchConversationState({
    lastXraySourceId: SOURCE_IDS.OSM_NA_AMENITIES,
    lastXraySemanticField: 'amenity',
    lastXrayRadiusKm: 3,
    lastXrayLocation: '997 de la Commune',
    lastXrayCategories: [
      { value: 'pharmacy', count: 31 },
      { value: 'toilets', count: 33 }
    ]
  });
  const state = getConversationState();
  assert.equal(state.lastXraySourceId, SOURCE_IDS.OSM_NA_AMENITIES);
  assert.equal(state.lastXrayRadiusKm, 3);
  assert.equal(state.lastXrayCategories.length, 2);
});

test('Show me the pharmacies selects category for operational display', () => {
  patchConversationState({
    lastXraySourceId: SOURCE_IDS.OSM_NA_AMENITIES,
    lastXraySemanticField: 'amenity',
    lastXrayRadiusKm: 3,
    lastXrayLocation: '997 de la Commune',
    lastXrayCategories: [
      { value: 'pharmacy', count: 31 },
      { value: 'toilets', count: 33 }
    ]
  });
  const expanded = expandConversationInput('Show me the pharmacies.');
  assert.equal(expanded.ok, true);
  assert.equal(expanded.expansion, 'xray_category_followup');
  assert.equal(expanded.metaAction, 'XRAY_ADD_CATEGORY');
  assert.equal(expanded.xrayCategoryValue, 'pharmacy');
});

test('Show me the pharmacies fails when category not in x-ray', () => {
  patchConversationState({
    lastXraySourceId: SOURCE_IDS.OSM_NA_AMENITIES,
    lastXraySemanticField: 'amenity',
    lastXrayRadiusKm: 3,
    lastXrayLocation: '997 de la Commune',
    lastXrayCategories: [{ value: 'toilets', count: 33 }]
  });
  const expanded = expandConversationInput('Show me the pharmacies.');
  assert.equal(expanded.ok, false);
});

test('verified Fire Stations precedence unchanged for direct command', () => {
  const intent = parseSpatialIntent('Show fire stations within 3 km of 997 de la Commune');
  assert.equal(intent.supported, true);
  assert.equal(intent.request.action, 'WITHIN');
  assert.deepEqual(intent.request.datasetIds, [DATASET_IDS.FIRE_STATIONS]);
});

test('planCompoundPrompt routes amenities x-ray to CATEGORY_COUNTS_WITHIN', () => {
  const planned = planCompoundPrompt('What amenities exist within 3 km of 997 de la Commune?');
  assert.equal(planned.supported, true);
  assert.equal(planned.commands[0].action, 'CATEGORY_COUNTS_WITHIN');
  assert.equal(planned.commands[0].sourceId, 'OSM_NA_AMENITIES');
});

test('buildCategorySummaryTableModel produces category rows not features', () => {
  const model = buildCategorySummaryTableModel({
    action: 'CATEGORY_COUNTS_WITHIN',
    xrayResult: {
      semanticField: 'amenity',
      categories: [
        { value: 'restaurant', count: 666 },
        { value: 'charging_station', count: 117 }
      ],
      totalFeaturesRepresented: 6470
    }
  });
  assert.equal(model.mode, 'category_summary');
  assert.equal(model.rows.length, 2);
  assert.equal(model.rows[0].values.count, 666);
});

test('x-ray follow-up pharmacies does not execute scoped materialized query', async () => {
  patchConversationState({
    lastXraySourceId: SOURCE_IDS.OSM_NA_AMENITIES,
    lastXraySemanticField: 'amenity',
    lastXrayRadiusKm: 3,
    lastXrayLocation: '997 de la Commune',
    lastXrayCategories: [{ value: 'pharmacy', count: 31 }]
  });
  const expanded = expandConversationInput('Show me the pharmacies.');
  assert.equal(expanded.metaAction, 'XRAY_ADD_CATEGORY');
  assert.equal(expanded.xrayCategoryValue, 'pharmacy');
  assert.equal(expanded.prompt, undefined);
});
