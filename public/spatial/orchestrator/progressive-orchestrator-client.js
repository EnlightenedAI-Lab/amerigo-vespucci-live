/**
 * Client progressive intelligence orchestration — Phase 2 vertical slice.
 */
import { isProgressiveIntelligenceV1Enabled } from './orchestrator-config.js';
import { executeIntelligenceMapActionPlan } from './intelligence-map-action-executor.js';
import { projectProgressiveOrchestratorStatus } from './progressive-orchestrator-status.js';
import { createClientLatencyTrace } from '../spatial-latency-trace.js';
import {
  registerIntelligenceLayer,
  updateIntelligenceLayerEntry
} from '../intelligence-layer-registry.js';
import {
  registerGovernedFromMapPayload,
  registerGovernedFromProgressiveBundle,
  registerGovernedEventsFromList
} from '../governed-event-store.js';

const PROGRESSIVE_PATH = '/api/spatial/orchestrator/progressive-intelligence';
const AI_MAP_RECEIPT_COMPLETION_PATH = '/api/spatial/ai-map/last-receipt/client-completion';
const INTERACTIVE_DEADLINE_MS = Number(
  (typeof window !== 'undefined' && window.__IQAI_SPATIAL_RUNTIME_INFO__?.interactiveIntelligenceDeadlineMs)
  || 30_000
);

export const PROGRESSIVE_VERTICAL_SLICE_QUERY =
  'Map significant fires, explosions, or hazardous-material incidents reported in Greater Montréal during the last 30 days.';

/**
 * @param {object} intent
 * @param {object} options
 */
