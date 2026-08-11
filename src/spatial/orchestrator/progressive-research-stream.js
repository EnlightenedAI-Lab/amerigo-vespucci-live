/**
 * Progressive research stream — separates CORPUS_SEARCH from LIVE_INTELLIGENCE_RETRIEVAL.
 */
import { loadSharedProviderEnv } from '../intelligence-layer-shared-env.js';
import {
  RESEARCH_MODE,
  resolveResearchMode
} from '../intelligence-layer-research-contract.js';
import { processLlmEventCandidates } from '../intelligence-layer-event-pipeline.js';
import { executeIntelligenceLayerCorpusSearch } from '../intelligence-layer-search-handler.js';
import { governCandidateViaAgent2 } from './govern-candidate-client.js';
import { retrieveLiveIntelligenceCandidates } from './live-intelligence-retrieval.js';
import { selectLiveProviderPlan } from './live-provider-selection.js';
import { buildCoverageReceipt } from './coverage-receipt.js';
import { resolveResearchExecution } from '../intelligence-layer-research-contract.js';
import { ADMISSION_OUTCOME } from './intelligence-admission.js';

const GEOCODE_CONCURRENCY = 3;

/**
 * @param {object} request
 * @param {object} hooks
 * @param {object} [deps]
 */
export async function streamProgressiveResearch(request = {}, hooks = {}, deps = {}) {
  loadSharedProviderEnv();
  const trace = deps.trace || null;
  const runStarted = deps.runStartedAt || Date.now();
  const admittedEventIds = new Set();
  const duplicateGuard = new Set();
  const governanceStats = {
    candidates: 0,
    admit: 0,
    admitWithCaution: 0,
    hold: 0,
    reject: 0,
    duplicates: 0,
    geocodeFailures: 0,
    governanceUnavailable: 0,
    mapped: 0
  };
  let firstSourceAt = null;
  let firstCandidateAt = null;
  let firstGovernedAt = null;
  let firstGeocodedAt = null;
  let firstMappableAt = null;
  let corpusLatencyMs = null;
  let liveLatencyMs = null;
  let providerSelectionLatencyMs = null;
  let selectedProvider = null;
  let fallbackUsed = false;
  let agent2RestLatencyMs = null;
  let agent2InternalLatencyMs = null;
  let firstProviderByteAt = null;
  let firstValidSourceAt = null;
  const execution = resolveResearchExecution(request);
  const selectionPlan = deps.selectionPlan || selectLiveProviderPlan(request, deps);
  let cancelled = Boolean(deps.cancelled);

  if (deps.signal) {
    deps.signal.addEventListener('abort', () => { cancelled = true; });
  }

  async function emitCandidate(rawCandidate, meta = {}) {
    if (cancelled) return null;
    if (!firstCandidateAt) {
      firstCandidateAt = Date.now();
      hooks.onFirstCandidate?.(rawCandidate, meta);
      trace?.mark('firstEventCandidate');
    }

    let event;
    if (rawCandidate.eventId && (rawCandidate.geometry || rawCandidate.mappable != null)) {
      event = rawCandidate;
    } else {
      const geocodeStarted = Date.now();
      const events = await processLlmEventCandidates([rawCandidate], {
        ...request,
        retrievalProvider: meta.retrievalProvider || 'gemini-google-search-v1',
        researchOrigin: meta.researchOrigin || 'gemini-google-search'
      }, { trace, onEventProcessed: (evt) => {
        if (!firstGeocodedAt && evt.geometry) {
          firstGeocodedAt = Date.now();
          trace?.mark('firstEventGeocoded');
        }
        if (evt.mappable && evt.geometry && !firstMappableAt) {
          firstMappableAt = Date.now();
          hooks.onFirstMappable?.(evt);
          trace?.mark('firstMappableEvent');
        }
      } });
      event = events[0];
      if (event?.geometry && !firstGeocodedAt) {
        firstGeocodedAt = Date.now();
      }
    }
    if (!event) return null;

    if (event.mappable && event.geometry && !firstMappableAt) {
      firstMappableAt = Date.now();
      hooks.onFirstMappable?.(event);
      trace?.mark('firstMappableEvent');
    }

    if (duplicateGuard.has(event.eventId)) {
      governanceStats.duplicates += 1;
      return null;
    }
    duplicateGuard.add(event.eventId);
    governanceStats.candidates += 1;

    let governed;
    try {
      governed = await governCandidateViaAgent2(event, request, {
        traceId: trace?.traceId,
        admittedEventIds: [...admittedEventIds],
        agent2Unavailable: deps.agent2Unavailable
      });
    } catch (error) {
      if (error.code === 'AGENT2_GOVERNANCE_UNAVAILABLE') {
        governanceStats.governanceUnavailable += 1;
        await hooks.onGovernanceUnavailable?.(event, error);
        return null;
      }
      throw error;
    }

    agent2RestLatencyMs = governed.agent2RestLatencyMs;
    agent2InternalLatencyMs = governed.agent2InternalLatencyMs;

    if (!firstGovernedAt && governed.admitted) {
      firstGovernedAt = Date.now();
      hooks.onFirstGoverned?.(governed);
      trace?.mark('firstGovernedCandidate');
    }

    const outcome = governed.admission?.outcome || governed.admissionDecision?.outcome;
    if (outcome === ADMISSION_OUTCOME.ADMIT) governanceStats.admit += 1;
    else if (outcome === ADMISSION_OUTCOME.ADMIT_WITH_CAUTION) governanceStats.admitWithCaution += 1;
    else if (outcome === ADMISSION_OUTCOME.HOLD) governanceStats.hold += 1;
    else if (outcome === ADMISSION_OUTCOME.REJECT) governanceStats.reject += 1;

    if (outcome === ADMISSION_OUTCOME.ADMIT || outcome === ADMISSION_OUTCOME.ADMIT_WITH_CAUTION) {
      admittedEventIds.add(event.eventId);
      const governedCandidate = governed.candidate || event;
      if (!governedCandidate.mappable || !governedCandidate.geometry) governanceStats.geocodeFailures += 1;
      await hooks.onAdmittedCandidate?.(governed, { meta, cancelled });
    } else {
      await hooks.onHeldOrRejected?.(governed, { meta, cancelled });
    }
    return governed;
  }

  const corpusStarted = Date.now();
  const corpusSpan = trace?.startSpan('CORPUS_SEARCH', {
    executionMode: 'PARALLEL',
    provider: 'IQAI_CORPUS',
    criticalPath: false
  });
  const corpusPromise = executeIntelligenceLayerCorpusSearch({
    ...request,
    useLlmResearch: false,
    includeLive: false
  }, deps).then(async (corpusResult) => {
    corpusLatencyMs = Date.now() - corpusStarted;
    if (corpusSpan) trace.endSpan(corpusSpan, { durationMs: corpusLatencyMs });
    trace?.recordProviderComplete('IQAI_CORPUS');

    const corpusEvents = (corpusResult.events || []).filter((e) =>
      e.evidenceOrigin === 'corpus' || e.provenance === 'corpus');
    for (const event of corpusEvents) {
      if (cancelled) break;
      if (!firstSourceAt) {
        firstSourceAt = Date.now();
        hooks.onFirstSource?.(event);
        trace?.mark('firstGroundedSource');
      }
      await emitCandidate({ ...event, sourceReports: event.sourceReports || [], candidateId: event.eventId }, {
        source: 'corpus',
        retrievalProvider: 'iqai-corpus-v1',
        researchOrigin: 'iqai-corpus'
      });
    }
    return corpusResult;
  }).catch((error) => {
    corpusLatencyMs = Date.now() - corpusStarted;
    if (corpusSpan) trace.endSpan(corpusSpan, { error: error.message });
    return { events: [], error: error.message };
  });

  const progressiveCandidates = new Set();

  const livePromise = (async () => {
    const mode = resolveResearchMode(request);
    if (mode === RESEARCH_MODE.CORPUS) {
      liveLatencyMs = 0;
      return { candidates: [], providerReceipts: [], selectionPlan };
    }

    const liveStarted = Date.now();
    const liveResult = await retrieveLiveIntelligenceCandidates(request, {
      ...deps,
      trace,
      selectionPlan,
      simulatePrimaryUnavailable: deps.simulatePrimaryUnavailable,
      onProviderByte: () => {
        if (!firstProviderByteAt) {
          firstProviderByteAt = Date.now();
          trace?.mark('firstProviderByte');
        }
      },
      onFirstValidSource: () => {
        if (!firstValidSourceAt) {
          firstValidSourceAt = Date.now();
          trace?.mark('firstValidSource');
        }
        if (!firstSourceAt) {
          firstSourceAt = Date.now();
          hooks.onFirstSource?.();
          trace?.mark('firstGroundedSource');
        }
      },
      onCandidate: async (candidate, meta) => {
        const key = `${candidate.title}::${(candidate.sourceReports || []).map((r) => r.url).join('|')}`;
        if (progressiveCandidates.has(key)) return;
        progressiveCandidates.add(key);
        if (!firstSourceAt) {
          firstSourceAt = Date.now();
          hooks.onFirstSource?.(candidate);
          trace?.mark('firstGroundedSource');
        }
        candidate._researchProvider = meta.provider;
        await emitCandidate(candidate, {
          source: meta.source || 'live',
          retrievalProvider: meta.retrievalProvider,
          researchOrigin: meta.researchOrigin
        });
      },
      performanceHooks: {
        onFirstGroundedSource: () => {
          if (!firstValidSourceAt) {
            firstValidSourceAt = Date.now();
            trace?.mark('firstValidSource');
          }
          if (!firstSourceAt) {
            firstSourceAt = Date.now();
            trace?.mark('firstGroundedSource');
          }
        },
        onFirstEventCandidate: () => {
          if (!firstCandidateAt) {
            firstCandidateAt = Date.now();
            trace?.mark('firstEventCandidate');
          }
        }
      }
    });

    liveLatencyMs = Date.now() - liveStarted;
    providerSelectionLatencyMs = liveResult.selectionLatencyMs;
    selectedProvider = liveResult.provider;
    fallbackUsed = liveResult.fallbackUsed;

    const grounded = liveResult.candidates || [];
    const queue = grounded.filter((candidate) => {
      const key = `${candidate.title}::${(candidate.sourceReports || []).map((r) => r.url).join('|')}`;
      return !progressiveCandidates.has(key);
    });
    const workers = Array.from({ length: Math.min(GEOCODE_CONCURRENCY, queue.length || 1) }, async () => {
      while (queue.length && !cancelled) {
        const candidate = queue.shift();
        if (!candidate) break;
        if (!firstSourceAt) {
          firstSourceAt = Date.now();
          hooks.onFirstSource?.(candidate);
        }
        candidate._researchProvider = liveResult.provider;
        await emitCandidate(candidate, {
          source: 'live',
          retrievalProvider: liveResult.retrievalProvider,
          researchOrigin: liveResult.researchOrigin
        });
      }
    });
    await Promise.all(workers);
    return liveResult;
  })().catch((error) => {
    liveLatencyMs = Date.now() - runStarted;
    return { candidates: [], error: error.message, providerReceipts: [], selectionPlan };
  });

  const [corpusResult, liveResult] = await Promise.all([corpusPromise, livePromise]);

  const coverage = buildCoverageReceipt({
    execution,
    objectiveClass: selectionPlan.objectiveClass,
    selectionPlan,
    liveResult,
    corpusResult,
    providerReceipts: liveResult.providerReceipts || [],
    admittedEventIds: [...admittedEventIds]
  });

  const metrics = {
    execution,
    corpusLatencyMs,
    liveLatencyMs,
    providerSelectionLatencyMs,
    selectedProvider,
    fallbackUsed,
    agent2RestLatencyMs,
    agent2InternalLatencyMs,
    firstProviderByteAt,
    firstValidSourceAt,
    firstSourceAt,
    firstCandidateAt,
    firstGovernedAt,
    firstGeocodedAt,
    firstMappableAt,
    timeToFirstProviderByteMs: firstProviderByteAt ? firstProviderByteAt - runStarted : null,
    timeToFirstValidSourceMs: firstValidSourceAt ? firstValidSourceAt - runStarted : null,
    timeToFirstSourceMs: firstSourceAt ? firstSourceAt - runStarted : null,
    timeToFirstCandidateMs: firstCandidateAt ? firstCandidateAt - runStarted : null,
    timeToFirstGovernedEventMs: firstGovernedAt ? firstGovernedAt - runStarted : null,
    timeToFirstGeocodedEventMs: firstGeocodedAt ? firstGeocodedAt - runStarted : null,
    timeToFirstMappableEventMs: firstMappableAt ? firstMappableAt - runStarted : null
  };

  return {
    corpusResult,
    liveResult,
    coverage,
    selectionPlan,
    admittedEventIds: [...admittedEventIds],
    governanceStats,
    metrics,
    cancelled
  };
}

