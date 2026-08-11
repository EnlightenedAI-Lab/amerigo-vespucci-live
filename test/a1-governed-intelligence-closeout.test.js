import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProgressiveIntelligenceV1Enabled } from '../src/spatial/orchestrator/progressive-intelligence-config.js';
import { isProgressiveIntelligenceV1Enabled } from '../public/spatial/orchestrator/orchestrator-config.js';
import { governCandidateViaAgent2, mapEventToAgent2Candidate, GOVERN_CANDIDATE_PATH } from '../src/spatial/orchestrator/govern-candidate-client.js';
import { llmCandidateToEvent } from '../src/spatial/intelligence-layer-event-pipeline.js';
import { ADMISSION_OUTCOME } from '../src/spatial/orchestrator/intelligence-admission.js';
import { runProgressiveIntelligenceGraph } from '../src/spatial/orchestrator/progressive-intelligence-coordinator.js';

const REQUEST = {
  query: 'Find significant fires, explosions, or hazmat incidents in Montréal in the last 30 days and map them.',
  conceptId: 'fires',
  geography: 'Greater Montréal',
  from: '2026-07-01T00:00:00.000Z',
  to: '2026-08-10T00:00:00.000Z',
  temporalField: 'OCCURRED'
};

const SOURCE_BACKED_EVENT = {
  eventId: 'evt-gov-1',
  title: 'Structure fire on Rue Saint-Denis',
  occurredAt: '2026-08-01T03:00:00Z',
  publishedAt: '2026-08-01T08:00:00Z',
  occurrenceSource: 'SOURCE_EXTRACTION',
  locationText: 'Rue Saint-Denis, Montréal',
  mappable: true,
  geometry: { type: 'Point', coordinates: [-73.56, 45.51] },
  sourceReports: [{
    url: 'https://www.cbc.ca/news/canada/montreal/fire-report',
    sourceUrl: 'https://www.cbc.ca/news/canada/montreal/fire-report',
    publisher: 'CBC'
  }]
};

describe('governed intelligence default path', () => {
  it('defaults progressive intelligence ON unless explicitly disabled', () => {
    assert.equal(resolveProgressiveIntelligenceV1Enabled(undefined), true);
    assert.equal(resolveProgressiveIntelligenceV1Enabled(''), true);
    assert.equal(resolveProgressiveIntelligenceV1Enabled('false'), false);
    assert.equal(isProgressiveIntelligenceV1Enabled(), true);
  });

  it('maps occurrenceSource through Agent 2 govern-candidate contract', () => {
    const event = llmCandidateToEvent({
      title: 'Fire event',
      occurredAt: '2026-08-01T03:00:00Z',
      publishedAt: '2026-08-01T08:00:00Z',
      locationText: 'Montréal',
      sourceReports: [{ url: 'https://example.com/fire', title: 'Fire', publisher: 'News' }]
    }, 'FIRE_INCIDENT', 0, { geometry: null, mappable: false });
    const mapped = mapEventToAgent2Candidate(event);
    assert.equal(mapped.occurrenceSource, 'SOURCE_EXTRACTION');
    assert.equal(mapped.occurredAt, '2026-08-01T03:00:00Z');
    assert.notEqual(mapped.occurredAt, mapped.publishedAt);
  });

  it('uses real Agent 2 govern-candidate endpoint contract', async () => {
    const governed = await governCandidateViaAgent2(SOURCE_BACKED_EVENT, REQUEST);
    assert.equal(governed.endpoint, GOVERN_CANDIDATE_PATH);
    assert.ok([ADMISSION_OUTCOME.ADMIT, ADMISSION_OUTCOME.ADMIT_WITH_CAUTION].includes(governed.admission.outcome));
    assert.ok(governed.receipt?.receiptId || governed.receipt?.queryReceiptId);
  });
});

describe('governed intelligence negative proofs', () => {
  it('HOLD candidate does not produce map plans', async () => {
    const holdEvent = {
      ...SOURCE_BACKED_EVENT,
      eventId: 'evt-hold-1',
      locationText: null,
      neighbourhood: null,
      municipality: null,
      geometry: null,
      mappable: false
    };
    const mockStream = async (_request, hooks) => {
      const governed = await governCandidateViaAgent2(holdEvent, REQUEST);
      if (governed.admission.outcome === ADMISSION_OUTCOME.HOLD) {
        await hooks.onHeldOrRejected?.(governed);
      } else {
        await hooks.onAdmittedCandidate?.(governed);
      }
      return {
        corpusResult: { events: [] },
        liveResult: { candidates: [] },
        admittedEventIds: [],
        governanceStats: { hold: 1, mapped: 0 },
        metrics: {},
        cancelled: false
      };
    };
    const result = await runProgressiveIntelligenceGraph(REQUEST, { streamProgressiveResearch: mockStream });
    assert.equal(result.pendingMapPlans.length, 0);
    assert.equal(result.mappedCount, 0);
  });

  it('REJECT candidate does not produce map plans', async () => {
    const rejectEvent = { ...SOURCE_BACKED_EVENT, eventId: 'evt-reject-1', sourceReports: [] };
    const mockStream = async (_request, hooks) => {
      const governed = await governCandidateViaAgent2(rejectEvent, REQUEST);
      await hooks.onHeldOrRejected?.(governed);
      return {
        corpusResult: { events: [] },
        liveResult: { candidates: [] },
        admittedEventIds: [],
        governanceStats: { reject: 1, mapped: 0 },
        metrics: {},
        cancelled: false
      };
    };
    const result = await runProgressiveIntelligenceGraph(REQUEST, { streamProgressiveResearch: mockStream });
    assert.equal(result.pendingMapPlans.length, 0);
    assert.equal(result.mappedCount, 0);
  });

  it('Agent 2 outage blocks new live map mutations', async () => {
    const mockStream = async () => ({
      corpusResult: { events: [] },
      liveResult: { candidates: [], error: 'AGENT2_GOVERNANCE_UNAVAILABLE' },
      admittedEventIds: [],
      governanceStats: { governanceUnavailable: 1, mapped: 0 },
      metrics: {},
      cancelled: false
    });
    const result = await runProgressiveIntelligenceGraph(REQUEST, {
      streamProgressiveResearch: mockStream,
      agent2Unavailable: true
    });
    assert.equal(result.mappedCount, 0);
    assert.equal(result.pendingMapPlans.length, 0);
  });
});
