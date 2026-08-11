/**
 * Client cross-agent spatial analysis orchestration.
 */
import { executeAnalyticalMapActionPlan } from './analytical-map-action-executor.js';
import { createClientLatencyTrace } from '../spatial-latency-trace.js';
import { projectProgressiveOrchestratorStatus } from './progressive-orchestrator-status.js';

const CROSS_AGENT_PATH = '/api/spatial/orchestrator/cross-agent-spatial-analysis';

/**
 * @param {string} prompt
 * @param {object} options
 */
export async function runCrossAgentSpatialCommand(prompt, options = {}) {
  const appShell = options.appShell;
  const trace = options.trace || createClientLatencyTrace({
    strategy: 'CROSS_AGENT_SPATIAL_ANALYSIS_V1',
    traceId: options.traceId || null
  });
  trace.mark('userRun');
  appShell?.setOrchestratorStatus?.(projectProgressiveOrchestratorStatus('UNDERSTANDING'));

  const submitStarted = performance.now();
  const response = await fetch(CROSS_AGENT_PATH, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-iqai-trace-id': trace.traceId
    },
    body: JSON.stringify({
      query: prompt,
      conceptId: options.conceptId || 'fires',
      geography: options.geography || 'Greater Montréal',
      traceId: trace.traceId,
      sessionScope: options.sessionScope || `cross:${options.commandId || trace.traceId}`,
      proximityThresholdMeters: options.proximityThresholdMeters || 2000
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `Cross-agent HTTP ${response.status}`);
  }

  let mappedCount = 0;
  let eventsMapped = 0;
  let referencesMapped = 0;
  let timeToFirstRenderedFeatureMs = null;
  const executions = [];
  for (const plan of body.analyticalPlans || []) {
    const receipt = await executeAnalyticalMapActionPlan(plan, {
      graphId: body.graph?.graphId,
      traceId: trace.traceId,
      idempotencyKey: plan.planId,
      trace
    });
    executions.push(receipt);
    if (receipt.mutatedMap) {
      mappedCount += 1;
      eventsMapped += receipt.eventsRendered || 0;
      referencesMapped += receipt.referenceRendered || 0;
      if (timeToFirstRenderedFeatureMs == null) {
        timeToFirstRenderedFeatureMs = performance.now() - submitStarted;
        trace.mark('firstRenderedFeature');
      }
    }
  }

  if (typeof window !== 'undefined') {
    window.__IQAI_LAST_CROSS_AGENT_RECEIPT__ = {
      ...body,
      mappedCount,
      eventsMapped,
      referencesMapped,
      governanceStats: body.progressiveResult?.governanceStats
        || body.progressiveResult?.streamResult?.governanceStats
        || null,
      performance: {
        ...(body.performance || {}),
        clientTimeToFirstRenderedFeatureMs: timeToFirstRenderedFeatureMs,
        totalInteractiveMs: performance.now() - submitStarted
      }
    };
  }

  const message = body.summary?.operatorMessage
    || body.explanation?.summary
    || `Cross-agent analysis complete — ${body.spatialFacts?.length || 0} spatial fact(s), ${mappedCount} map update(s).`;

  appShell?.setOrchestratorStatus?.(projectProgressiveOrchestratorStatus(
    mappedCount > 0 ? 'COMPLETE' : 'FAILED',
    { sourceCount: body.governedEvents?.length || 0, mappedCount }
  ));

  return {
    handled: true,
    message,
    body,
    mappedCount,
    spatialFacts: body.spatialFacts || [],
    executions,
    latencyTrace: trace.finalize({ ok: mappedCount > 0, serverBody: body, timeToFirstRenderedFeatureMs })
  };
}