export async function runProgressiveIntelligenceCommand(intent = {}, options = {}) {
  if (!isProgressiveIntelligenceV1Enabled()) {
    return { handled: false };
  }

  const appShell = options.appShell;
  const trace = options.trace || createClientLatencyTrace({
    strategy: 'PROGRESSIVE_INTELLIGENCE_FAST',
    traceId: options.traceId || null
  });
  trace.mark('userRun');

  let status = projectProgressiveOrchestratorStatus('UNDERSTANDING');
  appShell?.setOrchestratorStatus?.(status);

  const query = intent.query || PROGRESSIVE_VERTICAL_SLICE_QUERY;
  const layerId = `iqai-intelligence-${intent.conceptId || 'fires'}`;
  const idempotencyStore = options.idempotencyStore || new Map();
  let sourceCount = 0;
  let mappedCount = 0;
  let enriching = false;
  const submitStarted = performance.now();

  status = projectProgressiveOrchestratorStatus('RESEARCHING', { sourceCount, mappedCount });
  appShell?.setOrchestratorStatus?.(status);

  const interactiveTimer = setTimeout(() => {
    status = projectProgressiveOrchestratorStatus('RESEARCHING', {
      sourceCount,
      mappedCount,
      enriching: false,
      label: 'Researching… partial results may follow'
    });
    appShell?.setOrchestratorStatus?.(status);
  }, INTERACTIVE_DEADLINE_MS);

  const useStream = options.stream !== false;
  const requestBody = {
    query,
    conceptId: intent.conceptId || 'fires',
    geography: intent.geography || 'Greater Montréal',
    from: intent.from,
    to: intent.to,
    traceId: trace.traceId,
    sessionScope: options.sessionScope || `cmd:${options.commandId || trace.traceId}`
  };

  const onProgress = (progress) => {
    sourceCount = progress.sourceCount ?? sourceCount;
    mappedCount = progress.mappedCount ?? mappedCount;
    enriching = progress.enriching ?? enriching;
    status = projectProgressiveOrchestratorStatus(
      enriching ? 'ENRICHING' : 'RESEARCHING',
      { sourceCount, mappedCount, enriching }
    );
    appShell?.setOrchestratorStatus?.(status);
  };

  async function fetchProgressive(stream) {
    return fetch(PROGRESSIVE_PATH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-iqai-trace-id': trace.traceId
      },
      body: JSON.stringify({ ...requestBody, stream })
    });
  }

  let serverResponse = await fetchProgressive(useStream);

  clearTimeout(interactiveTimer);
  trace.mark('browserReceipt');

  let serverBody = null;
  let timeToFirstRenderedFeatureMs = null;
  const executions = [];
  let streamedOk = false;

  if (useStream && serverResponse.ok && serverResponse.body) {
    try {
      const streamed = await consumeProgressiveNdjsonStream(serverResponse, {
        layerId,
        trace,
        idempotencyStore,
        intent,
        cancelled: options.cancelled,
        submitStarted,
        onProgress
      });
      serverBody = streamed.serverBody;
      timeToFirstRenderedFeatureMs = streamed.timeToFirstRenderedFeatureMs;
      executions.push(...streamed.executions);
      mappedCount = streamed.mappedCount ?? mappedCount;
      streamedOk = Boolean(serverBody);
    } catch (streamError) {
      console.warn('[iqai-progressive] Stream consumption failed; falling back to non-stream', streamError?.message || streamError);
      streamedOk = false;
    }
  }

  // Non-stream path, or stream failed before a complete body arrived.
  // Guarantees governedEvents land in the client store for fidelity selection.
  if (!streamedOk) {
    if (useStream) {
      serverResponse = await fetchProgressive(false);
    }
    serverBody = await serverResponse.json().catch(() => ({}));
    if (!serverResponse.ok) {
      status = projectProgressiveOrchestratorStatus('FAILED');
      appShell?.setOrchestratorStatus?.(status);
      throw new Error(serverBody.error || `Progressive orchestrator HTTP ${serverResponse.status}`);
    }
    const runResult = await runClientMapExecutions(serverBody, {
      layerId,
      trace,
      idempotencyStore,
      intent,
      cancelled: options.cancelled,
      submitStarted,
      onProgress
    });
    mappedCount = runResult.mappedCount ?? mappedCount;
    executions.push(...runResult.executions);
    timeToFirstRenderedFeatureMs = runResult.timeToFirstRenderedFeatureMs
      ?? timeToFirstRenderedFeatureMs;
  } else if (
    useStream
    && !(serverBody?.governedEvents?.length)
    && !(serverBody?.pendingMapPlans?.length)
    && !(serverBody?.streamResult?.governanceStats?.candidates > 0)
  ) {
    // Stream completed empty — one non-stream recovery pass for flaky provider windows.
    try {
      const recoveryResponse = await fetchProgressive(false);
      const recoveryBody = await recoveryResponse.json().catch(() => ({}));
      if (recoveryResponse.ok && (recoveryBody?.governedEvents?.length || recoveryBody?.pendingMapPlans?.length)) {
        serverBody = recoveryBody;
        const runResult = await runClientMapExecutions(serverBody, {
          layerId,
          trace,
          idempotencyStore,
          intent,
          cancelled: options.cancelled,
          submitStarted,
          onProgress
        });
        mappedCount = runResult.mappedCount ?? mappedCount;
        executions.push(...runResult.executions);
        timeToFirstRenderedFeatureMs = runResult.timeToFirstRenderedFeatureMs
          ?? timeToFirstRenderedFeatureMs;
        streamedOk = false;
      }
    } catch (recoveryError) {
      console.warn('[iqai-progressive] Empty-stream recovery failed', recoveryError?.message || recoveryError);
    }
  }

  const finalPhase = serverBody?.finalState === 'DEGRADED' ? 'DEGRADED'
    : (mappedCount > 0 ? 'COMPLETE' : 'FAILED');
  status = projectProgressiveOrchestratorStatus(finalPhase, { sourceCount, mappedCount });
  appShell?.setOrchestratorStatus?.(status);

  const mergedPerformance = {
    ...(serverBody?.performance || {}),
    timeToFirstRenderedFeatureMs: timeToFirstRenderedFeatureMs
      ?? serverBody?.performance?.timeToFirstRenderedFeatureMs
      ?? null,
    clientTimeToFirstRenderedFeatureMs: timeToFirstRenderedFeatureMs
  };

  if (typeof window !== 'undefined') {
    window.__IQAI_LAST_PROGRESSIVE_RECEIPT__ = {
      taskGraphReceipt: serverBody?.taskGraphReceipt,
      performance: mergedPerformance,
      governanceStats: serverBody?.streamResult?.governanceStats || null,
      traceId: trace.traceId,
      mappedCount,
      governedEventCount: Array.isArray(serverBody?.governedEvents)
        ? serverBody.governedEvents.length
        : null,
      interactiveDeadlineReached: serverBody?.interactiveDeadlineReached === true,
      streamed: streamedOk
    };
  }

  const governance = serverBody?.streamResult?.governanceStats || {};
  const governedCount = Array.isArray(serverBody?.governedEvents)
    ? serverBody.governedEvents.length
    : 0;
  const message = mappedCount > 0
    ? `Mapped ${mappedCount} governed event(s) — Agent 2 ADMIT ${governance.admit || 0}, CAUTION ${governance.admitWithCaution || 0}, HOLD ${governance.hold || 0}.`
    : (governedCount > 0
      ? `Governed ${governedCount} event(s) — none mapped yet (ADMIT ${governance.admit || 0}, CAUTION ${governance.admitWithCaution || 0}, HOLD ${governance.hold || 0}, REJECT ${governance.reject || 0}).`
      : (serverBody?.interactiveDeadlineReached
        ? 'Research deadline reached — no admissible governed events mapped yet.'
        : 'No admissible events mapped for this query.'));

  await postAiMapRunReceiptClientCompletion({
    query: intent.query || intent.prompt || intent.originalText || null,
    traceId: trace.traceId,
    receiptId: serverBody?.taskGraphReceipt?.receiptId || null,
    mappedCount,
    governedCandidateCount: governedCount,
    governanceStats: governance,
    governedEvents: serverBody?.governedEvents || [],
    finalState: serverBody?.finalState || finalPhase,
    statusMessage: message,
    streamed: streamedOk,
    interactiveDeadlineReached: serverBody?.interactiveDeadlineReached === true
  });

  return {
    handled: true,
    mappedCount,
    governedEventCount: governedCount,
    governanceStats: governance,
    orchestrator: serverBody,
    mapExecutions: executions,
    latencyTrace: trace.finalize({
      ok: mappedCount > 0 || governedCount > 0,
      serverBody,
      timeToFirstRenderedFeatureMs
    }),
    message
  };
}

