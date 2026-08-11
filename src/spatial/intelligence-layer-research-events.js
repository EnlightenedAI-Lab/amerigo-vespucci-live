/**

 * Provider-neutral intelligence research orchestrator.

 */

import {

  RESEARCH_MODE,

  RESEARCH_EXECUTION,

  RESEARCH_PROVIDER,

  countGroundedSourceReports,

  createResearchPerformanceTimeline,

  dedupeResearchCandidates,

  resolveResearchExecution,

  resolveResearchMode

} from './intelligence-layer-research-contract.js';

import { loadSharedProviderEnv } from './intelligence-layer-shared-env.js';

import { buildProviderReceipt } from './intelligence-layer-provider-registry.js';

import { gatherOpenAiResearchCandidates } from './intelligence-layer-llm-research.js';

import { gatherGeminiResearchCandidates } from './intelligence-layer-gemini-research.js';

import { gatherGrokResearchCandidates } from './intelligence-layer-grok-research.js';

import { consolidateCandidatesWithDeepSeek } from './intelligence-layer-deepseek-consolidation.js';

import {

  mergeIntelligenceEvents,

  processLlmEventCandidates,

  summarizeIntelligenceEvents

} from './intelligence-layer-event-pipeline.js';

import { applyIntelligenceLayerTemporalGate, evaluateTemporalAdmission } from './intelligence-layer-temporal-gate.js';

import {
  initializeReportDispositionLedger,
  recordTemporalDisposition,
  summarizeReportDispositions
} from './report-disposition-ledger.js';



const PROVIDER_RETRIEVAL = Object.freeze({

  [RESEARCH_PROVIDER.OPENAI]: 'openai-web-search-v1',

  [RESEARCH_PROVIDER.GEMINI]: 'gemini-google-search-v1',

  [RESEARCH_PROVIDER.GROK]: 'grok-xai-search-v1'

});



function contractModeFor(mode, execution) {

  if (execution === RESEARCH_EXECUTION.DEEP) return 'deep-orchestrated';

  if (mode === RESEARCH_MODE.MULTI) return 'multi-orchestrated';

  if (mode === RESEARCH_MODE.GEMINI && execution === RESEARCH_EXECUTION.FAST) return 'gemini-fast-orchestrated';

  return `${mode.toLowerCase()}-orchestrated`;

}



function applyDeepSeekDuplicateGroups(candidates = [], consolidation = {}) {

  const groups = consolidation.duplicateGroups || [];

  if (!groups.length) return candidates;

  const drop = new Set();

  for (const group of groups) {

    if (!Array.isArray(group) || group.length < 2) continue;

    const sorted = [...group].sort((a, b) => a - b);

    for (const index of sorted.slice(1)) drop.add(index);

  }

  return candidates.filter((_, index) => !drop.has(index));

}



async function processProviderRun(run, request, performance, trace = null) {

  const grounded = (run.candidates || []).filter((candidate) =>

    Array.isArray(candidate.sourceReports) && candidate.sourceReports.some((report) => report?.url));

  if (!grounded.length) return [];



  const events = await processLlmEventCandidates(grounded, {

    ...request,

    retrievalProvider: PROVIDER_RETRIEVAL[run.provider] || 'multi-web-research-v1',

    researchOrigin: run.provider

  }, {
    trace,
    onEventProcessed(event) {
      if (!performance.marks.firstEventGeocoded) {
        performance.mark('firstEventGeocoded');
        trace?.mark('firstEventGeocoded');
      }
      if (event.mappable && event.geometry && !performance.marks.firstMappableEvent) {
        performance.mark('firstMappableEvent');
        trace?.mark('firstMappableEvent');
      }
    }
  });



  return events.map((event) => ({

    ...event,

    researchOrigin: run.provider

  }));

}



/**

 * @param {object} request

 * @param {object} [deps]

 */

