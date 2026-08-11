/**
 * Provider-neutral LIVE_INTELLIGENCE_RETRIEVAL — FAST / DEEP orchestration V1.
 */
import { loadSharedProviderEnv } from '../intelligence-layer-shared-env.js';
import { RESEARCH_EXECUTION, resolveResearchExecution } from '../intelligence-layer-research-contract.js';
import { buildProviderReceipt } from '../intelligence-layer-provider-registry.js';
import {
  selectLiveProviderPlan,
  liveWorkerChainFromPlan,
  FAST_FIRST_RESULT_DEADLINE_MS,
  LIVE_WORKER_DEFS
} from './live-provider-selection.js';

export const LIVE_RETRIEVAL_CAPABILITY = 'LIVE_INTELLIGENCE_RETRIEVAL';

/** @deprecated Use selectLiveProviderPlan — retained for test injection. */
const PROVIDER_CHAIN = LIVE_WORKER_DEFS;

function groundedCandidates(run = {}) {
  return (run.candidates || []).filter((candidate) =>
    Array.isArray(candidate.sourceReports) && candidate.sourceReports.some((r) => r?.url));
}

/**
 * @param {Error|string} error
 */
export function isRetryableLiveRetrievalFailure(error) {
  const message = String(error?.message || error || '');
  return /quota|rate limit|429|503|timeout|unavailable|exceeded|too many requests|deadline/i.test(message);
}

function providerReceiptFromRun(entry, run, status, latencyMs, extra = {}) {
  return buildProviderReceipt({
    provider: entry.providerLabel,
    model: run?.audit?.model || null,
    role: entry.roles?.[0] || null,
    invoked: true,
    toolsUsed: run?.audit?.googleSearchInvoked ? ['GOOGLE_SEARCH'] : [],
    sourceCount: groundedCandidates(run).length,
    latencyMs,
    status,
    sourceFamilies: entry.sourceFamilies,
    ...extra
  });
}

async function invokeWorker(entry, request, deps) {
  const trace = deps.trace || null;
  const span = trace?.startSpan('LIVE_INTELLIGENCE_RETRIEVAL', {
    executionMode: deps.parallel ? 'PARALLEL' : 'SERIAL',
    provider: entry.traceProvider,
    criticalPath: true,
    workerId: entry.workerId
  });
  trace?.recordProviderInvoked(entry.traceProvider);
  const started = Date.now();
  let firstByteAt = null;

  const performanceHooks = {
    ...deps.performanceHooks,
    onGeminiSearchStarted: () => {
      if (!firstByteAt) {
        firstByteAt = Date.now();
        deps.onProviderByte?.({ provider: entry.providerLabel, at: firstByteAt });
        trace?.mark('firstProviderByte');
        trace?.recordProviderMilestone(entry.traceProvider, 'firstByte');
      }
      deps.performanceHooks?.onGeminiSearchStarted?.();
    },
    onFirstGroundedSource: (meta) => {
      if (!firstByteAt) {
        firstByteAt = Date.now();
        deps.onProviderByte?.({ provider: entry.providerLabel, at: firstByteAt });
        trace?.mark('firstProviderByte');
      }
      deps.onFirstValidSource?.({ provider: entry.providerLabel, meta });
      trace?.mark('firstGroundedSource');
      deps.performanceHooks?.onFirstGroundedSource?.(meta);
    },
    onFirstEventCandidate: (candidate) => {
      deps.onCandidate?.(candidate, {
        provider: entry.providerLabel,
        retrievalProvider: entry.retrievalProvider,
        researchOrigin: entry.researchOrigin,
        source: 'live'
      });
      deps.performanceHooks?.onFirstEventCandidate?.(candidate);
    }
  };

  try {
    const run = await entry.gather(request, {
      ...deps,
      fastLane: deps.fastLane !== false,
      performanceHooks
    });
    const candidates = groundedCandidates(run);
    const latencyMs = Date.now() - started;
    if (span) trace.endSpan(span, { durationMs: latencyMs, provider: entry.traceProvider });
    trace?.recordProviderComplete(entry.traceProvider);

    for (const candidate of candidates) {
      deps.onCandidate?.(candidate, {
        provider: entry.providerLabel,
        retrievalProvider: entry.retrievalProvider,
        researchOrigin: entry.researchOrigin,
        source: 'live'
      });
    }

    return {
      entry,
      run,
      candidates,
      latencyMs,
      firstByteAt,
      receipt: providerReceiptFromRun(entry, run, candidates.length ? 'SUCCESS' : 'PARTIAL', latencyMs)
    };
  } catch (error) {
    const latencyMs = Date.now() - started;
    if (span) trace.endSpan(span, { error: error.message, durationMs: latencyMs });
    throw error;
  }
}

