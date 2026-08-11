/**
 * Governed intelligence layer search — Agent 1 proxy over Agent 2 live-search pipeline.
 */
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { loadSharedProviderEnv, getProviderCredentialStatus } from './intelligence-layer-shared-env.js';
import { buildSpatialAiProviderRegistry } from './intelligence-layer-provider-registry.js';
import { INTELLIGENCE_CONNECTORS_ROOT } from './intelligence-routes-loader.js';
import { applyIntelligenceLayerTemporalGate } from './intelligence-layer-temporal-gate.js';
import { summarizeIntelligenceEvents } from './intelligence-layer-event-pipeline.js';
import {
  CLIENT_ORIGIN_HEADER,
  TRACE_HEADER,
  createSpatialLatencyTrace
} from './spatial-latency-trace.js';

/**
 * Apply deterministic temporal gate and refresh combined summary counts.
 * @param {object} result
 * @param {object} request
 */
export function finalizeIntelligenceLayerResult(result, request = {}, trace = null) {
  const gated = applyIntelligenceLayerTemporalGate(result.events || [], request);
  const summary = summarizeIntelligenceEvents(gated.events);
  const firstGoverned = gated.events.find((event) =>
    Array.isArray(event.sourceReports) && event.sourceReports.some((report) => report?.url));
  if (firstGoverned && trace) {
    trace.mark('firstGovernedCandidate');
  }
  const warnings = [...(result.warnings || [])];
  if (gated.temporalGate.rejected > 0) {
    warnings.push(
      `${gated.temporalGate.rejected} event(s) excluded by temporal gate (${gated.temporalGate.temporalField}).`
    );
  }
  return {
    ...result,
    events: gated.events,
    combined: {
      ...(result.combined || {}),
      distinctEvents: summary.distinctEvents,
      mappable: summary.mappable,
      unresolved: summary.unresolved,
      domains: summary.domains
    },
    temporalGate: gated.temporalGate,
    executionStatus: summary.distinctEvents > 0 ? (result.executionStatus || 'SUCCESS') : 'PARTIAL',
    warnings
  };
}

/**
 * Corpus + provider live-search path (legacy bounded retrieval).
 * @param {object} body
 * @param {object} [deps]
 */
export async function executeIntelligenceLayerCorpusSearch(body = {}, deps = {}) {
  const trace = deps.trace || null;
  const corpusSpan = trace?.startSpan('IQAI_CORPUS_SEARCH', { executionMode: 'PARALLEL', provider: 'IQAI_CORPUS' });
  trace?.recordProviderInvoked('IQAI_CORPUS');
  const agent2Started = Date.now();
  const storeRoot = deps.storeRoot
    || process.env.INTELLIGENCE_STORE_ROOT
    || resolve(INTELLIGENCE_CONNECTORS_ROOT, 'data/intelligence/store');

  const storeMod = await import(pathToFileURL(resolve(
    INTELLIGENCE_CONNECTORS_ROOT,
    'src/intelligence/storage/store-singleton.js'
  )).href);

  const liveMod = await import(pathToFileURL(resolve(
    INTELLIGENCE_CONNECTORS_ROOT,
    'src/intelligence/pipeline/live-intelligence-search.js'
  )).href);

  const store = storeMod.getIntelligenceStore(storeRoot);
  const result = await liveMod.runLiveIntelligenceSearch(store, {
    query: body.query || body.q,
    geography: body.geography || body.geographicScope,
    from: body.from,
    to: body.to,
    temporalField: body.temporalField,
    includeLive: body.includeLive,
    searchMode: body.searchMode,
    corpusMode: body.corpusMode || 'production',
    enrichWithLlm: body.enrichWithLlm,
    persistLiveFindings: body.persistLiveFindings === true
  });
  trace?.recordAgent2Call({
    name: 'live-intelligence-search',
    durationMs: Date.now() - agent2Started,
    roundTripMs: Date.now() - agent2Started
  });
  trace?.recordProviderComplete('IQAI_CORPUS');
  if (corpusSpan) trace.endSpan(corpusSpan, { criticalPath: true, provider: 'IQAI_CORPUS' });

  return {
    ok: true,
    searchState: 'SUCCESS',
    ...result,
    contract: {
      version: liveMod.LIVE_SEARCH_CONTRACT_VERSION || '1.0.0',
      endpoint: 'POST /api/spatial/intelligence-layers/research'
    }
  };
}

