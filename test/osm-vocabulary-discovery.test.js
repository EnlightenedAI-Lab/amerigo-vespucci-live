import test from 'node:test';
import assert from 'node:assert/strict';
import { SOURCE_IDS, getApprovedExternalSource } from '../src/spatial/approved-external-source-registry.js';
import { CONCEPT_IDS, resolveSemanticCategoryFromText } from '../src/spatial/semantic-category-registry.js';
import {
  clearVocabularyCache,
  fetchDistinctValuesForSourceId,
  getCachedVocabulary,
  VOCABULARY_CACHE_TTL_MS,
  loadVocabularyContextForPlanning
} from '../src/spatial/external-feature-vocabulary.js';
import {
  matchPhraseToDistinctValues,
  expandCategoryVariants,
  normalizeCategoryToken
} from '../src/spatial/semantic-vocabulary-matcher.js';
import { resolveDynamicSemanticFromVocabulary } from '../src/spatial/dynamic-semantic-resolver.js';
import { resolveTargetFromPhrase } from '../src/spatial/webmap-layer-catalog.js';
import { planCompoundPrompt } from '../src/spatial/spatial-compound-planner.js';
import { parseSpatialIntent } from '../src/spatial/mapper-intent.js';
import { buildMapFromPrompt } from '../src/spatial/iqai-mapper.js';
import { DATASET_IDS } from '../src/spatial/dataset-registry.js';

const MOCK_VOCABULARY = [
  'school',
  'pharmacy',
  'grave_yard',
  'drinking_water',
  'toilets',
  'fire_station',
  'parking',
  'fuel',
  'restaurant'
];

const MOCK_SOURCE = getApprovedExternalSource(SOURCE_IDS.OSM_NA_AMENITIES);

function mockVocabularyFetch(distinctValues = MOCK_VOCABULARY) {
  return async (url) => {
    const text = String(url);
    if (text.includes('/0?f=json') && !text.includes('/query')) {
      return {
        ok: true,
        json: async () => ({
          fields: [{ name: 'amenity' }, { name: 'OBJECTID' }],
          editingInfo: { dataLastEditDate: Date.now() }
        })
      };
    }
    if (text.includes('returnDistinctValues=true')) {
      return {
        ok: true,
        json: async () => ({
          features: distinctValues.map((value) => ({
            attributes: { amenity: value }
          }))
        })
      };
    }
    if (text.includes('returnCountOnly=true')) {
      return { ok: true, json: async () => ({ count: 3 }) };
    }
    if (text.includes('/query?')) {
      return {
        ok: true,
        json: async () => ({
          features: [
            {
              attributes: { OBJECTID: 1, amenity: 'grave_yard', name: 'Grave 1' },
              geometry: { x: -73.554, y: 45.495 }
            },
            {
              attributes: { OBJECTID: 2, amenity: 'school', name: 'School 1' },
              geometry: { x: -73.552, y: 45.493 }
            }
          ]
        })
      };
    }
    return { ok: false, status: 404, json: async () => ({ error: { message: 'not found' } }) };
  };
}

function buildMockVocabularyContext(values = MOCK_VOCABULARY) {
  return [{
    source: MOCK_SOURCE,
    semanticField: 'amenity',
    values,
    fromCache: false
  }];
}

test('normalization handles graveyard variants deterministically', () => {
  assert.ok(expandCategoryVariants('graveyards').has('graveyard'));
  assert.ok(expandCategoryVariants('grave yard').has('grave_yard'));
  assert.equal(normalizeCategoryToken('drinking water'), 'drinking_water');
});

test('matchPhraseToDistinctValues resolves graveyards to grave_yard', () => {
  const match = matchPhraseToDistinctValues('graveyards', MOCK_VOCABULARY);
  assert.equal(match.status, 'matched');
  assert.equal(match.value, 'grave_yard');
});

test('matchPhraseToDistinctValues resolves schools to school', () => {
  const match = matchPhraseToDistinctValues('schools', MOCK_VOCABULARY);
  assert.equal(match.status, 'matched');
  assert.equal(match.value, 'school');
});

test('matchPhraseToDistinctValues resolves pharmacies to pharmacy', () => {
  const match = matchPhraseToDistinctValues('pharmacies', MOCK_VOCABULARY);
  assert.equal(match.status, 'matched');
  assert.equal(match.value, 'pharmacy');
});

test('matchPhraseToDistinctValues resolves drinking water to drinking_water', () => {
  const match = matchPhraseToDistinctValues('drinking water', MOCK_VOCABULARY);
  assert.equal(match.status, 'matched');
  assert.equal(match.value, 'drinking_water');
});

test('nonsense category does not guess', () => {
  const match = matchPhraseToDistinctValues('xyznonsensecategory', MOCK_VOCABULARY);
  assert.equal(match.status, 'none');
});

test('ambiguous category fails closed', () => {
  const ambiguousValues = ['grave_yard', 'graveyard'];
  const match = matchPhraseToDistinctValues('graveyard', ambiguousValues);
  assert.equal(match.status, 'ambiguous');
  assert.deepEqual(match.candidates.sort(), ['grave_yard', 'graveyard']);
});

