import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RESEARCH_EXECUTION } from '../src/spatial/intelligence-layer-research-contract.js';
import {
  classifyResearchObjective,
  selectLiveProviderPlan,
  OBJECTIVE_CLASS
} from '../src/spatial/orchestrator/live-provider-selection.js';
import {
  retrieveLiveIntelligenceCandidates,
  isRetryableLiveRetrievalFailure
} from '../src/spatial/orchestrator/live-intelligence-retrieval.js';
import { buildCoverageReceipt, DEGRADED_REASON } from '../src/spatial/orchestrator/coverage-receipt.js';
import { runProgressiveIntelligenceGraph } from '../src/spatial/orchestrator/progressive-intelligence-coordinator.js';
import { governCandidateViaAgent2 } from '../src/spatial/orchestrator/govern-candidate-client.js';
import { ADMISSION_OUTCOME } from '../src/spatial/orchestrator/intelligence-admission.js';
import { TASK_STATES } from '../src/spatial/orchestrator/contracts.js';

const FIRES_REQUEST = {
  query: 'Map significant fires, explosions, or hazmat incidents in Montréal in the last 30 days.',
  conceptId: 'fires',
  geography: 'Greater Montréal',
  from: '2026-07-01T00:00:00.000Z',
  to: '2026-08-10T00:00:00.000Z',
  researchExecution: 'FAST'
};

const ADMITTED_EVENT = {
  eventId: 'evt-fire-fast',
  title: 'Structure fire in Montréal',
  occurredAt: '2026-07-15T14:00:00.000Z',
  publishedAt: '2026-07-15T15:00:00.000Z',
  locationText: 'Rue Sainte-Catherine, Montréal',
  mappable: true,
  geometry: { type: 'Point', coordinates: [-73.57, 45.50] },
  sourceReports: [{ url: 'https://www.cbc.ca/news/canada/montreal/fire-report', publisher: 'CBC' }]
};

function mockExecutor() {
  return async () => ({ success: true, mutatedMap: true, skippedDuplicate: false });
}