export function buildIntelligenceFeatureKey(governed = {}, sessionScope = '') {
  const eventId = governed.governedEventId || governed.candidate?.eventId || 'unknown';
  return `${sessionScope}:gov:${eventId}`;
}

export function buildDataVersionPatch(prior = {}, patch = {}) {
  return {
    patchType: patch.patchType || 'additionalEvidence',
    governedEventId: prior.governedEventId,
    governedEventVersion: Number(prior.governedEventVersion || 1) + 1,
    evidenceVersion: patch.evidenceVersion || (prior.evidenceVersion || 1) + 1,
    geometryVersion: patch.geometryVersion || prior.geometryVersion || 1,
    candidate: { ...prior.candidate, ...patch.candidate },
    admission: prior.admission,
    createdAt: new Date().toISOString()
  };
}

export const PROGRESSIVE_VERTICAL_SLICE_QUERY =
  'Map significant fires, explosions, or hazardous-material incidents reported in Greater Montréal during the last 30 days.';

export function isProgressiveVerticalSliceQuery(query = '') {
  const text = String(query).toLowerCase();
  return /\b(fires?|explosions?|hazardous[-\s]?material|hazmat)\b/.test(text)
    && /\b(montr[eé]al|greater montreal)\b/i.test(text)
    && /\b(last\s+30\s+days|30\s+days|past\s+month|90\s+days|last\s+90\s+days)\b/i.test(text);
}