function registerGovernedPlans(plans = []) {
  let registered = 0;
  for (const plan of plans) {
    const payload = plan?.mapResultPayload;
    if (!payload) continue;
    const entry = registerGovernedFromMapPayload(payload);
    if (entry) registered += 1;
  }
  return registered;
}

async function consumeProgressiveNdjsonStream(response, options) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let serverBody = null;
  let timeToFirstRenderedFeatureMs = null;
  let mappedCount = 0;
  const executions = [];
  const executedPlanIds = new Set();
  /** @type {object[]} */
  const pendingExecutions = [];

  const handleLine = (line) => {
    if (!line.trim()) return;
    let event;
    try {
      event = JSON.parse(line);
    } catch (error) {
      console.warn('[iqai-progressive] Skipping malformed NDJSON line', error?.message || error);
      return;
    }
    if (event.type === 'governedEvent' && event.governed) {
      registerGovernedFromProgressiveBundle(event.governed);
      options.onProgress?.({
        sourceCount: Object.keys(
          (typeof window !== 'undefined' && window.__IQAI_GOVERNED_EVENT_STORE__) || {}
        ).length,
        mappedCount,
        enriching: false
      });
    } else if (event.type === 'mapPlan' && event.plan) {
      const planId = event.plan.planId;
      if (executedPlanIds.has(planId)) return;
      executedPlanIds.add(planId);
      // Register immediately — never block stream read on ArcGIS render.
      registerGovernedFromMapPayload(event.plan.mapResultPayload);
      pendingExecutions.push(event.plan);
      options.onProgress?.({
        sourceCount: pendingExecutions.length,
        mappedCount,
        enriching: false
      });
    } else if (event.type === 'complete') {
      serverBody = event.body || null;
    } else if (event.type === 'error') {
      throw new Error(event.error || 'Progressive stream failed');
    }
  };

  while (true) {
    let chunk;
    try {
      chunk = await reader.read();
    } catch (error) {
      console.warn('[iqai-progressive] Stream read interrupted', error?.message || error);
      buffer += decoder.decode();
      if (buffer.trim()) handleLine(buffer);
      buffer = '';
      break;
    }
    const { done, value } = chunk;
    if (value) buffer += decoder.decode(value, { stream: true });
    if (done) {
      buffer += decoder.decode();
      if (buffer.trim()) handleLine(buffer);
      buffer = '';
      break;
    }
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) handleLine(line);
  }

  // Belt-and-suspenders: complete body re-registers all governed outcomes + map plans.
  if (serverBody?.governedEvents?.length) {
    registerGovernedEventsFromList(serverBody.governedEvents);
  }
  if (serverBody?.pendingMapPlans?.length) {
    registerGovernedPlans(serverBody.pendingMapPlans);
  }

  for (const plan of pendingExecutions) {
    try {
      const receipt = await executeIntelligenceMapActionPlan(plan, {
        graphId: plan.graphId,
        traceId: options.trace?.traceId,
        idempotencyKey: plan.stableFeatureKeys?.[0] || plan.planId,
        idempotencyStore: options.idempotencyStore,
        trace: options.trace,
        cancelled: options.cancelled
      });
      executions.push(receipt);
      if (receipt.mutatedMap) {
        mappedCount += 1;
        if (timeToFirstRenderedFeatureMs == null) {
          timeToFirstRenderedFeatureMs = performance.now() - options.submitStarted;
          options.trace?.mark('firstRenderedFeature');
        }
      }
      options.onProgress?.({
        sourceCount: Math.max(pendingExecutions.length, mappedCount),
        mappedCount,
        enriching: false
      });
    } catch (error) {
      console.warn('[iqai-progressive] Map execution failed after governed registration', error?.message || error);
      executions.push({
        planId: plan.planId,
        success: false,
        mutatedMap: false,
        error: error?.message || String(error)
      });
    }
  }

  const remaining = (serverBody?.pendingMapPlans || []).filter((plan) => {
    if (executedPlanIds.has(plan.planId)) return false;
    executedPlanIds.add(plan.planId);
    return true;
  });
  if (remaining.length) {
    const runResult = await runClientMapExecutions({ ...serverBody, pendingMapPlans: remaining }, options);
    return {
      serverBody,
      timeToFirstRenderedFeatureMs: timeToFirstRenderedFeatureMs ?? runResult.timeToFirstRenderedFeatureMs,
      mappedCount: mappedCount + (runResult.mappedCount || 0),
      executions: [...executions, ...runResult.executions]
    };
  }

  if (mappedCount > 0 || pendingExecutions.length > 0) {
    const registration = registerIntelligenceLayer({
      request: options.intent,
      normalized: { mappableEvents: [], totalEvents: mappedCount || pendingExecutions.length },
      raw: serverBody,
      state: 'complete',
      lastRefreshedAt: new Date().toISOString()
    });
    updateIntelligenceLayerEntry(registration.layerId, { layerId: options.layerId });
  }

  return { serverBody, timeToFirstRenderedFeatureMs, mappedCount, executions };
}

