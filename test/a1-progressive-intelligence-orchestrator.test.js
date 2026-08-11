import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMISSION_OUTCOME,
  ADMISSION_REASON
} from '../src/spatial/orchestrator/intelligence-admission.js';
import { governCandidateViaAgent2 } from '../src/spatial/orchestrator/govern-candidate-client.js';
import {
  buildProgressiveIntelligenceTaskGraph,
  PROGRESSIVE_CAPABILITIES
} from '../src/spatial/orchestrator/progressive-intelligence-graph.js';
import { validateTaskGraphStructure } from '../src/spatial/orchestrator/fire-station-graph.js';
import { evaluateDependency } from '../src/spatial/orchestrator/task-state-machine.js';
import { DEPENDENCY_TYPES, TASK_STATES, MILESTONE_TYPES } from '../src/spatial/orchestrator/contracts.js';
import {
  buildDataVersionPatch,
  buildIntelligenceFeatureKey,
  isProgressiveVerticalSliceQuery
} from '../src/spatial/orchestrator/progressive-research-stream.js';
import { buildIntelligenceMapActionPlan } from '../src/spatial/orchestrator/intelligence-map-action-plan-builder.js';
import { validateMapActionPlan } from '../src/spatial/orchestrator/map-action-validator.js';
import { runProgressiveIntelligenceGraph } from '../src/spatial/orchestrator/progressive-intelligence-coordinator.js';
import { assessEsriAiFeasibility } from '../src/spatial/orchestrator/esri-ai-feasibility.js';
import {
  isRetryableLiveRetrievalFailure,
  retrieveLiveIntelligenceCandidates
} from '../src/spatial/orchestrator/live-intelligence-retrieval.js';
import { createSpatialLatencyTrace } from '../src/spatial/spatial-latency-trace.js';

const ADMITTED_EVENT = {
  eventId: 'evt-fire-1',
  title: 'Structure fire in Montréal',
  occurredAt: '2026-07-15T14:00:00.000Z',
  publishedAt: '2026-07-15T15:00:00.000Z',
  locationText: 'Rue Sainte-Catherine, Montréal',
  mappable: true,
  geometry: { type: 'Point', coordinates: [-73.57, 45.50] },
  sourceReports: [{ url: 'https://www.cbc.ca/news/canada/montreal/fire-report', publisher: 'CBC' }]
};

const REQUEST = {
  from: '2026-07-01T00:00:00.000Z',
  to: '2026-08-10T00:00:00.000Z',
  geography: 'Greater Montréal',
  query: 'fires montreal'
};

async function govern(event, extra = {}) {
  return governCandidateViaAgent2(event, REQUEST, {
    admittedEventIds: extra.admittedEventIds || []
  });
}

function mockStream(admitted = [ADMITTED_EVENT], metrics = {}) {
  return async (_request, hooks) => {
    hooks.onFirstSource?.(admitted[0]);
    hooks.onFirstCandidate?.(admitted[0]);
    for (const event of admitted) {
      const governed = await govern(event);
      if (governed.admitted) hooks.onFirstGoverned?.(governed);
      if (governed.admitted) await hooks.onAdmittedCandidate?.(governed);
    }
    return {
      corpusResult: { events: [] },
      liveResult: { candidates: [] },
      admittedEventIds: admitted.map((e) => e.eventId),
      metrics: {
        corpusLatencyMs: metrics.corpusLatencyMs ?? 12,
        liveLatencyMs: metrics.liveLatencyMs ?? 1800,
        providerSelectionLatencyMs: metrics.providerSelectionLatencyMs ?? 5,
        selectedProvider: metrics.selectedProvider ?? 'GROK_XAI',
        fallbackUsed: metrics.fallbackUsed ?? false,
        timeToFirstSourceMs: 10,
        timeToFirstCandidateMs: 20,
        timeToFirstGovernedEventMs: 30,
        timeToFirstGeocodedEventMs: 25,
        timeToFirstMappableEventMs: 28,
        ...metrics
      },
      cancelled: false
    };
  };
}

