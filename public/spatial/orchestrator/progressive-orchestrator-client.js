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

const PROGRESSIVE_PATH = '/api/spatial/orchestrator/progressive-intelligence';
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
  const serverResponse = await fetch(PROGRESSIVE_PATH, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-iqai-trace-id': trace.traceId
    },
    body: JSON.stringify({
      query,
      conceptId: intent.conceptId || 'fires',
      geography: intent.geography || 'Greater Montréal',
      from: intent.from,
      to: intent.to,
      traceId: trace.traceId,
      sessionScope: options.sessionScope || `cmd:${options.commandId || trace.traceId}`,
      stream: useStream
    })
  });

  clearTimeout(interactiveTimer);
  if (!serverResponse.ok && !useStream) {
    const serverBody = await serverResponse.json().catch(() => ({}));
    status = projectProgressiveOrchestratorStatus('FAILED');
    appShell?.setOrchestratorStatus?.(status);
    throw new Error(serverBody.error || `Progressive orchestrator HTTP ${serverResponse.status}`);
  }

  trace.mark('browserReceipt');

  let serverBody = null;
  let timeToFirstRenderedFeatureMs = null;
  const executions = [];

  if (useStream && serverResponse.body) {
    const streamed = await consumeProgressiveNdjsonStream(serverResponse, {
      layerId,
      trace,
      idempotencyStore,
      intent,
      cancelled: options.cancelled,
      submitStarted,
      onProgress: (progress) => {
        sourceCount = progress.sourceCount ?? sourceCount;
        mappedCount = progress.mappedCount ?? mappedCount;
        enriching = progress.enriching ?? enriching;
        status = projectProgressiveOrchestratorStatus(
          enriching ? 'ENRICHING' : 'RESEARCHING',
          { sourceCount, mappedCount, enriching }
        );
        appShell?.setOrchestratorStatus?.(status);
      }
    });
    serverBody = streamed.serverBody;
    timeToFirstRenderedFeatureMs = streamed.timeToFirstRenderedFeatureMs;
    executions.push(...streamed.executions);
    mappedCount = streamed.mappedCount ?? mappedCount;
  } else {
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
      onProgress: (progress) => {
        sourceCount = progress.sourceCount ?? sourceCount;
        mappedCount = progress.mappedCount ?? mappedCount;
        enriching = progress.enriching ?? enriching;
        status = projectProgressiveOrchestratorStatus(
          enriching ? 'ENRICHING' : 'RESEARCHING',
          { sourceCount, mappedCount, enriching }
        );
        appShell?.setOrchestratorStatus?.(status);
      }
    });
    mappedCount = runResult.mappedCount ?? mappedCount;
    executions.push(...runResult.executions);
    timeToFirstRenderedFeatureMs = runResult.timeToFirstRenderedFeatureMs;
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
      interactiveDeadlineReached: serverBody?.interactiveDeadlineReached === true,
      streamed: useStream
    };
  }

  const governance = serverBody?.streamResult?.governanceStats || {};
  const message = mappedCount > 0
    ? `Mapped ${mappedCount} governed event(s) — Agent 2 ADMIT ${governance.admit || 0}, CAUTION ${governance.admitWithCaution || 0}, HOLD ${governance.hold || 0}.`
    : (serverBody?.interactiveDeadlineReached
      ? 'Research deadline reached — no admissible governed events mapped yet.'
      : 'No admissible events mapped for this query.');

  return {
    handled: true,
    mappedCount,
    governanceStats: governance,
    orchestrator: serverBody,
    mapExecutions: executions,
    latencyTrace: trace.finalize({
      ok: mappedCount > 0,
      serverBody,
      timeToFirstRenderedFeatureMs
    }),
    message
  };
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

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event.type === 'mapPlan' && event.plan) {
        const planId = event.plan.planId;
        if (executedPlanIds.has(planId)) continue;
        executedPlanIds.add(planId);
        const receipt = await executeIntelligenceMapActionPlan(event.plan, {
          graphId: event.plan.graphId,
          traceId: options.trace?.traceId,
          idempotencyKey: event.plan.stableFeatureKeys?.[0] || event.plan.planId,
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
          sourceCount: mappedCount,
          mappedCount,
          enriching: false
        });
      } else if (event.type === 'complete') {
        serverBody = event.body || null;
      } else if (event.type === 'error') {
        throw new Error(event.error || 'Progressive stream failed');
      }
    }
  }

  if (serverBody?.pendingMapPlans?.length) {
    const remaining = serverBody.pendingMapPlans.filter((plan) => !executedPlanIds.has(plan.planId));
    if (remaining.length) {
      const runResult = await runClientMapExecutions({ ...serverBody, pendingMapPlans: remaining }, options);
      return {
        serverBody,
        timeToFirstRenderedFeatureMs: timeToFirstRenderedFeatureMs ?? runResult.timeToFirstRenderedFeatureMs,
        mappedCount: mappedCount + (runResult.mappedCount || 0),
        executions: [...executions, ...runResult.executions]
      };
    }
  }

  if (mappedCount > 0) {
    const registration = registerIntelligenceLayer({
      request: options.intent,
      normalized: { mappableEvents: [], totalEvents: mappedCount },
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

export { isProgressiveIntelligenceV1Enabled };
