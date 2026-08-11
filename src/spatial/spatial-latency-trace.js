/**
 * Spatial end-to-end latency trace — structured spans and milestones (no secrets).
 */
import { randomUUID } from 'node:crypto';

export const TRACE_HEADER = 'x-iqai-trace-id';
export const CLIENT_ORIGIN_HEADER = 'x-iqai-client-origin-ms';

/**
 * @param {string} [traceId]
 * @param {object} [options]
 */
export function createSpatialLatencyTrace(traceId = randomUUID(), options = {}) {
  const originMs = Date.now();
  const spans = [];
  const openSpans = new Map();
  const milestones = {};
  const providers = {};
  const agent2 = { calls: [], callCount: 0, totalMs: 0 };
  const geocoding = { mode: 'SERIAL', calls: [], totalMs: 0, firstSuccessMs: null };
  const fastBlocking = {
    waitedForGrok: false,
    waitedForOpenAi: false,
    waitedForDeepSeek: false,
    waitedForCorpus: false,
    unexpectedWaits: []
  };
  const providerCompletion = {};

  const elapsed = (at = Date.now()) => at - originMs;

  function ensureProvider(name) {
    if (!providers[name]) {
      providers[name] = {
        invoked: false,
        milestones: {},
        spans: [],
        completeMs: null
      };
    }
    return providers[name];
  }

  return {
    traceId,
    strategy: options.strategy || null,
    originMs,
    milestones,
    spans,
    providers,
    agent2,
    geocoding,
    fastBlocking,
    providerCompletion,

    mark(name, at = Date.now()) {
      if (milestones[name] == null) milestones[name] = elapsed(at);
    },

    startSpan(name, meta = {}) {
      const id = `${name}:${spans.length}:${Date.now()}`;
      openSpans.set(id, {
        name,
        startMs: elapsed(),
        executionMode: meta.executionMode || 'SERIAL',
        criticalPath: Boolean(meta.criticalPath),
        provider: meta.provider || null
      });
      return id;
    },

    endSpan(id, meta = {}) {
      const open = openSpans.get(id);
      if (!open) return null;
      openSpans.delete(id);
      const span = {
        name: open.name,
        startMs: open.startMs,
        durationMs: elapsed() - open.startMs,
        executionMode: meta.executionMode || open.executionMode || 'SERIAL',
        criticalPath: meta.criticalPath ?? open.criticalPath ?? false,
        provider: meta.provider || open.provider || null
      };
      spans.push(span);
      if (span.provider) {
        ensureProvider(span.provider).spans.push(span);
      }
      return span;
    },

    recordProviderInvoked(provider, at = Date.now()) {
      const entry = ensureProvider(provider);
      entry.invoked = true;
      if (entry.milestones.startMs == null) entry.milestones.startMs = elapsed(at);
    },

    recordProviderMilestone(provider, milestone, at = Date.now()) {
      const entry = ensureProvider(provider);
      entry.invoked = true;
      if (entry.milestones[milestone] == null) entry.milestones[milestone] = elapsed(at);
    },

    recordProviderComplete(provider, at = Date.now()) {
      const entry = ensureProvider(provider);
      entry.invoked = true;
      entry.completeMs = elapsed(at);
      providerCompletion[provider] = entry.completeMs;
    },

    recordAgent2Call(call = {}) {
      const durationMs = Number(call.durationMs) || 0;
      agent2.calls.push({
        name: call.name || 'agent2-rest',
        durationMs,
        roundTripMs: call.roundTripMs ?? durationMs,
        processingMs: call.processingMs ?? null
      });
      agent2.callCount += 1;
      agent2.totalMs += durationMs;
    },

    recordGeocode(call = {}) {
      const durationMs = Number(call.durationMs) || 0;
      const success = Boolean(call.success);
      geocoding.calls.push({
        index: geocoding.calls.length,
        durationMs,
        resolver: call.resolver || null,
        success,
        mappable: Boolean(call.mappable)
      });
      geocoding.totalMs += durationMs;
      if (success && geocoding.firstSuccessMs == null) {
        geocoding.firstSuccessMs = elapsed();
      }
    },

    recordFastBlocking(snapshot = {}) {
      Object.assign(fastBlocking, snapshot);
    },

    toPayload(clientTrace = null) {
      const m = { ...milestones };
      const payload = {
        traceId,
        strategy: this.strategy,
        originMs,
        milestones: {
          timeToFirstProviderByteMs: m.firstProviderByte ?? null,
          timeToFirstValidSourceMs: m.firstValidSource ?? m.firstGroundedSource ?? m.firstSource ?? null,
          timeToFirstSourceMs: m.firstGroundedSource ?? m.firstSource ?? null,
          timeToFirstCandidateMs: m.firstEventCandidate ?? null,
          timeToFirstGovernedCandidateMs: m.firstGovernedCandidate ?? null,
          timeToFirstGeocodeMs: m.firstEventGeocoded ?? geocoding.firstSuccessMs ?? null,
          timeToFirstMappableEventMs: m.firstMappableEvent ?? null,
          timeToServerReceiptMs: m.serverReceipt ?? null,
          timeToResponseReadyMs: m.responseReady ?? null,
          totalResearchCompleteMs: m.researchComplete ?? null
        },
        spans,
        providers,
        agent2,
        geocoding,
        fastBlocking,
        providerCompletion,
        criticalPath: buildCriticalPathSummary(spans, m),
        summary: buildTraceSummary(m, spans, geocoding, agent2)
      };
      if (clientTrace) {
        return mergeClientServerTrace(payload, clientTrace);
      }
      return payload;
    }
  };
}

