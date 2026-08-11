import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSpatialFact,
  markSpatialFactStale,
  invalidateFactsForGeometryChange,
  factsForEventVersion,
  SPATIAL_FACT_STATUS,
  GEOMETRY_METHOD
} from '../src/spatial/orchestrator/spatial-fact-contract.js';
import {
  computeHospitalProximityForEvent,
  loadAuthoritativeHospitals,
  DEFAULT_HOSPITAL_PROXIMITY_THRESHOLD_M
} from '../src/spatial/orchestrator/hospital-proximity-analysis.js';
import { buildCrossAgentAnalystExplanation } from '../src/spatial/orchestrator/cross-agent-analyst-explanation.js';
import { buildAnalyticalMapActionPlan } from '../src/spatial/orchestrator/analytical-map-action-plan-builder.js';
import {
  runCrossAgentSpatialAnalysis,
  proveSpatialFactRecompute,
  isCrossAgentVerticalSliceQuery,
  CROSS_AGENT_VERTICAL_SLICE_QUERY
} from '../src/spatial/orchestrator/cross-agent-spatial-coordinator.js';
import { governCandidateViaAgent2 } from '../src/spatial/orchestrator/govern-candidate-client.js';
import { ADMISSION_OUTCOME } from '../src/spatial/orchestrator/intelligence-admission.js';
import { TASK_STATES } from '../src/spatial/orchestrator/contracts.js';
import { DATASET_IDS } from '../src/spatial/dataset-registry.js';

const HOSPITAL_FIXTURES = [
  {
    featureId: 'hosp-1',
    id: 'hosp-1',
    name: 'Hôpital Notre-Dame',
    latitude: 45.515,
    longitude: -73.555,
    sourceName: 'Statistics Canada ODHF'
  },
  {
    featureId: 'hosp-2',
    id: 'hosp-2',
    name: 'Montreal General Hospital',
    latitude: 45.495,
    longitude: -73.585,
    sourceName: 'Statistics Canada ODHF'
  }
];

const GOVERNED_EVENT = {
  governedEventId: 'evt-fire-cross',
  governedEventVersion: 1,
  candidate: {
    eventId: 'evt-fire-cross',
    title: 'Warehouse fire',
    locationText: 'Rue Notre-Dame, Montréal',
    municipality: 'Montréal',
    geometryVersion: 1,
    mappable: true,
    geometry: { type: 'Point', coordinates: [-73.554, 45.514] },
    sourceReports: [{ url: 'https://www.cbc.ca/news/canada/montreal/warehouse-fire', publisher: 'CBC' }]
  },
  admission: { outcome: ADMISSION_OUTCOME.ADMIT }
};

function mockHospitalLoad() {
  return {
    dataset: { id: DATASET_IDS.HOSPITALS, sourceId: 'STATCAN_HOSPITALS_001', authority: 'Statistics Canada' },
    features: HOSPITAL_FIXTURES,
    receipt: { receiptId: 'hosp-receipt-1', sourceId: 'STATCAN_HOSPITALS_001', featureCount: 2 }
  };
}