describe('Progressive intelligence orchestrator Phase 2 closeout', () => {
  it('matches vertical slice query including 90-day window', () => {
    assert.equal(isProgressiveVerticalSliceQuery(
      'Map significant fires in Greater Montréal during the last 90 days'
    ), true);
  });

  it('builds Phase 2 graph with STREAM GATE DATA_VERSION', () => {
    const graph = buildProgressiveIntelligenceTaskGraph({
      objectiveId: 'obj-1',
      originalText: 'fires',
      conceptId: 'fires'
    });
    assert.equal(validateTaskGraphStructure(graph).valid, true);
    assert.ok(graph.dependencies.some((d) => d.type === DEPENDENCY_TYPES.STREAM));
    assert.ok(graph.dependencies.some((d) => d.type === DEPENDENCY_TYPES.GATE));
    assert.ok(graph.dependencies.some((d) => d.type === DEPENDENCY_TYPES.DATA_VERSION));
  });

  it('uses real Agent 2 admission for ADMIT / ADMIT_WITH_CAUTION / HOLD / REJECT', async () => {
    const admit = await govern(ADMITTED_EVENT);
    assert.equal(admit.admission.outcome, ADMISSION_OUTCOME.ADMIT);

    const caution = await govern({
      ...ADMITTED_EVENT,
      eventId: 'evt-fire-2',
      locationText: null,
      municipality: null,
      neighbourhood: 'Plateau-Mont-Royal',
      geometry: null,
      mappable: false
    });
    assert.equal(caution.admission.outcome, ADMISSION_OUTCOME.ADMIT_WITH_CAUTION);
    assert.ok(caution.admission.reasonCodes.includes(ADMISSION_REASON.COARSE_LOCATION_ONLY));

    const hold = await govern({
      ...ADMITTED_EVENT,
      eventId: 'evt-fire-3',
      locationText: null,
      neighbourhood: null,
      municipality: null,
      geometry: null,
      mappable: false
    });
    assert.equal(hold.admission.outcome, ADMISSION_OUTCOME.HOLD);

    const reject = await govern({ ...ADMITTED_EVENT, eventId: 'evt-fire-4', sourceReports: [] });
    assert.equal(reject.admission.outcome, ADMISSION_OUTCOME.REJECT);
    assert.ok(reject.admission.reasonCodes.includes(ADMISSION_REASON.NO_SOURCE_URL));
  });

  it('blocks live map admission when Agent 2 governance is unavailable', async () => {
    await assert.rejects(async () => {
      await governCandidateViaAgent2(ADMITTED_EVENT, REQUEST, { agent2Unavailable: true });
    }, (error) => error.code === 'AGENT2_GOVERNANCE_UNAVAILABLE');
  });

  it('builds and validates intelligence MapActionPlan from Agent 2 governed result', async () => {
    const governed = await govern(ADMITTED_EVENT);
    const plan = buildIntelligenceMapActionPlan(governed, {
      graphId: 'g1',
      sessionScope: 'g1',
      conceptId: 'fires'
    });
    const validation = validateMapActionPlan(plan, {
      sessionScope: 'g1',
      expectedResultVersion: governed.governedEventVersion || 1,
      mapResultPayload: plan.mapResultPayload
    });
    assert.equal(validation.approved, true);
  });

  it('DATA_VERSION patch preserves stable feature key', async () => {
    const governed = await govern(ADMITTED_EVENT);
    const key1 = buildIntelligenceFeatureKey(governed, 'session-a');
    const patch = buildDataVersionPatch(governed, { patchType: 'additionalEvidence' });
    const key2 = buildIntelligenceFeatureKey({ ...governed, governedEventId: governed.governedEventId }, 'session-a');
    assert.equal(key1, key2);
    assert.equal(patch.governedEventVersion, 2);
  });

  it('runs progressive graph with separated corpus/live metrics', async () => {
    const result = await runProgressiveIntelligenceGraph({
      query: 'Map significant fires in Greater Montréal during the last 30 days',
      conceptId: 'fires',
      ...REQUEST
    }, {
      streamProgressiveResearch: mockStream([ADMITTED_EVENT], {
        corpusLatencyMs: 15,
        liveLatencyMs: 1800,
        fallbackUsed: true,
        selectedProvider: 'GROK_XAI'
      })
    });

    assert.equal(result.ok, true);
    assert.equal(result.pendingMapPlans.length, 1);
    assert.ok(result.performance.corpusLatencyMs < 100);
    assert.ok(result.performance.liveRetrievalLatencyMs > 100);
    assert.equal(result.performance.fallbackUsed, true);
    const milestoneTypes = result.milestones.map((m) => m.milestone);
    assert.ok(milestoneTypes.includes(MILESTONE_TYPES.FIRST_GOVERNED_EVENT));
  });

  it('demonstrates provider fallback when primary worker unavailable', async () => {
    const failures = [];
    const result = await retrieveLiveIntelligenceCandidates(REQUEST, {
      simulatePrimaryUnavailable: true,
      providerChain: [
        {
          workerId: 'gemini-live-retrieval',
          providerLabel: 'GEMINI',
          traceProvider: 'GEMINI',
          retrievalProvider: 'gemini-google-search-v1',
          researchOrigin: 'gemini-google-search',
          isConfigured: () => true,
          gather: async () => { throw new Error('quota exceeded'); }
        },
        {
          workerId: 'grok-live-retrieval',
          providerLabel: 'GROK_XAI',
          traceProvider: 'GROK_XAI',
          retrievalProvider: 'grok-xai-search-v1',
          researchOrigin: 'grok-xai-search',
          isConfigured: () => true,
          gather: async () => ({
            candidates: [{
              title: 'Fire incident',
              occurredAt: '2026-07-10T12:00:00.000Z',
              locationText: 'Montréal',
              sourceReports: [{ url: 'https://example.com/fallback-fire' }]
            }]
          })
        }
      ]
    });
    assert.equal(result.provider, 'GROK_XAI');
    assert.equal(result.fallbackUsed, true);
    assert.equal(result.candidates.length, 1);
    assert.equal(isRetryableLiveRetrievalFailure(new Error('quota exceeded')), true);
  });

  it('provider failure yields DEGRADED without blocking admitted plan', async () => {
    const result = await runProgressiveIntelligenceGraph({ conceptId: 'fires', ...REQUEST }, {
      streamProgressiveResearch: async (_req, hooks) => {
        const governed = await govern(ADMITTED_EVENT);
        await hooks.onAdmittedCandidate?.(governed);
        return {
          corpusResult: {},
          liveResult: { error: 'provider timeout' },
          admittedEventIds: [ADMITTED_EVENT.eventId],
          metrics: { corpusLatencyMs: 10, liveLatencyMs: 5000, fallbackUsed: true },
          cancelled: false
        };
      }
    });
    assert.equal(result.finalState, TASK_STATES.DEGRADED);
    assert.equal(result.pendingMapPlans.length, 1);
  });

  it('documents Esri AI bounded custom agent pilot feasibility', () => {
    const feasibility = assessEsriAiFeasibility();
    assert.equal(feasibility.implementationStatus, 'BOUNDED_CUSTOM_AGENT_PILOT');
  });

  it('registers HOLD/REJECT governed events without map plans', async () => {
    const rejectEvent = {
      ...ADMITTED_EVENT,
      eventId: 'evt-fire-reject-store',
      sourceReports: []
    };
    const result = await runProgressiveIntelligenceGraph({
      query: 'Map significant fires in Greater Montréal during the last 30 days',
      conceptId: 'fires',
      ...REQUEST
    }, {
      streamProgressiveResearch: async (_req, hooks) => {
        const governed = await govern(rejectEvent);
        assert.equal(governed.admitted, false);
        await hooks.onHeldOrRejected?.(governed);
        return {
          corpusResult: { events: [] },
          liveResult: { candidates: [rejectEvent] },
          admittedEventIds: [],
          governanceStats: { candidates: 1, reject: 1, admit: 0 },
          metrics: {
            corpusLatencyMs: 5,
            liveLatencyMs: 20,
            fallbackUsed: false
          },
          cancelled: false
        };
      }
    });
    assert.equal(result.pendingMapPlans.length, 0);
    assert.equal(result.governedEvents.length, 1);
    assert.equal(result.governedEvents[0].governedEventId, 'evt-fire-reject-store');
    assert.equal(result.governedEvents[0].admission?.outcome, ADMISSION_OUTCOME.REJECT);
  });
});
