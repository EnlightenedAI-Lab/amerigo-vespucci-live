import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeMeterRadiusPhrases,
  normalizeBroadAmenityDiscovery,
  normalizeSpatialUtterance
} from '../src/spatial/spatial-language-gateway.js';
import { matchAmenitiesXrayIntent, buildAmenitiesXrayPlan } from '../src/spatial/amenity-xray-intent.js';
import { interpretSpatialLanguageAsync } from '../src/spatial/spatial-language-interpreter.js';
import { loadVocabularyContextForPlanning } from '../src/spatial/external-feature-vocabulary.js';
import { expandConversationInput } from '../public/spatial/spatial-conversation-resolve.js';

test('broad amenity discovery normalizes to CATEGORY_COUNTS_WITHIN intent', async () => {
  const prompt = 'tell me what kinds of amenities are around 997 de la commune within 2km';
  const gateway = normalizeSpatialUtterance(prompt);
  assert.match(gateway.normalized, /what amenities exist within 2 km of 997 de la commune/i);
  const match = matchAmenitiesXrayIntent(gateway.normalized);
  assert.ok(match);
  const plan = buildAmenitiesXrayPlan(match);
  assert.equal(plan.commands[0].action, 'CATEGORY_COUNTS_WITHIN');
  const vocab = await loadVocabularyContextForPlanning();
  const interpreted = await interpretSpatialLanguageAsync(prompt, { vocabularyContext: vocab });
  assert.equal(interpreted.supported, true);
  assert.equal(interpreted.commands[0].action, 'CATEGORY_COUNTS_WITHIN');
});

test('meter radius family normalizes to km within', () => {
  const normalized = normalizeMeterRadiusPhrases(
    'show charging stations less than 3000m around 997 de la commune'
  );
  assert.match(normalized, /show charging stations within 3 km of 997 de la commune/i);
});

test('bare meter-from phrasing normalizes to canonical within km', () => {
  const normalized = normalizeMeterRadiusPhrases(
    'map toilets 500 meters from 997 de la commune'
  );
  assert.match(normalized, /map toilets within 0\.5 km of 997 de la commune/i);
});

test('charging station 3000m query resolves to semantic category', async () => {
  const gateway = normalizeSpatialUtterance('show charging stations less than 3000m around 997 de la commune');
  const vocab = await loadVocabularyContextForPlanning();
  const interpreted = await interpretSpatialLanguageAsync(gateway.normalized, { vocabularyContext: vocab });
  assert.equal(interpreted.supported, true);
  assert.equal(interpreted.commands[0].action, 'WITHIN');
  assert.equal(interpreted.commands[0].distanceKm, 3);
  assert.equal(
    interpreted.commands[0].semanticCategory?.semanticValue
      || interpreted.commands[0].semanticValue,
    'charging_station'
  );
});

test('two-turn radius refinement reuses pharmacy scoped context', () => {
  const state = {
    lastScopedLocation: '997 de la Commune',
    lastScopedDatasets: [{ title: 'Pharmacy', datasetId: 'concept:AMENITY:pharmacy' }],
    lastScopedRadiusKm: 2,
    lastSpatialOperation: 'WITHIN'
  };
  const expanded = expandConversationInput('make it 4km', state);
  assert.equal(expanded.ok, true);
  assert.match(expanded.prompt, /Pharmacy within 4 km of 997 de la Commune/i);
});