describe('Phase 4 cross-agent spatial analysis', () => {
  it('matches cross-agent vertical slice query', () => {
    assert.equal(isCrossAgentVerticalSliceQuery(CROSS_AGENT_VERTICAL_SLICE_QUERY), true);
  });

  it('creates immutable SpatialFact with geodesic method metadata', () => {
    const fact = createSpatialFact({
      eventId: 'evt-1',
      hospitalId: 'hosp-1',
      distanceMeters: 450,
      thresholdMeters: 2000
    });
    assert.equal(fact.relation, 'WITHIN_DISTANCE');
    assert.equal(fact.geometryMethod, GEOMETRY_METHOD.GEODESIC_HAVERSINE_WGS84);
    assert.equal(fact.status, SPATIAL_FACT_STATUS.ACTIVE);
  });

  it('computes deterministic hospital proximity without LLM geometry', async () => {
    const result = await computeHospitalProximityForEvent(GOVERNED_EVENT, {
      hospitalLoad: mockHospitalLoad()
    });
    assert.ok(result.spatialFacts.length >= 1);
    assert.ok(result.hospitals[0].distanceMeters <= DEFAULT_HOSPITAL_PROXIMITY_THRESHOLD_M);
    assert.equal(result.gisReceipt.geodesic, true);
    assert.equal(result.hospitalDatasetReceipt.sourceId, 'STATCAN_HOSPITALS_001');
  });

  it('separates evidence, authoritative GIS, computed fact, and interpretation', () => {
    const explanation = buildCrossAgentAnalystExplanation({
      governed: GOVERNED_EVENT,
      hospital: HOSPITAL_FIXTURES[0],
      spatialFact: { distanceMeters: 450, thresholdMeters: 2000, spatialFactId: 'sf-1' }
    });
    assert.match(explanation.sections.evidenceFact, /governed incident/i);
    assert.match(explanation.sections.authoritativeGisFact, /authoritative ODHF/i);
    assert.match(explanation.sections.computedSpatialFact, /450 metres/i);
    assert.match(explanation.sections.interpretation, /MAY therefore be relevant/i);
    assert.equal(explanation.unsupportedDisruptionInference, false);
  });

  it('builds analytical MapActionPlan with incident + hospital layers', () => {
    const plan = buildAnalyticalMapActionPlan({
      governed: GOVERNED_EVENT,
      proximityResult: {
        hospitals: [HOSPITAL_FIXTURES[0]],
        spatialFacts: [{ spatialFactId: 'sf-1' }],
        thresholdMeters: 2000,
        gisReceipt: { receiptId: 'gis-1' },
        hospitalDatasetReceipt: { receiptId: 'hosp-1' }
      },
      context: { graphId: 'g1', sessionScope: 'g1', conceptId: 'fires' }
    });
    assert.ok(plan.actions.some((a) => a.presentation === 'INTELLIGENCE_EVENTS'));
    assert.ok(plan.actions.some((a) => a.layerId === 'iqai-analytical-hospitals'));
    assert.ok(plan.mapResultPayload.spatialFacts.length);
  });

  it('invalidates stale SpatialFacts on geometry refinement', async () => {
    const governedA = { ...GOVERNED_EVENT, governedEventVersion: 1, candidate: { ...GOVERNED_EVENT.candidate, geometryVersion: 1 } };
    const governedB = {
      ...GOVERNED_EVENT,
      governedEventVersion: 2,
      candidate: {
        ...GOVERNED_EVENT.candidate,
        geometryVersion: 2,
        geometry: { type: 'Point', coordinates: [-73.56, 45.50] }
      }
    };
    const proof = await proveSpatialFactRecompute(governedA, governedB, {
      hospitalLoad: mockHospitalLoad()
    });
    assert.ok(proof.staleFactCount > 0);
    assert.ok(proof.recomputedFactCount > 0);
    assert.equal(proof.duplicateEventId, true);
    assert.equal(proof.geometryChanged, true);
  });

  it('excludes HOLD events from spatial analysis', async () => {
    const holdEvent = {
      eventId: 'evt-hold-cross',
      title: 'Structure fire',
      occurredAt: '2026-07-15T14:00:00.000Z',
      publishedAt: '2026-07-15T15:00:00.000Z',
      locationText: null,
      neighbourhood: null,
      municipality: null,
      geometry: null,
      mappable: false,
      sourceReports: [{ url: 'https://www.cbc.ca/news/canada/montreal/fire-report', publisher: 'CBC' }]
    };
    const hold = await governCandidateViaAgent2(holdEvent, {
      from: '2026-07-01',
      to: '2026-08-10',
      geography: 'Greater Montréal'
    });
    assert.equal(hold.admission.outcome, ADMISSION_OUTCOME.HOLD);
    const result = await runCrossAgentSpatialAnalysis({
      query: CROSS_AGENT_VERTICAL_SLICE_QUERY,
      conceptId: 'fires'
    }, {
      streamProgressiveResearch: async (_req, hooks) => {
        await hooks.onHeldOrRejected?.(hold);
        return {
          corpusResult: {},
          liveResult: {},
          admittedEventIds: [],
          metrics: { corpusLatencyMs: 5, liveLatencyMs: 10 },
          cancelled: false
        };
      },
      hospitalLoad: mockHospitalLoad()
    });
    assert.equal(result.governedEvents.length, 0);
    assert.equal(result.activeSpatialFacts.length, 0);
  });

  it('degrades when hospital dataset unavailable without fabricating proximity', async () => {
    const result = await runCrossAgentSpatialAnalysis({
      query: CROSS_AGENT_VERTICAL_SLICE_QUERY,
      conceptId: 'fires'
    }, {
      simulateHospitalUnavailable: true,
      streamProgressiveResearch: async (_req, hooks) => {
        await hooks.onAdmittedCandidate?.(GOVERNED_EVENT);
        return {
          corpusResult: {},
          liveResult: {},
          admittedEventIds: [GOVERNED_EVENT.candidate.eventId],
          metrics: { corpusLatencyMs: 5, liveLatencyMs: 10 },
          cancelled: false
        };
      }
    });
    assert.equal(result.activeSpatialFacts.length, 0);
    assert.ok(result.hospitalLoadError);
    assert.equal(result.finalState, TASK_STATES.DEGRADED);
  });

  it('preserves governed events when GIS operation fails', async () => {
    const result = await runCrossAgentSpatialAnalysis({
      query: CROSS_AGENT_VERTICAL_SLICE_QUERY,
      conceptId: 'fires'
    }, {
      streamProgressiveResearch: async (_req, hooks) => {
        hooks.onFirstGoverned?.(GOVERNED_EVENT);
        await hooks.onAdmittedCandidate?.({
          ...GOVERNED_EVENT,
          candidate: { ...GOVERNED_EVENT.candidate, geometry: null, mappable: false }
        });
        return {
          corpusResult: {},
          liveResult: {},
          admittedEventIds: [GOVERNED_EVENT.candidate.eventId],
          metrics: { corpusLatencyMs: 5, liveLatencyMs: 10 },
          cancelled: false
        };
      },
      hospitalLoad: mockHospitalLoad()
    });
    assert.equal(result.activeSpatialFacts.length, 0);
  });

  it('produces analytical plans, spatial facts, and map execution for admitted events', async () => {
    const result = await runCrossAgentSpatialAnalysis({
      query: CROSS_AGENT_VERTICAL_SLICE_QUERY,
      conceptId: 'fires'
    }, {
      streamProgressiveResearch: async (_req, hooks) => {
        await hooks.onAdmittedCandidate?.(GOVERNED_EVENT);
        return {
          corpusResult: {},
          liveResult: {},
          admittedEventIds: [GOVERNED_EVENT.candidate.eventId],
          governanceStats: { admit: 1, reject: 0, hold: 0 },
          metrics: { corpusLatencyMs: 5, liveLatencyMs: 10 },
          cancelled: false
        };
      },
      hospitalLoad: mockHospitalLoad(),
      executeMapActionPlan: async () => ({
        success: true,
        mutatedMap: true,
        receiptId: 'exec-mock-1',
        eventsRendered: 1,
        referenceRendered: 1
      })
    });
    assert.equal(result.governedEvents.length, 1);
    assert.ok(result.activeSpatialFacts.length >= 1);
    assert.equal(result.analyticalPlans.length, 1);
    assert.ok(result.executionReceipts.length >= 1);
    const payload = result.analyticalPlans[0].mapResultPayload;
    assert.equal(payload.layerId, payload.intelligenceLayerId);
    assert.equal(payload.mappableEvents.length, 1);
    assert.ok(payload.referenceFeatures.length >= 1);
  });
});