test('vocabulary is cached server-side', async () => {
  clearVocabularyCache();
  const fetchFn = mockVocabularyFetch();
  const first = await fetchDistinctValuesForSourceId(SOURCE_IDS.OSM_NA_AMENITIES, fetchFn);
  assert.equal(first.ok, true);
  assert.equal(first.fromCache, false);
  assert.ok(first.values.includes('school'));

  const second = await fetchDistinctValuesForSourceId(SOURCE_IDS.OSM_NA_AMENITIES, fetchFn);
  assert.equal(second.ok, true);
  assert.equal(second.fromCache, true);
  assert.deepEqual(getCachedVocabulary(SOURCE_IDS.OSM_NA_AMENITIES, 'amenity'), first.values);
});

test('explicit TOILETS still works with vocabulary context', () => {
  const ctx = buildMockVocabularyContext();
  const category = resolveSemanticCategoryFromText('bathrooms');
  assert.equal(category?.conceptId, CONCEPT_IDS.TOILETS);

  const target = resolveTargetFromPhrase('bathrooms', null, { vocabularyContext: ctx });
  assert.equal(target.layerSource, 'TRUSTED_EXTERNAL');
  assert.equal(target.conceptId, CONCEPT_IDS.TOILETS);
  assert.equal(target.semanticValue, 'toilets');
});

test('verified Fire Stations source precedence preserved', () => {
  const ctx = buildMockVocabularyContext();
  const target = resolveTargetFromPhrase('fire stations', null, { vocabularyContext: ctx });
  assert.equal(target.layerSource, 'VERIFIED');
  assert.deepEqual(target.datasetIds, [DATASET_IDS.FIRE_STATIONS]);
});

test('planCompoundPrompt resolves graveyards dynamically', () => {
  const plan = planCompoundPrompt(
    'Show graveyards within 10 km of 997 de la Commune',
    { vocabularyContext: buildMockVocabularyContext() }
  );
  assert.equal(plan.supported, true);
  assert.equal(plan.commands[0].action, 'WITHIN');
  assert.equal(plan.commands[0].layerSource, 'TRUSTED_EXTERNAL');
  assert.equal(plan.commands[0].sourceId, SOURCE_IDS.OSM_NA_AMENITIES);
  assert.equal(plan.commands[0].semanticValue, 'grave_yard');
  assert.equal(plan.commands[0].semanticField, 'amenity');
  assert.equal(plan.commands[0].radiusMeters, 10000);
});

test('parseSpatialIntent resolves pharmacies dynamically', () => {
  const intent = parseSpatialIntent(
    'Show pharmacies within 3 km of 997 de la Commune',
    { vocabularyContext: buildMockVocabularyContext() }
  );
  assert.equal(intent.supported, true);
  assert.equal(intent.request.semanticValue, 'pharmacy');
  assert.equal(intent.request.semanticField, 'amenity');
});

test('buildMapFromPrompt executes dynamic graveyard query end-to-end with mocks', async () => {
  clearVocabularyCache();
  const mapResult = await buildMapFromPrompt(
    'Show graveyards within 10 km of 997 de la Commune',
    {
      fetchFn: mockVocabularyFetch(),
      geocodeFn: async () => ({
        ok: true,
        candidate: {
          latitude: 45.494180980834,
          longitude: -73.553221995734,
          resolvedAddress: '997 de la Commune Rue O, Montréal',
          score: 95,
          geocoder: 'ArcGIS World GeocodeServer'
        },
        extractedAddress: '997 de la Commune',
        normalizedQuery: '997 de la Commune',
        validation: 'PASS'
      }),
    }
  );
  assert.equal(mapResult.supported, true);
  assert.equal(mapResult.summary.semanticValue, 'grave_yard');
  assert.equal(mapResult.summary.semanticField, 'amenity');
  assert.equal(mapResult.summary.layerSource, 'TRUSTED_EXTERNAL');
  assert.equal(mapResult.datasetResults[0].provenance.semanticValue, 'grave_yard');
  assert.equal(mapResult.source.trust, 'TRUSTED_EXTERNAL');
});

test('OSM vocabulary can be obtained from real FeatureLayer', async (t) => {
  clearVocabularyCache();
  const result = await fetchDistinctValuesForSourceId(SOURCE_IDS.OSM_NA_AMENITIES);
  if (!result.ok) {
    t.skip(`live distinct-values unavailable: ${result.message}`);
    return;
  }
  assert.ok(result.values.length > 5);
  assert.ok(result.values.includes('toilets'));
  assert.ok(result.values.some((v) => v === 'school' || v === 'grave_yard' || v === 'pharmacy'));
});

test('live vocabulary cache TTL is one hour', () => {
  assert.equal(VOCABULARY_CACHE_TTL_MS, 60 * 60 * 1000);
});

test('loadVocabularyContextForPlanning supports force refresh', async () => {
  clearVocabularyCache();
  const fetchFn = mockVocabularyFetch(['school', 'pharmacy']);
  await loadVocabularyContextForPlanning({ fetchFn });
  const refreshed = await loadVocabularyContextForPlanning({ fetchFn, forceRefresh: true });
  assert.equal(refreshed.length, 1);
  assert.equal(refreshed[0].values.length, 2);
  assert.ok(refreshed[0].values.includes('school'));
  assert.ok(refreshed[0].values.includes('pharmacy'));
});

test('resolveDynamicSemanticFromVocabulary returns null for unknown', () => {
  const dynamic = resolveDynamicSemanticFromVocabulary(
    'xyznonsense',
    buildMockVocabularyContext()
  );
  assert.equal(dynamic, null);
});