async function runClientMapExecutions(serverBody, options) {
  const executions = [];
  let timeToFirstRenderedFeatureMs = null;
  let mappedCount = 0;
  const started = options.submitStarted ?? performance.now();

  if (serverBody?.governedEvents?.length) {
    registerGovernedEventsFromList(serverBody.governedEvents);
  }

  if (serverBody.pendingMapPlans?.length) {
    const idempotencyStore = options.idempotencyStore || new Map();
    for (const plan of serverBody.pendingMapPlans) {
      const receipt = await executeIntelligenceMapActionPlan(plan, {
        graphId: serverBody.graph?.graphId,
        traceId: options.trace?.traceId,
        idempotencyKey: plan.stableFeatureKeys?.[0] || plan.planId,
        idempotencyStore,
        trace: options.trace,
        cancelled: options.cancelled
      });
      executions.push(receipt);
      if (receipt.mutatedMap && timeToFirstRenderedFeatureMs == null) {
        timeToFirstRenderedFeatureMs = performance.now() - started;
        options.trace?.mark('firstRenderedFeature');
      }
      if (receipt.mutatedMap) mappedCount += 1;
    }
    const registration = registerIntelligenceLayer({
      request: options.intent,
      normalized: { mappableEvents: [], totalEvents: mappedCount },
      raw: serverBody,
      state: 'complete',
      lastRefreshedAt: new Date().toISOString()
    });
    updateIntelligenceLayerEntry(registration.layerId, { layerId: options.layerId });
    options.onProgress?.({
      sourceCount: serverBody.pendingMapPlans.length,
      mappedCount,
      enriching: (serverBody.enrichmentPatches || 0) > 0
    });
    return { executions, timeToFirstRenderedFeatureMs, mappedCount };
  }

  if (serverBody.executionReceipts?.length) {
    for (const receipt of serverBody.executionReceipts) {
      executions.push(receipt);
      if (receipt.mutatedMap && timeToFirstRenderedFeatureMs == null) {
        timeToFirstRenderedFeatureMs = performance.now() - started;
        options.trace?.mark('firstRenderedFeature');
      }
      if (receipt.mutatedMap) mappedCount += 1;
    }
    return { executions, timeToFirstRenderedFeatureMs, mappedCount };
  }

  const governedEvents = serverBody.streamResult?.admittedEventIds || [];
  options.onProgress?.({ sourceCount: governedEvents.length, mappedCount: 0 });

  if (serverBody.mappedFeatureKeys?.length) {
    mappedCount = serverBody.mappedCount || serverBody.mappedFeatureKeys.length;
    options.onProgress?.({
      sourceCount: governedEvents.length,
      mappedCount,
      enriching: (serverBody.enrichmentPatches || 0) > 0
    });
  }

  return {
    executions,
    timeToFirstRenderedFeatureMs: serverBody.performance?.timeToFirstRenderedFeatureMs,
    mappedCount
  };
}

