#!/usr/bin/env node
/**
 * Phase 3 FAST / DEEP live acceptance — tests A through E.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProgressiveIntelligenceGraph, PROGRESSIVE_VERTICAL_SLICE_QUERY } from '../src/spatial/orchestrator/progressive-intelligence-coordinator.js';
import { retrieveLiveIntelligenceCandidates } from '../src/spatial/orchestrator/live-intelligence-retrieval.js';
import { governCandidateViaAgent2 } from '../src/spatial/orchestrator/govern-candidate-client.js';
import { ADMISSION_OUTCOME } from '../src/spatial/orchestrator/intelligence-admission.js';
import { TASK_STATES } from '../src/spatial/orchestrator/contracts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'artifacts', 'agent1-phase3-acceptance');

function buildRequest(days = 30, execution = 'FAST') {
  const now = new Date();
  return {
    query: PROGRESSIVE_VERTICAL_SLICE_QUERY.replace('30 days', `${days} days`),
    conceptId: 'fires',
    geography: 'Greater Montréal',
    from: new Date(now.getTime() - days * 86400000).toISOString(),
    to: now.toISOString(),
    researchExecution: execution
  };
}

const executor = async () => ({ success: true, mutatedMap: true, skippedDuplicate: false, featureKeys: ['f1'] });

async function testA() {
  const request = buildRequest(30, 'FAST');
  const result = await runProgressiveIntelligenceGraph(request, {
    sessionScope: `phase3-a:${Date.now()}`,
    executeMapActionPlan: executor
  });
  return {
    pass: result.ok && result.performance?.selectedProvider === 'GEMINI' && !result.performance?.fallbackUsed && result.mappedCount > 0,
    primaryProvider: result.performance?.selectedProvider,
    fallbackUsed: result.performance?.fallbackUsed,
    mappedCount: result.mappedCount,
    performance: result.performance
  };
}

async function testB() {
  const request = buildRequest(30, 'FAST');
  const result = await runProgressiveIntelligenceGraph(request, {
    sessionScope: `phase3-b:${Date.now()}`,
    executeMapActionPlan: executor,
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
            eventId: 'evt-fallback-fire',
            concept: 'fires',
            title: 'Fallback warehouse fire',
            description: 'Structure fire reported in Montréal',
            occurredAt: '2026-07-15T14:00:00.000Z',
            publishedAt: '2026-07-15T15:00:00.000Z',
            locationText: 'Rue Notre-Dame, Montréal',
            municipality: 'Montréal',
            neighbourhood: 'Vieux-Port',
            mappable: true,
            geometry: { type: 'Point', coordinates: [-73.553, 45.501] },
            sourceReports: [{
              url: `https://www.cbc.ca/news/canada/montreal/fallback-fire-${Date.now()}`,
              publisher: 'CBC',
              title: 'Warehouse fire',
              publishedAt: '2026-07-15T15:00:00.000Z',
              evidenceOrigin: 'live'
            }]
          }]
        })
      }
    ]
  });
  return {
    pass: result.performance?.fallbackUsed === true && result.mappedCount > 0,
    primaryProvider: result.performance?.selectedProvider,
    fallbackUsed: result.performance?.fallbackUsed,
    finalState: result.finalState,
    performance: result.performance
  };
}

async function testC() {
  const request = buildRequest(90, 'DEEP');
  const result = await runProgressiveIntelligenceGraph(request, {
    sessionScope: `phase3-c:${Date.now()}`,
    executeMapActionPlan: executor
  });
  const branches = result.selectionPlan?.branches?.length || result.coverage?.liveProvidersAttempted?.length || 0;
  return {
    pass: result.ok && branches >= 2 && result.performance?.timeToFirstGovernedEventMs != null,
    branches,
    coverage: result.coverage,
    finalState: result.finalState,
    performance: result.performance
  };
}

async function testD() {
  const request = buildRequest(30, 'DEEP');
  const retrieval = await retrieveLiveIntelligenceCandidates(request, {
    selectionPlan: {
      execution: 'DEEP',
      branches: [
        {
          providerLabel: 'GEMINI',
          workerId: 'gemini-live-retrieval',
          traceProvider: 'GEMINI',
          retrievalProvider: 'gemini-google-search-v1',
          researchOrigin: 'gemini-google-search',
          sourceFamilies: ['GOOGLE_SEARCH'],
          isConfigured: () => true,
          gather: async () => ({
            candidates: [{
              title: 'Branch fire',
              occurredAt: request.to,
              locationText: 'Montréal',
              sourceReports: [{ url: 'https://example.com/branch-fire' }]
            }]
          })
        },
        {
          providerLabel: 'OPENAI',
          workerId: 'openai-live-retrieval',
          traceProvider: 'OPENAI',
          retrievalProvider: 'openai-web-search-v1',
          researchOrigin: 'openai-web-research',
          sourceFamilies: ['OPEN_WEB'],
          isConfigured: () => true,
          gather: async () => { throw new Error('provider timeout'); }
        }
      ]
    }
  });
  return {
    pass: retrieval.partialFailure && retrieval.candidates.length > 0,
    partialFailure: retrieval.partialFailure,
    candidateCount: retrieval.candidates.length
  };
}

async function testE() {
  const request = buildRequest(30, 'FAST');
  const hold = await governCandidateViaAgent2({
    eventId: 'evt-gov-hold',
    title: 'Unknown fire',
    occurredAt: request.from,
    publishedAt: request.to,
    sourceReports: [{ url: 'https://www.cbc.ca/news/canada/montreal/hold-fire' }]
  }, request);
  const reject = await governCandidateViaAgent2({
    eventId: 'evt-gov-reject',
    title: 'No source fire',
    occurredAt: request.from,
    sourceReports: []
  }, request);
  const result = await runProgressiveIntelligenceGraph(request, {
    streamProgressiveResearch: async (_req, hooks) => {
      await hooks.onHeldOrRejected?.({ admission: hold.admission, admitted: false });
      await hooks.onHeldOrRejected?.({ admission: reject.admission, admitted: false });
      return {
        corpusResult: {},
        liveResult: {},
        admittedEventIds: [],
        metrics: { corpusLatencyMs: 5, liveLatencyMs: 50 },
        cancelled: false
      };
    }
  });
  return {
    pass: hold.admission.outcome === ADMISSION_OUTCOME.HOLD
      && reject.admission.outcome === ADMISSION_OUTCOME.REJECT
      && result.pendingMapPlans.length === 0,
    hold: hold.admission.outcome,
    reject: reject.admission.outcome,
    mapPlans: result.pendingMapPlans.length
  };
}

async function main() {
  const payload = {
    generatedAt: new Date().toISOString(),
    testA: await testA(),
    testB: await testB(),
    testC: await testC(),
    testD: await testD(),
    testE: await testE()
  };
  payload.summary = {
    pass: ['testA', 'testB', 'testC', 'testD', 'testE'].every((k) => payload[k].pass),
    phase2BaselineMs: 45000,
    testAPerformance: payload.testA.performance
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'latest.json'), JSON.stringify(payload, null, 2));
  console.log(JSON.stringify(payload, null, 2));
  process.exit(payload.summary.pass ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
