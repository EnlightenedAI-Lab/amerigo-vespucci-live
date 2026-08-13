import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSpatialUtterance } from '../src/spatial/spatial-language-gateway.js';
import { interpretSpatialLanguageAsync } from '../src/spatial/spatial-language-interpreter.js';
import { loadVocabularyContextForPlanning } from '../src/spatial/external-feature-vocabulary.js';

test('normalizeSpatialUtterance strips grammatical noise and units', () => {
  const gateway = normalizeSpatialUtterance('show me pharmacies are within 1km of 997 de la commune');
  assert.match(gateway.normalized, /pharmacies within 1 km of/i);
  assert.equal(gateway.ambiguity, null);
});

test('normalizeSpatialUtterance preserves French dans un rayon de', () => {
  const gateway = normalizeSpatialUtterance(
    'montre-moi les pharmacies dans un rayon de 3 km du 997 de la Commune'
  );
  assert.match(gateway.normalized, /dans un rayon de 3 km de 997 de la Commune/i);
});

test('gateway acceptance: malformed pharmacy within radius', async () => {
  const vocab = await loadVocabularyContextForPlanning();
  const result = await interpretSpatialLanguageAsync(
    'show me pharmacies are within 1km of 997 de la commune',
    { vocabularyContext: vocab }
  );
  assert.equal(result.supported, true);
  assert.equal(result.commands[0].action, 'WITHIN');
  assert.equal(result.commands[0].distanceKm, 1);
  assert.equal(result.commands[0].semanticCategory?.semanticValue || result.commands[0].semanticValue, 'pharmacy');
  assert.match(result.commands[0].resolvedLocation || result.sharedLocation, /997 de la commune/i);
  assert.match(result.canonicalUtterance, /pharmacies within 1 km/i);
});

test('gateway acceptance: pharmacies around location within radius', async () => {
  const vocab = await loadVocabularyContextForPlanning();
  const result = await interpretSpatialLanguageAsync(
    'can you show me pharmacies around 997 de la commune within 3km',
    { vocabularyContext: vocab }
  );
  assert.equal(result.supported, true);
  assert.equal(result.commands[0].action, 'WITHIN');
  assert.equal(result.commands[0].distanceKm, 3);
  assert.equal(result.commands[0].semanticCategory?.semanticValue || result.commands[0].semanticValue, 'pharmacy');
});

test('gateway acceptance: where are pharmacies near location', async () => {
  const vocab = await loadVocabularyContextForPlanning();
  const result = await interpretSpatialLanguageAsync(
    'where are pharmacies near 997 de la commune within 2 km',
    { vocabularyContext: vocab }
  );
  assert.equal(result.supported, true);
  assert.equal(result.commands[0].action, 'WITHIN');
  assert.equal(result.commands[0].distanceKm, 2);
  assert.equal(result.commands[0].semanticCategory?.semanticValue || result.commands[0].semanticValue, 'pharmacy');
});

test('gateway acceptance: French pharmacy radius phrasing', async () => {
  const vocab = await loadVocabularyContextForPlanning();
  const result = await interpretSpatialLanguageAsync(
    'montre-moi les pharmacies dans un rayon de 3 km du 997 de la Commune',
    { vocabularyContext: vocab }
  );
  assert.equal(result.supported, true);
  assert.equal(result.commands[0].action, 'WITHIN');
  assert.equal(result.commands[0].distanceKm, 3);
  assert.equal(result.commands[0].semanticCategory?.semanticValue || result.commands[0].semanticValue, 'pharmacy');
});

test('gateway acceptance: ambiguous hospitals pharmacy around commune', async () => {
  const vocab = await loadVocabularyContextForPlanning();
  const result = await interpretSpatialLanguageAsync(
    'show hospitals pharmacy around commune 3',
    { vocabularyContext: vocab }
  );
  assert.equal(result.supported, false);
  assert.equal(result.clarification, true);
  assert.match(result.message, /clarify|Did you mean/i);
});

test('gateway acceptance: vague deictic without context fails closed', async () => {
  const vocab = await loadVocabularyContextForPlanning();
  const result = await interpretSpatialLanguageAsync('show those things near there', { vocabularyContext: vocab });
  assert.equal(result.supported, false);
  assert.equal(result.clarification, true);
});

test('gateway acceptance: toilets 500 meters from address becomes WITHIN', async () => {
  const vocab = await loadVocabularyContextForPlanning();
  const result = await interpretSpatialLanguageAsync(
    'map toilets 500 meters from 997 de la commune',
    { vocabularyContext: vocab }
  );
  assert.equal(result.supported, true);
  assert.equal(result.commands[0].action, 'WITHIN');
  assert.equal(result.commands[0].radiusMeters, 500);
  assert.equal(result.commands[0].semanticValue || result.commands[0].semanticCategory?.semanticValue, 'toilets');
  assert.match(result.commands[0].resolvedLocation || result.sharedLocation, /997 de la commune/i);
});

test('gateway acceptance: uncounted nearest hospital defaults to limit 1', async () => {
  const vocab = await loadVocabularyContextForPlanning();
  const result = await interpretSpatialLanguageAsync(
    'nearest hospital to 997 de la commune',
    { vocabularyContext: vocab }
  );
  assert.equal(result.supported, true);
  assert.equal(result.commands[0].action, 'NEAREST');
  assert.equal(result.commands[0].limit, 1);
  assert.equal(result.commands[0].datasetIds[0], 'HOSPITALS');
});
