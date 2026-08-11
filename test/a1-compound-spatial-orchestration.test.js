import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCompoundSpatialObjective,
  isCompoundSpatialObjective,
  TEMPORAL_DIRECTION
} from '../src/spatial/orchestrator/compound-objective-parser.js';
import { buildCompoundSpatialTaskGraph, COMPOUND_TASK_CAPABILITIES } from '../src/spatial/orchestrator/compound-spatial-graph.js';
import { buildAnalyticalMapActionPlan } from '../src/spatial/orchestrator/analytical-map-action-plan-builder.js';
import { DATASET_IDS } from '../src/spatial/dataset-registry.js';

describe('compound spatial objective parser', () => {
  it('parses hospital proximity compound objective', () => {
    const spec = parseCompoundSpatialObjective(
      'Find significant fires, explosions, or hazmat incidents in Montréal in the last 30 days and show hospitals within 2 km of each admitted event.'
    );
    assert.ok(spec);
    assert.equal(spec.referenceDatasetId, DATASET_IDS.HOSPITALS);
    assert.equal(spec.thresholdMeters, 2000);
    assert.equal(spec.temporal.direction, TEMPORAL_DIRECTION.PAST);
  });

  it('parses future protest + government building compound objective', () => {
    const spec = parseCompoundSpatialObjective(
      'Find protests or demonstrations planned in Montréal during the next 7 days and show which are within 1 km of government buildings.'
    );
    assert.ok(spec);
    assert.equal(spec.conceptId, 'protests');
    assert.equal(spec.referenceDatasetId, DATASET_IDS.PUBLIC_BUILDINGS);
    assert.equal(spec.thresholdMeters, 1000);
    assert.equal(spec.temporal.direction, TEMPORAL_DIRECTION.FUTURE);
  });

  it('builds typed compound task graph without parallel coordinator', () => {
    const spec = parseCompoundSpatialObjective(
      'Find protests or demonstrations planned in Montréal during the next 7 days and show which are within 1 km of government buildings.'
    );
    const graph = buildCompoundSpatialTaskGraph(spec, { graphId: 'g-test', traceId: 't-test' });
    assert.equal(graph.tasks.length, 6);
    assert.ok(graph.tasks.some((t) => t.capabilityId === COMPOUND_TASK_CAPABILITIES.REFERENCE_DATA_RESOLUTION));
    assert.ok(graph.dependencies.length >= 5);
  });

  it('analytical plan includes layerId and mappableEvents for map executor', () => {
    const plan = buildAnalyticalMapActionPlan({
      governed: {
        governedEventId: 'evt-1',
        governedEventVersion: 1,
        admission: { outcome: 'ADMIT' },
        candidate: {
          eventId: 'evt-1',
          title: 'Fire',
          mappable: true,
          geometry: { type: 'Point', coordinates: [-73.55, 45.51] }
        }
      },
      proximityResult: {
        hospitals: [{ featureId: 'h1', id: 'h1', name: 'Hospital', latitude: 45.51, longitude: -73.55 }],
        spatialFacts: [{ spatialFactId: 'sf-1' }],
        thresholdMeters: 2000
      },
      context: { graphId: 'g1', sessionScope: 'g1', conceptId: 'fires' }
    });
    assert.equal(plan.mapResultPayload.layerId, plan.mapResultPayload.intelligenceLayerId);
    assert.equal(plan.mapResultPayload.mappableEvents.length, 1);
    assert.equal(plan.mapResultPayload.analytical, true);
  });

  it('matches compound objectives via helper', () => {
    assert.equal(isCompoundSpatialObjective(
      'Find protests or demonstrations planned in Montréal during the next 7 days and show which are within 1 km of government buildings.'
    ), true);
  });

  it('parses paraphrased hospital proximity objective', () => {
    const spec = parseCompoundSpatialObjective(
      'Show me Montréal fire, explosion, or hazmat incidents from the past month, with hospitals within two kilometres of each admitted incident.'
    );
    assert.ok(spec);
    assert.equal(spec.thresholdMeters, 2000);
    assert.equal(spec.temporal.days, 30);
    assert.equal(spec.temporal.direction, TEMPORAL_DIRECTION.PAST);
  });

  it('parses paraphrased protest + government building objective', () => {
    const spec = parseCompoundSpatialObjective(
      'Which planned protests or demos in Montréal over the next week fall within one kilometre of government buildings?'
    );
    assert.ok(spec);
    assert.equal(spec.referenceDatasetId, DATASET_IDS.PUBLIC_BUILDINGS);
    assert.equal(spec.thresholdMeters, 1000);
    assert.equal(spec.temporal.days, 7);
    assert.equal(spec.temporal.direction, TEMPORAL_DIRECTION.FUTURE);
  });

  it('loads government building reference dataset without hard-coded coordinates', async () => {
    const { loadAuthoritativeReferenceDataset } = await import('../src/spatial/orchestrator/reference-proximity-analysis.js');
    const load = await loadAuthoritativeReferenceDataset(DATASET_IDS.PUBLIC_BUILDINGS, {
      fetchFn: async () => ({
        ok: true,
        json: async () => ({
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-73.56, 45.50] },
            properties: {
              titre_lieu: 'Hôtel de Ville',
              types: 'Points de service',
              adresse_postale: '275 Notre-Dame E'
            }
          }]
        })
      })
    });
    assert.equal(load.dataset.id, DATASET_IDS.PUBLIC_BUILDINGS);
    assert.ok(load.features.length >= 1);
    assert.ok(load.receipt.sourceId);
    assert.ok(Number.isFinite(load.features[0].latitude));
  });
});