/**
 * @param {object[]} spans
 * @param {Record<string, number>} milestones
 */
export function buildCriticalPathSummary(spans, milestones = {}) {
  const ranked = [...spans]
    .filter((span) => span.criticalPath || span.durationMs > 0)
    .sort((a, b) => b.durationMs - a.durationMs);
  const firstPointStages = [];
  const pushStage = (name, ms) => {
    if (ms != null && ms >= 0) firstPointStages.push({ stage: name, durationMs: ms });
  };
  pushStage('server_receipt', milestones.serverReceipt);
  pushStage('first_source', milestones.firstGroundedSource ?? milestones.firstSource);
  pushStage('first_candidate', milestones.firstEventCandidate);
  pushStage('first_geocode', milestones.firstEventGeocoded);
  pushStage('first_mappable', milestones.firstMappableEvent);
  pushStage('research_complete', milestones.researchComplete);
  return {
    firstRenderedFeature: ranked.slice(0, 8),
    fullResearch: ranked,
    milestonePath: firstPointStages.sort((a, b) => a.durationMs - b.durationMs)
  };
}

/**
 * @param {Record<string, number>} milestones
 * @param {object[]} spans
 * @param {object} geocoding
 * @param {object} agent2
 */
export function buildTraceSummary(milestones = {}, spans = [], geocoding = {}, agent2 = {}) {
  const firstMappable = milestones.firstMappableEvent ?? null;
  const researchComplete = milestones.researchComplete ?? null;
  const ranked = [...spans].sort((a, b) => b.durationMs - a.durationMs);
  const top = ranked[0];
  const firstPointDenominator = firstMappable || researchComplete || 1;
  return {
    firstMapPointMs: firstMappable,
    initialLayerMs: milestones.initialLayerReady ?? null,
    fullResearchMs: researchComplete,
    topBottleneck: top
      ? { stage: top.name, durationMs: top.durationMs, percent: Number(((top.durationMs / firstPointDenominator) * 100).toFixed(1)) }
      : null,
    agent2PercentOfFirstPointLatency: firstMappable
      ? Number(((agent2.totalMs / firstMappable) * 100).toFixed(1))
      : null,
    geocodingPercentOfFirstPointLatency: firstMappable
      ? Number(((geocoding.totalMs / firstMappable) * 100).toFixed(1))
      : null
  };
}

/**
 * @param {object} serverTrace
 * @param {object} clientTrace
 */
export function mergeClientServerTrace(serverTrace, clientTrace = {}) {
  const clientMilestones = clientTrace.milestones || {};
  const mergedMilestones = {
    ...serverTrace.milestones,
    timeToBrowserReceiptMs: clientMilestones.browserReceipt ?? null,
    timeToGraphicsLayerInsertMs: clientMilestones.graphicsLayerInsert ?? null,
    timeToFirstRenderedFeatureMs: clientMilestones.firstRenderedFeature ?? null,
    timeToInitialLayerReadyMs: clientMilestones.initialLayerReady ?? null,
    timeToUserRunMs: clientMilestones.userRun ?? 0
  };
  const firstRendered = mergedMilestones.timeToFirstRenderedFeatureMs;
  const agent2Total = serverTrace.agent2?.totalMs || 0;
  return {
    ...serverTrace,
    milestones: mergedMilestones,
    clientSpans: clientTrace.spans || [],
    summary: {
      ...serverTrace.summary,
      firstMapPointMs: firstRendered ?? mergedMilestones.timeToFirstMappableEventMs,
      initialLayerMs: mergedMilestones.timeToInitialLayerReadyMs,
      fullResearchMs: mergedMilestones.totalResearchCompleteMs,
      agent2PercentOfFirstPointLatency: firstRendered
        ? Number(((agent2Total / firstRendered) * 100).toFixed(1))
        : serverTrace.summary?.agent2PercentOfFirstPointLatency ?? null
    },
    humanSummary: buildHumanSummary(mergedMilestones, serverTrace)
  };
}

/**
 * @param {Record<string, number|null>} milestones
 * @param {object} serverTrace
 */
export function buildHumanSummary(milestones = {}, serverTrace = {}) {
  const fmt = (ms) => (ms == null ? 'n/a' : `${(ms / 1000).toFixed(1)} s`);
  const ranked = [...(serverTrace.spans || [])]
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, 6)
    .map((span) => `${span.name} ${(span.durationMs / 1000).toFixed(1)} s`);
  return {
    firstMapPoint: fmt(milestones.timeToFirstRenderedFeatureMs ?? milestones.timeToFirstMappableEventMs),
    initialLayer: fmt(milestones.timeToInitialLayerReadyMs),
    fullResearch: fmt(milestones.totalResearchCompleteMs),
    criticalPathLines: ranked,
    topBottleneck: serverTrace.summary?.topBottleneck || null
  };
}