async function runWorkerWithDeadline(entry, request, deps, deadlineMs) {
  let timer;
  const deadlinePromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error('FIRST_RESULT_DEADLINE_EXCEEDED');
      err.code = 'FIRST_RESULT_DEADLINE';
      reject(err);
    }, deadlineMs);
  });
  try {
    return await Promise.race([
      invokeWorker(entry, request, deps),
      deadlinePromise
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function retrieveFastLiveIntelligence(request, deps, plan) {
  const failures = [];
  const providerReceipts = [];
  const selectionStarted = Date.now();
  const chain = deps.providerChain || liveWorkerChainFromPlan(plan);
  const eligible = chain.filter((entry) => entry.isConfigured?.() !== false);
  const deadlineMs = plan.firstResultDeadlineMs || FAST_FIRST_RESULT_DEADLINE_MS;
  const allCandidates = [];
  const seen = new Set();
  let progressiveCandidateCount = 0;
  let progressiveProvider = null;

  const wrappedDeps = {
    ...deps,
    onCandidate: (candidate, meta) => {
      progressiveCandidateCount += 1;
      if (!progressiveProvider) progressiveProvider = meta.provider;
      const key = `${candidate.title}::${candidate.occurredAt}`;
      if (!seen.has(key)) {
        seen.add(key);
        allCandidates.push(candidate);
      }
      deps.onCandidate?.(candidate, meta);
    }
  };

  if (deps.simulatePrimaryUnavailable && eligible[0]) {
    failures.push({ provider: eligible[0].providerLabel, error: 'SIMULATED_UNAVAILABLE', retryable: true });
  }

  const tryWorker = async (entry, useDeadline) => {
    try {
      const result = useDeadline
        ? await runWorkerWithDeadline(entry, request, wrappedDeps, deadlineMs)
        : await invokeWorker(entry, request, wrappedDeps);
      providerReceipts.push(result.receipt);
      for (const candidate of result.candidates) {
        const key = `${candidate.title}::${candidate.occurredAt}`;
        if (seen.has(key)) continue;
        seen.add(key);
        allCandidates.push(candidate);
      }
      return result;
    } catch (error) {
      if (progressiveCandidateCount > 0 && entry.providerLabel === progressiveProvider) {
        return {
          entry,
          run: {},
          candidates: allCandidates,
          latencyMs: Date.now() - selectionStarted,
          receipt: buildProviderReceipt({
            provider: entry.providerLabel,
            invoked: true,
            status: 'SUCCESS',
            latencyMs: Date.now() - selectionStarted,
            sourceFamilies: entry.sourceFamilies
          }),
          deadlineExceeded: error.code === 'FIRST_RESULT_DEADLINE'
        };
      }
      failures.push({
        provider: entry.providerLabel,
        error: error.message,
        retryable: isRetryableLiveRetrievalFailure(error),
        deadlineExceeded: error.code === 'FIRST_RESULT_DEADLINE'
      });
      providerReceipts.push(buildProviderReceipt({
        provider: entry.providerLabel,
        invoked: true,
        status: 'FAILED',
        latencyMs: 0,
        sourceFamilies: entry.sourceFamilies
      }));
      return null;
    }
  };

  let selected = null;
  for (let i = 0; i < eligible.length; i++) {
    const entry = eligible[i];
    if (deps.simulatePrimaryUnavailable && i === 0) continue;
    const useDeadline = i === 0 && !deps.simulatePrimaryUnavailable;
    const result = await tryWorker(entry, useDeadline);
    if (result?.candidates?.length || (progressiveCandidateCount > 0 && entry.providerLabel === progressiveProvider)) {
      selected = result || { entry, candidates: allCandidates };
      break;
    }
    if (i === 0 && eligible.length > 1) break;
  }

  if (!selected?.candidates?.length && allCandidates.length && progressiveProvider) {
    const entry = eligible.find((e) => e.providerLabel === progressiveProvider) || eligible[0];
    selected = { entry, candidates: allCandidates };
  }

  if (!selected?.candidates?.length && eligible.length > 1) {
    const fallbackEntry = deps.simulatePrimaryUnavailable ? eligible[1] : eligible.find((e, idx) => idx > 0);
    if (fallbackEntry) {
      const result = await tryWorker(fallbackEntry, false);
      if (result?.candidates?.length) selected = result;
    }
  }

  const selectionLatencyMs = Date.now() - selectionStarted;
  const providerLabel = selected?.entry?.providerLabel || progressiveProvider || null;

  return {
    capabilityId: LIVE_RETRIEVAL_CAPABILITY,
    execution: RESEARCH_EXECUTION.FAST,
    provider: providerLabel,
    workerId: selected?.entry?.workerId || null,
    retrievalProvider: selected?.entry?.retrievalProvider || null,
    researchOrigin: selected?.entry?.researchOrigin || null,
    candidates: allCandidates,
    providerReceipts,
    failures,
    selectionPlan: plan,
    selectionLatencyMs,
    latencyMs: selectionLatencyMs,
    fallbackUsed: failures.some((f) => f.error === 'SIMULATED_UNAVAILABLE' || f.retryable) && Boolean(selected),
    deadlineExceeded: failures.some((f) => f.deadlineExceeded),
    partialFailure: failures.length > 0,
    error: selected || allCandidates.length ? null : failures.map((f) => f.error).filter(Boolean).join('; ') || 'NO_ELIGIBLE_PROVIDER'
  };
}

async function retrieveDeepLiveIntelligence(request, deps, plan) {
  const failures = [];
  const providerReceipts = [];
  const selectionStarted = Date.now();
  const branches = (deps.providerChain || plan.branches || []).filter((e) => e.isConfigured?.() !== false);
  const allCandidates = [];
  const seen = new Set();

  const branchPromises = branches.map(async (entry) => {
    try {
      const result = await invokeWorker(entry, request, { ...deps, parallel: true });
      providerReceipts.push(result.receipt);
      for (const candidate of result.candidates) {
        const key = `${candidate.title}::${candidate.occurredAt}`;
        if (seen.has(key)) continue;
        seen.add(key);
        allCandidates.push(candidate);
      }
      return result;
    } catch (error) {
      failures.push({
        provider: entry.providerLabel,
        error: error.message,
        retryable: isRetryableLiveRetrievalFailure(error)
      });
      providerReceipts.push(buildProviderReceipt({
        provider: entry.providerLabel,
        invoked: true,
        status: 'FAILED',
        latencyMs: 0,
        sourceFamilies: entry.sourceFamilies
      }));
      return null;
    }
  });

  const results = await Promise.all(branchPromises);
  const successful = results.filter((r) => r?.candidates?.length);
  const primary = successful[0] || null;
  const selectionLatencyMs = Date.now() - selectionStarted;

  return {
    capabilityId: LIVE_RETRIEVAL_CAPABILITY,
    execution: RESEARCH_EXECUTION.DEEP,
    provider: primary?.entry?.providerLabel || null,
    workerId: primary?.entry?.workerId || null,
    retrievalProvider: primary?.entry?.retrievalProvider || null,
    researchOrigin: primary?.entry?.researchOrigin || null,
    candidates: allCandidates,
    providerReceipts,
    failures,
    selectionPlan: plan,
    selectionLatencyMs,
    latencyMs: selectionLatencyMs,
    fallbackUsed: false,
    partialFailure: failures.length > 0 && successful.length > 0,
    branchesAttempted: branches.length,
    branchesSucceeded: successful.length,
    error: successful.length ? null : failures.map((f) => f.error).filter(Boolean).join('; ') || 'NO_ELIGIBLE_PROVIDER'
  };
}

/**
 * @param {object} request
 * @param {object} [deps]
 */
export async function retrieveLiveIntelligenceCandidates(request = {}, deps = {}) {
  loadSharedProviderEnv();
  const execution = resolveResearchExecution(request);
  const plan = deps.selectionPlan || selectLiveProviderPlan(request, deps);

  if (execution === RESEARCH_EXECUTION.DEEP) {
    return retrieveDeepLiveIntelligence(request, deps, plan);
  }
  return retrieveFastLiveIntelligence(request, deps, plan);
}

export { PROVIDER_CHAIN, selectLiveProviderPlan };