function buildClientCandidateDiagnostics(governedEvents = []) {
  return governedEvents.map((entry) => {
    const eventId = entry.governedEventId
      || entry.candidate?.eventId
      || entry.admissionDecision?.eventId
      || null;
    const admission = entry.admissionDecision || entry.admission || {};
    const outcome = admission.outcome || null;
    const reasonCodes = Array.isArray(admission.reasonCodes) ? [...admission.reasonCodes] : [];
    const rejectionSummary = (outcome === 'REJECT' || outcome === 'HOLD')
      ? (reasonCodes.length ? reasonCodes.join(', ') : outcome)
      : null;
    return { eventId, outcome, reasonCodes, rejectionSummary };
  }).filter((row) => row.eventId);
}

async function postAiMapRunReceiptClientCompletion(payload = {}) {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return;
  try {
    const { getFidelitySelection } = await import('../fidelity-selection-hub.js');
    const selection = getFidelitySelection?.() || null;
    const candidates = buildClientCandidateDiagnostics(payload.governedEvents || []);
    const stats = payload.governanceStats || {};
    await fetch(AI_MAP_RECEIPT_COMPLETION_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: payload.query || null,
        traceId: payload.traceId || null,
        receiptId: payload.receiptId || null,
        mappedCount: payload.mappedCount ?? 0,
        governedCandidateCount: payload.governedCandidateCount ?? candidates.length,
        governanceCounts: {
          ADMIT: stats.admit || 0,
          ADMIT_WITH_CAUTION: stats.admitWithCaution || 0,
          HOLD: stats.hold || 0,
          REJECT: stats.reject || 0
        },
        candidateIds: candidates.map((c) => c.eventId),
        candidates,
        rejectionDiagnostics: candidates.filter((c) => c.outcome === 'REJECT' || c.outcome === 'HOLD'),
        selectedEventId: selection?.eventId || selection?.governedEventId || null,
        finalState: payload.finalState || null,
        statusMessage: payload.statusMessage || null,
        streamed: payload.streamed ?? null,
        interactiveDeadlineReached: Boolean(payload.interactiveDeadlineReached),
        clientCompletedAt: new Date().toISOString()
      })
    }).then(async (response) => {
      const body = await response.json().catch(() => ({}));
      if (body?.receipt) {
        const { publishAiMapReceiptUpdated } = await import('../reliability-top-bar.js');
        publishAiMapReceiptUpdated(body.receipt);
      }
    });
  } catch (error) {
    console.warn('[iqai-progressive] Failed to persist AI MAP run receipt completion', error?.message || error);
  }
}

export { isProgressiveIntelligenceV1Enabled };