describe('Phase 3 FAST / DEEP orchestration', () => {
  it('classifies mixed event discovery objectives', () => {
    assert.equal(
      classifyResearchObjective({ query: FIRES_REQUEST.query, conceptId: 'fires' }),
      OBJECTIVE_CLASS.MIXED_EVENT_DISCOVERY
    );
    assert.equal(
      classifyResearchObjective({ query: 'trending on X about protests' }),
      OBJECTIVE_CLASS.SOCIAL_X_EVENT
    );
  });

  it('selects Gemini primary for FAST generic web research', () => {
    const plan = selectLiveProviderPlan(FIRES_REQUEST);
    assert.equal(plan.execution, RESEARCH_EXECUTION.FAST);
    assert.equal(plan.primary?.providerLabel, 'GEMINI');
    assert.ok(plan.fallback);
    assert.equal(plan.maxLiveBranches, 1);
  });

  it('selects complementary branches for DEEP execution', () => {
    const plan = selectLiveProviderPlan({ ...FIRES_REQUEST, researchExecution: 'DEEP' });
    assert.equal(plan.execution, RESEARCH_EXECUTION.DEEP);
    assert.ok(plan.branches.length >= 2);
    assert.ok(plan.branches.length <= 3);
  });

  it('FAST activates one fallback when primary unavailable', async () => {
    const result = await retrieveLiveIntelligenceCandidates(FIRES_REQUEST, {
      simulatePrimaryUnavailable: true,
      providerChain: [
        {
          workerId: 'gemini-live-retrieval',
          providerLabel: 'GEMINI',
          traceProvider: 'GEMINI',
          retrievalProvider: 'gemini-google-search-v1',
          researchOrigin: 'gemini-google-search',
          sourceFamilies: ['GOOGLE_SEARCH'],
          isConfigured: () => true,
          gather: async () => { throw new Error('quota exceeded'); }
        },
        {
          workerId: 'grok-live-retrieval',
          providerLabel: 'GROK_XAI',
          traceProvider: 'GROK_XAI',
          retrievalProvider: 'grok-xai-search-v1',
          researchOrigin: 'grok-xai-search',
          sourceFamilies: ['SOCIAL_X'],
          isConfigured: () => true,
          gather: async () => ({
            candidates: [{
              title: 'Fallback fire',
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
    assert.ok(isRetryableLiveRetrievalFailure(new Error('quota exceeded')));
  });

  it('builds coverage receipt with degraded reason codes', () => {
    const receipt = buildCoverageReceipt({
      execution: RESEARCH_EXECUTION.FAST,
      liveResult: { fallbackUsed: true, failures: [{ provider: 'GEMINI' }], candidates: [] },
      corpusResult: { events: [] },
      providerReceipts: [
        { provider: 'GEMINI', status: 'FAILED', sourceFamilies: ['GOOGLE_SEARCH'] },
        { provider: 'GROK_XAI', status: 'SUCCESS', sourceFamilies: ['SOCIAL_X'] }
      ]
    });
    assert.ok(receipt.degradedReasonCodes.includes(DEGRADED_REASON.LIVE_FALLBACK_USED));
    assert.ok(receipt.degradedReasonCodes.includes(DEGRADED_REASON.LIVE_PROVIDER_FAILED));
  });

  it('DEEP partial branch failure yields DEGRADED with useful results', async () => {
    const governed = await governCandidateViaAgent2(ADMITTED_EVENT, FIRES_REQUEST);
    const result = await runProgressiveIntelligenceGraph({
      ...FIRES_REQUEST,
      researchExecution: 'DEEP'
    }, {
      executeMapActionPlan: mockExecutor(),
      streamProgressiveResearch: async (_req, hooks) => {
        hooks.onFirstSource?.(ADMITTED_EVENT);
        hooks.onFirstCandidate?.(ADMITTED_EVENT);
        await hooks.onAdmittedCandidate?.(governed);
        return {
          corpusResult: { events: [] },
          liveResult: {
            partialFailure: true,
            providerReceipts: [
              { provider: 'GEMINI', status: 'SUCCESS', sourceFamilies: ['GOOGLE_SEARCH'] },
              { provider: 'OPENAI', status: 'FAILED', sourceFamilies: ['OPEN_WEB'] }
            ]
          },
          coverage: {
            degradedReasonCodes: [DEGRADED_REASON.PARTIAL_BRANCH_FAILURE]
          },
          admittedEventIds: [ADMITTED_EVENT.eventId],
          metrics: {
            execution: 'DEEP',
            corpusLatencyMs: 8,
            liveLatencyMs: 4200,
            fallbackUsed: false,
            timeToFirstSourceMs: 12,
            timeToFirstCandidateMs: 20,
            timeToFirstGovernedEventMs: 30,
            timeToFirstMappableEventMs: 35
          },
          cancelled: false
        };
      }
    });
    assert.equal(result.finalState, TASK_STATES.DEGRADED);
    assert.equal(result.pendingMapPlans.length, 1);
    assert.ok(result.coverage?.degradedReasonCodes?.length);
  });

  it('HOLD and REJECT never reach map in progressive graph', async () => {
    const holdEvent = {
      ...ADMITTED_EVENT,
      eventId: 'evt-hold',
      locationText: null,
      neighbourhood: null,
      municipality: null,
      geometry: null,
      mappable: false
    };
    const rejectEvent = { ...ADMITTED_EVENT, eventId: 'evt-reject', sourceReports: [] };
    const hold = await governCandidateViaAgent2(holdEvent, FIRES_REQUEST);
    const reject = await governCandidateViaAgent2(rejectEvent, FIRES_REQUEST);
    assert.equal(hold.admission.outcome, ADMISSION_OUTCOME.HOLD);
    assert.equal(reject.admission.outcome, ADMISSION_OUTCOME.REJECT);

    const result = await runProgressiveIntelligenceGraph(FIRES_REQUEST, {
      streamProgressiveResearch: async (_req, hooks) => {
        for (const event of [holdEvent, rejectEvent]) {
          const governed = event.eventId === 'evt-hold' ? hold : reject;
          await hooks.onHeldOrRejected?.(governed);
        }
        return {
          corpusResult: {},
          liveResult: {},
          admittedEventIds: [],
          metrics: { corpusLatencyMs: 5, liveLatencyMs: 100 },
          cancelled: false
        };
      }
    });
    assert.equal(result.pendingMapPlans.length, 0);
    assert.equal(result.mappedCount, 0);
  });
});
