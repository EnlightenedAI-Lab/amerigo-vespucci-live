import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretSpatialLanguage, interpretSpatialLanguageAsync } from '../src/spatial/spatial-language-interpreter.js';
import { planCompoundPrompt } from '../src/spatial/spatial-compound-planner.js';
import { getLanguageExampleCount } from '../src/spatial/spatial-language-pack.js';
import { DATASET_IDS } from '../src/spatial/dataset-registry.js';
import { CLARIFICATION } from '../src/spatial/spatial-language-pack.js';

test('compound planner parses three-clause police nearest + fire within + hospitals within', () => {
  const planned = planCompoundPrompt(
    'Map the 3 nearest police stations, all active fire stations within 4 km, and hospitals within 3 km of 997 de la Commune.'
  );
  assert.equal(planned.supported, true);
  assert.equal(planned.commands.length, 3);
  assert.equal(planned.commands[0].action, 'NEAREST');
  assert.equal(planned.commands[0].datasetIds[0], DATASET_IDS.POLICE_STATIONS);
  assert.equal(planned.commands[0].limit, 3);
  assert.equal(planned.commands[1].action, 'WITHIN');
  assert.equal(planned.commands[1].datasetIds[0], DATASET_IDS.FIRE_STATIONS);
  assert.equal(planned.commands[1].distanceKm, 4);
  assert.equal(planned.commands[2].action, 'WITHIN');
  assert.equal(planned.commands[2].datasetIds[0], DATASET_IDS.HOSPITALS);
  assert.equal(planned.commands[2].distanceKm, 3);
  assert.equal(planned.sharedLocation, '997 de la Commune');
});

test('compound planner parses nearest police + fire within', () => {
  const planned = planCompoundPrompt(
    'map 3 nearest police stations and all fire stations within 4 km of 997 de la Commune'
  );
  assert.equal(planned.supported, true);
  assert.equal(planned.commands.length, 2);
  assert.equal(planned.commands[0].action, 'NEAREST');
  assert.equal(planned.commands[0].datasetIds[0], DATASET_IDS.POLICE_STATIONS);
  assert.equal(planned.commands[0].limit, 3);
  assert.equal(planned.commands[1].action, 'WITHIN');
  assert.equal(planned.commands[1].datasetIds[0], DATASET_IDS.FIRE_STATIONS);
  assert.equal(planned.commands[1].distanceKm, 4);
  assert.equal(planned.sharedLocation, '997 de la Commune');
});

test('interpretSpatialLanguage handles filler and cops nearest phrasing', () => {
  const cases = [
    'show me police stations within 3 km of 997 de la Commune',
    'where are the three cops closest to 997 de la Commune',
    'give me hospitals within five kilometres of 997 de la Commune',
    'montre-moi les trois postes de police les plus proches de 997 de la Commune',
    'montre les casernes dans un rayon de 4 km autour de 997 de la Commune'
  ];
  for (const text of cases) {
    const result = interpretSpatialLanguage(text);
    assert.equal(result.supported, true, text);
  }
});

test('interpretSpatialLanguage returns clarification for vague prompts', async () => {
  const showMe = interpretSpatialLanguage('show me');
  assert.equal(showMe.supported, false);
  assert.equal(showMe.message, CLARIFICATION.specifyWhat);

  const important = await interpretSpatialLanguageAsync('show me important places nearby');
  assert.equal(important.supported, false);
  assert.match(important.message, /verified dataset/i);
});

test('interpretSpatialLanguage reuses previous location context', () => {
  const result = interpretSpatialLanguage('Show me the 3 nearest police stations.', {
    previousLocationText: '997 de la Commune'
  });
  assert.equal(result.supported, true);
  assert.equal(result.commands[0].action, 'NEAREST');
  assert.equal(result.commands[0].resolvedLocation, '997 de la Commune');
});

test('language example corpus has hundreds of utterances', () => {
  const count = getLanguageExampleCount();
  assert.ok(count >= 300, `expected >= 300 examples, got ${count}`);
});