export async function researchEvents(request = {}, deps = {}) {
  loadSharedProviderEnv();

  const mode = resolveResearchMode(request);
  const execution = resolveResearchExecution(request);
  const started = Date.now();
  const performance = createResearchPerformanceTimeline();
  const trace = deps.trace || null;
  if (trace) trace.strategy = execution;
  performance.mark('requestAcknowledged');
  trace?.mark('requestAcknowledged');



  const { executeIntelligenceLayerCorpusSearch } = await import('./intelligence-layer-search-handler.js');



  if (mode === RESEARCH_MODE.CORPUS) {

    const corpusResult = await executeIntelligenceLayerCorpusSearch({ ...request, useLlmResearch: false }, deps);

    performance.mark('researchComplete');

    return {

      ...corpusResult,

      researchPerformance: performance.toPayload(started),

      researchAudit: {

        mode: RESEARCH_MODE.CORPUS,

        execution,

        researchOrigin: RESEARCH_PROVIDER.CORPUS,

        openaiInvoked: false,

        geminiInvoked: false,

        grokInvoked: false,

        deepseekInvoked: false,

        iqaiCorpusInvoked: Boolean((corpusResult.events || []).length > 0)

      },

      contract: {

        version: '1.2.0',

        endpoint: 'POST /api/spatial/intelligence-layers/research',

        mode: 'corpus-orchestrated'

      }

    };

  }



  const corpusPromise = executeIntelligenceLayerCorpusSearch({ ...request, useLlmResearch: false }, deps);
  const corpusWaitSpan = trace?.startSpan('AWAIT_CORPUS', { executionMode: 'PARALLEL', criticalPath: true });

  const providerRuns = [];

  const providerErrors = [];

  const providerReceipts = [];

  const performanceHooks = {
    onGeminiSearchStarted: () => {
      performance.mark('geminiSearchStarted');
      trace?.mark('geminiSearchStarted');
      trace?.recordProviderInvoked('GEMINI');
    },
    onFirstGroundedSource: () => {
      if (!performance.marks.firstGroundedSource) {
        performance.mark('firstGroundedSource');
        trace?.mark('firstGroundedSource');
        trace?.recordProviderMilestone('GEMINI', 'firstGroundedSource');
      }
    },
    onFirstEventCandidate: () => {
      if (!performance.marks.firstEventCandidate) {
        performance.mark('firstEventCandidate');
        trace?.mark('firstEventCandidate');
        trace?.recordProviderMilestone('GEMINI', 'firstEventCandidate');
      }
    }
  };



  const isDeep = execution === RESEARCH_EXECUTION.DEEP;

  const includeOpenAi = mode === RESEARCH_MODE.OPENAI || (isDeep && Boolean(String(process.env.OPENAI_API_KEY || '').trim()));

  const includeGemini = mode === RESEARCH_MODE.GEMINI || mode === RESEARCH_MODE.MULTI || isDeep;

  const includeGrok = isDeep && Boolean(String(process.env.XAI_API_KEY || process.env.GROK_API_KEY || '').trim());



  const providerPromises = [];



  const providerCompletionTimes = {};

  if (includeGemini) {
    const span = trace?.startSpan('GEMINI_RESEARCH', { executionMode: 'PARALLEL', criticalPath: true, provider: 'GEMINI' });
    providerPromises.push(
      gatherGeminiResearchCandidates(request, { ...deps, performanceHooks })
        .then((run) => {
          providerRuns.push(run);
          providerCompletionTimes.GEMINI = Date.now() - started;
          trace?.recordProviderComplete('GEMINI');
          if (run.audit?.googleSearchInvoked) {
            trace?.recordProviderMilestone('GEMINI', 'firstGroundedSource');
          }
          if (span) trace.endSpan(span, { provider: 'GEMINI', criticalPath: true });
          if (run.receipt) providerReceipts.push(buildProviderReceipt(run.receipt));
        })

        .catch((error) => {

          providerErrors.push({ provider: RESEARCH_PROVIDER.GEMINI, error: error?.message || String(error) });

        })

    );

  }



  if (includeOpenAi) {
    const span = trace?.startSpan('OPENAI_RESEARCH', { executionMode: isDeep ? 'PARALLEL' : 'SERIAL', provider: 'OPENAI' });
    trace?.recordProviderInvoked('OPENAI');
    providerPromises.push(
      gatherOpenAiResearchCandidates(request, deps)
        .then((run) => {
          providerRuns.push(run);
          providerCompletionTimes.OPENAI = Date.now() - started;
          trace?.recordProviderComplete('OPENAI');
          if (span) trace.endSpan(span, { provider: 'OPENAI' });
          providerReceipts.push(buildProviderReceipt({

            provider: 'OPENAI',

            model: run.audit?.model,

            role: 'WEB_SCOUT',

            invoked: true,

            toolsUsed: run.audit?.webSearchInvoked ? ['WEB_SEARCH'] : [],

            sourceCount: run.candidates?.length || 0,

            latencyMs: run.latencyMs,

            status: 'SUCCESS'

          }));

        })

        .catch((error) => {

          providerErrors.push({ provider: RESEARCH_PROVIDER.OPENAI, error: error?.message || String(error) });

        })

    );

  }



  if (includeGrok) {
    const span = trace?.startSpan('GROK_RESEARCH', { executionMode: 'PARALLEL', provider: 'GROK_XAI' });
    trace?.recordProviderInvoked('GROK_XAI');
    providerPromises.push(
      gatherGrokResearchCandidates(request, deps)
        .then((run) => {
          providerRuns.push(run);
          providerCompletionTimes.GROK_XAI = Date.now() - started;
          trace?.recordProviderComplete('GROK_XAI');
          if (span) trace.endSpan(span, { provider: 'GROK_XAI' });
          if (run.receipt) providerReceipts.push(buildProviderReceipt(run.receipt));
        })

        .catch((error) => {

          providerErrors.push({ provider: RESEARCH_PROVIDER.GROK, error: error?.message || String(error) });

        })

    );

  }



  const providersAwaitSpan = trace?.startSpan('AWAIT_PROVIDERS', { executionMode: 'PARALLEL', criticalPath: true });
  await Promise.all(providerPromises);
  if (providersAwaitSpan) trace.endSpan(providersAwaitSpan, { criticalPath: true });
  const corpusResult = await corpusPromise;
  if (corpusWaitSpan) trace.endSpan(corpusWaitSpan, { criticalPath: true });
  providerCompletionTimes.IQAI_CORPUS = Date.now() - started;



  const corpusEvents = (corpusResult.events || []).filter((e) => e.evidenceOrigin === 'corpus' || e.provenance === 'corpus');

  const corpusLiveEvents = (corpusResult.events || []).filter((e) => e.evidenceOrigin === 'live' || e.provenance === 'live');



  let dedupedCandidates = dedupeResearchCandidates(providerRuns);

  let deepSeekConsolidation = { invoked: false, status: 'SKIPPED' };



  if (isDeep && dedupedCandidates.length >= 2) {
    const deepSpan = trace?.startSpan('DEEPSEEK_CONSOLIDATION', { executionMode: 'SERIAL', provider: 'DEEPSEEK' });
    trace?.recordProviderInvoked('DEEPSEEK');
    deepSeekConsolidation = await consolidateCandidatesWithDeepSeek(dedupedCandidates, request);
    trace?.recordProviderComplete('DEEPSEEK');
    if (deepSpan) trace.endSpan(deepSpan, { provider: 'DEEPSEEK' });

    if (deepSeekConsolidation.invoked && deepSeekConsolidation.receipt) {

      providerReceipts.push(buildProviderReceipt(deepSeekConsolidation.receipt));

      dedupedCandidates = applyDeepSeekDuplicateGroups(dedupedCandidates, deepSeekConsolidation);

    }

  }



  const unsupportedRejected = providerRuns.reduce((sum, run) => {

    const raw = run.candidates?.length || 0;

    const grounded = (run.candidates || []).filter((c) =>

      Array.isArray(c.sourceReports) && c.sourceReports.some((r) => r?.url)).length;

    return sum + Math.max(0, raw - grounded);

  }, 0);



  const geocodeSpan = trace?.startSpan('EVIDENCE_GEOCODING', { executionMode: 'SERIAL', criticalPath: true });
  const webEventGroups = [];
  for (const run of providerRuns) {
    webEventGroups.push(...await processProviderRun(run, request, performance, trace));
  }
  if (geocodeSpan) trace.endSpan(geocodeSpan, { criticalPath: true });



  const combinedEvents = await mergeIntelligenceEvents(corpusEvents, [

    ...webEventGroups,

    ...corpusLiveEvents

  ]);



  const sourceStats = countGroundedSourceReports(dedupedCandidates);
  const geminiAudit = providerRuns.find((run) => run.provider === RESEARCH_PROVIDER.GEMINI)?.audit || null;
  const dispositionLedger = initializeReportDispositionLedger(
    dedupedCandidates,
    geminiAudit?.googleSearchCalls?.chunks || []
  );

  const gated = applyIntelligenceLayerTemporalGate(combinedEvents, request);
  for (const event of combinedEvents) {
    const decision = evaluateTemporalAdmission(event, request);
    if (!decision.admitted) {
      recordTemporalDisposition(dispositionLedger, event, decision);
    }
  }
  for (const event of gated.events) {
    for (const report of event.sourceReports || []) {
      const url = report.sourceUrl || report.url;
      const entry = dispositionLedger.urlToEntry?.get(url);
      if (!entry) continue;
      if (event.mappable && event.geometry) {
        entry.disposition = 'MAPPED';
      } else if (event.occurredAt) {
        entry.disposition = 'CANDIDATE_CREATED';
      }
    }
  }

  const summary = summarizeIntelligenceEvents(gated.events);
  const reportDispositions = summarizeReportDispositions(dispositionLedger);
  const openAiAudit = providerRuns.find((run) => run.provider === RESEARCH_PROVIDER.OPENAI)?.audit || null;
  const grokAudit = providerRuns.find((run) => run.provider === RESEARCH_PROVIDER.GROK)?.audit || null;



  performance.mark('researchComplete');
  trace?.mark('researchComplete');
  trace?.recordFastBlocking({
    waitedForGrok: execution === RESEARCH_EXECUTION.FAST && includeGrok,
    waitedForOpenAi: execution === RESEARCH_EXECUTION.FAST && includeOpenAi,
    waitedForDeepSeek: execution === RESEARCH_EXECUTION.FAST && Boolean(deepSeekConsolidation.invoked),
    waitedForCorpus: true,
    providerCompletionMs: providerCompletionTimes,
    execution
  });

  const researchAudit = {

    mode,

    execution,

    researchOrigin: isDeep ? 'DEEP' : (mode === RESEARCH_MODE.MULTI ? 'MULTI' : (providerRuns[0]?.provider || RESEARCH_PROVIDER.CORPUS)),

    openaiInvoked: Boolean(openAiAudit),

    geminiInvoked: Boolean(geminiAudit),

    grokInvoked: Boolean(grokAudit),

    deepseekInvoked: Boolean(deepSeekConsolidation.invoked),

    iqaiCorpusInvoked: Boolean(

      openAiAudit?.iqaiCorpusInvoked

      || (corpusResult.events || []).length > 0

      || (corpusResult.corpus?.distinctEvents || 0) > 0

    ),

    webSearchInvoked: Boolean(openAiAudit?.webSearchInvoked || grokAudit?.webSearchInvoked),

    googleSearchInvoked: Boolean(geminiAudit?.googleSearchInvoked),

    xSearchInvoked: Boolean(grokAudit?.xSearchInvoked),

    openai: openAiAudit,

    gemini: geminiAudit,

    grok: grokAudit,

    deepseek: deepSeekConsolidation.invoked ? deepSeekConsolidation : null,

    providerReceipts,

    providerErrors,

    latencyMs: Date.now() - started,

    providerLatencies: Object.fromEntries(providerRuns.map((run) => [run.provider, run.latencyMs]))

  };



  const liveStatus = (researchAudit.webSearchInvoked || researchAudit.googleSearchInvoked || researchAudit.xSearchInvoked)

    ? (summary.distinctEvents > 0 ? 'SUCCESS' : 'PARTIAL')

    : 'SKIPPED';



  const warnings = [...(corpusResult.warnings || [])];

  if (providerErrors.length) {

    warnings.push(`${providerErrors.length} research provider(s) returned errors.`);

  }

  if (summary.distinctEvents === 0 && mode !== RESEARCH_MODE.CORPUS) {

    warnings.push('No evidence-backed events found after multi-provider research and corpus search.');

  }



  const researchPerformance = performance.toPayload(started);

  const categories = [...new Set(combinedEvents.map((event) => event.concept).filter(Boolean))];



  return {

    ok: true,

    searchState: 'SUCCESS',

    contractVersion: '1.3.0',

    query: request.query,

    geographicScope: request.geography,

    from: request.from,

    to: request.to,

    temporalField: request.temporalField || 'OCCURRED',

    includeLive: true,

    combined: summary,

    events: gated.events,

    corpus: corpusResult.corpus || { distinctEvents: corpusEvents.length },

    live: {

      sourceReports: sourceStats.rawSourceReports,

      distinctEvents: webEventGroups.length,

      englishSources: sourceStats.englishSources,

      frenchSources: sourceStats.frenchSources

    },

    liveRetrieval: {

      status: liveStatus,

      coverage: summary.distinctEvents > 0 ? 'OPEN_WEB_NON_EXHAUSTIVE' : 'PARTIAL',

      providerReports: [

        ...(openAiAudit?.webSearchCalls || []),

        ...(geminiAudit?.googleSearchCalls?.chunks || []),

        ...(grokAudit ? [{ provider: 'GROK_XAI', webSearch: grokAudit.webSearchInvoked, xSearch: grokAudit.xSearchInvoked }] : [])

      ]

    },

    executionStatus: summary.distinctEvents > 0 ? 'SUCCESS' : 'PARTIAL',

    warnings,

    researchAudit,

    researchPerformance,
    latencyTrace: trace?.toPayload() || null,
    traceId: trace?.traceId || request.traceId || null,

    categoryDiversity: categories,

    llmCandidates: dedupedCandidates,

    researchConsolidation: {

      unsupportedRejected,

      duplicateCandidateSets: providerRuns.length,

      deepSeekDuplicateGroups: deepSeekConsolidation.duplicateGroups?.length || 0,

      rawSourceReports: sourceStats.rawSourceReports,

      distinctSourceUrls: sourceStats.distinctUrls,

      englishSources: sourceStats.englishSources,

      frenchSources: sourceStats.frenchSources,

      domains: sourceStats.domains,

      reportDispositions

    },

    contract: {

      version: '1.3.0',

      endpoint: 'POST /api/spatial/intelligence-layers/research',

      mode: contractModeFor(mode, execution)

    }

  };

}