/**
 * Intelligence layer research — LLM orchestrated when API key present, else corpus path.
 * @param {object} body
 * @param {object} [deps]
 */
export async function executeIntelligenceLayerSearch(body = {}, deps = {}) {
  loadSharedProviderEnv();
  const trace = deps.trace
    || (body.traceId ? createSpatialLatencyTrace(body.traceId, { strategy: body.researchExecution }) : null);
  trace?.mark('serverReceipt');
  const orchestrationSpan = trace?.startSpan('SERVER_ORCHESTRATION', { executionMode: 'SERIAL', criticalPath: true });
  const useLlm = body.useLlmResearch !== false && (
    Boolean(String(process.env.OPENAI_API_KEY || '').trim())
    || Boolean(String(process.env.GEMINI_API_KEY || '').trim())
    || Boolean(String(process.env.XAI_API_KEY || process.env.GROK_API_KEY || '').trim())
  );
  if (useLlm) {
    const { researchEvents } = await import('./intelligence-layer-research-events.js');
    const result = await researchEvents(body, { ...deps, trace });
    const finalized = finalizeIntelligenceLayerResult(result, body, trace);
    trace?.mark('responseReady');
    if (orchestrationSpan) trace.endSpan(orchestrationSpan);
    return {
      ...finalized,
      traceId: trace?.traceId || body.traceId || null,
      latencyTrace: trace?.toPayload() || null
    };
  }
  const result = await executeIntelligenceLayerCorpusSearch(body, { ...deps, trace });
  const finalized = finalizeIntelligenceLayerResult(result, body, trace);
  trace?.mark('responseReady');
  if (orchestrationSpan) trace.endSpan(orchestrationSpan);
  return {
    ...finalized,
    traceId: trace?.traceId || body.traceId || null,
    latencyTrace: trace?.toPayload() || null
  };
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function handleIntelligenceProviderRegistry(req, res) {
  res.type('application/json');
  res.set('Cache-Control', 'no-store');
  loadSharedProviderEnv();
  const registry = buildSpatialAiProviderRegistry();
  const credentials = getProviderCredentialStatus();
  return res.status(200).json({
    ok: true,
    providers: registry,
    credentials: {
      GEMINI_API_KEY: credentials.GEMINI_API_KEY ? 'PRESENT' : 'ABSENT',
      GROK_API_KEY: credentials.GROK_API_KEY ? 'PRESENT' : 'ABSENT',
      XAI_API_KEY: credentials.XAI_API_KEY ? 'PRESENT' : 'ABSENT',
      DEEPSEEK_API_KEY: credentials.DEEPSEEK_API_KEY ? 'PRESENT' : 'ABSENT',
      OPENAI_API_KEY: credentials.OPENAI_API_KEY ? 'PRESENT' : 'ABSENT'
    }
  });
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function handleIntelligenceLayerSearch(req, res) {
  res.type('application/json');
  res.set('Cache-Control', 'no-store');
  try {
    const body = req.body || {};
    const traceId = String(req.get(TRACE_HEADER) || body.traceId || '').trim() || null;
    if (traceId) body.traceId = traceId;
    if (!String(body.query || body.q || '').trim()) {
      return res.status(400).json({
        ok: false,
        searchState: 'INVALID_REQUEST',
        error: 'query is required'
      });
    }
    const trace = traceId
      ? createSpatialLatencyTrace(traceId, { strategy: body.researchExecution })
      : null;
    if (trace) trace.mark('serverReceipt');
    const result = await executeIntelligenceLayerSearch(body, { trace });
    if (traceId) res.set(TRACE_HEADER, traceId);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(503).json({
      ok: false,
      searchState: 'ERROR',
      error: error?.message || 'Intelligence layer search failed'
    });
  }
}
