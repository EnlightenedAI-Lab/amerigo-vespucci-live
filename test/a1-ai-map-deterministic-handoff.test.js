import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretSpatialLanguage } from '../src/spatial/spatial-language-interpreter.js';
import { adaptValidatedPlanToExecution } from '../src/spatial/a1-gis-plan-adapter.js';
import { validateGISPlan } from '../src/spatial/a1-gis-plan-validator.js';
import {
  planSpatialCapability,
  SPATIAL_CAPABILITY
} from '../public/spatial/spatial-capability-router.js';

const LOCATION = '997 de la commune';

const CASES = [
  {
    name: 'toilets',
    prompt: 'map toilets 500 meters from 997 de la commune',
    action: 'WITHIN',
    conceptId: 'TOILETS',
    radiusMeters: 500,
    datasetIds: []
  },
  {
    name: 'fire',
    prompt: 'map fire stations within 3 km of 997 de la commune',
    action: 'WITHIN',
    datasetIds: ['FIRE_STATIONS'],
    radiusMeters: 3000
  },
  {
    name: 'police',
    prompt: 'show police stations within 3 km of 997 de la commune',
    action: 'WITHIN',
    datasetIds: ['POLICE_STATIONS'],
    radiusMeters: 3000
  },
  {
    name: 'hospital',
    prompt: 'nearest hospital to 997 de la commune',
    action: 'NEAREST',
    datasetIds: ['HOSPITALS'],
    limit: 1
  }
];

function commandShape(interpreted) {
  const cmd = interpreted.commands?.[0] || {};
  return {
    supported: interpreted.supported,
    action: cmd.action || null,
    datasetIds: cmd.datasetIds || [],
    conceptId: cmd.conceptId || null,
    semanticValue: cmd.semanticValue || cmd.semanticCategory?.semanticValue || null,
    radiusMeters: cmd.radiusMeters ?? null,
    limit: cmd.limit ?? null,
    location: cmd.resolvedLocation || cmd.location || interpreted.sharedLocation || null
  };
}

for (const item of CASES) {
  test(`handoff ${item.name}: Direct GIS and AI MAP route to the same deterministic command`, () => {
    const direct = interpretSpatialLanguage(item.prompt);
    const aiRoute = planSpatialCapability(item.prompt);
    const shape = commandShape(direct);

    assert.equal(direct.supported, true, `${item.name} Direct GIS unsupported: ${direct.message}`);
    assert.equal(aiRoute.capability, SPATIAL_CAPABILITY.DETERMINISTIC_GIS, `${item.name} AI MAP capability ${aiRoute.capability}`);
    assert.equal(aiRoute.available, true);
    assert.equal(shape.action, item.action);
    assert.equal(shape.radiusMeters, item.radiusMeters ?? null);
    assert.equal(shape.limit, item.limit ?? null);
    assert.match(String(shape.location), new RegExp(LOCATION, 'i'));
    if (item.conceptId) {
      assert.equal(shape.conceptId, item.conceptId);
    }
    if (item.datasetIds?.length) {
      assert.deepEqual(shape.datasetIds, item.datasetIds);
    }
  });
}

test('AI MAP MAP operation with radius adapts to the same WITHIN contract as Direct GIS', () => {
  const direct = interpretSpatialLanguage('map fire stations within 3 km of 997 de la commune');
  const planned = validateGISPlan({
    schemaVersion: '1.0.0',
    operation: 'MAP',
    dataset: 'fire_stations',
    location: { type: 'address', text: '997 de la commune' },
    radius: { value: 3, unit: 'km' }
  });
  assert.equal(planned.valid, true);
  assert.equal(planned.normalizedPlan.operation, 'WITHIN');
  const adapted = adaptValidatedPlanToExecution(planned.normalizedPlan);
  const fromAdapted = interpretSpatialLanguage(adapted.prompt);
  assert.equal(direct.supported, true);
  assert.equal(fromAdapted.supported, true);
  assert.equal(fromAdapted.commands[0].action, direct.commands[0].action);
  assert.equal(fromAdapted.commands[0].datasetIds[0], direct.commands[0].datasetIds[0]);
  assert.equal(fromAdapted.commands[0].radiusMeters, direct.commands[0].radiusMeters);
});
