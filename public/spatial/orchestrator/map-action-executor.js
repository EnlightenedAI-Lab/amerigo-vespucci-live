/**
 * MapActionPlan executor — wraps existing ArcGIS deterministic render path.
 */
import { createMapExecutionReceipt, DETERMINISTIC_RESULTS_LAYER_ID } from './orchestrator-contracts.js';

const executionStore = new Map();

/**
 * @param {object} plan
 * @param {object} options
 */
export async function executeMapActionPlan(plan, options = {}) {
  const started = performance.now();
  const store = options.idempotencyStore || executionStore;
  const key = options.idempotencyKey || plan.planId;
  const existing = store.get(key);

  if (options.cancelled) {
    return createMapExecutionReceipt({
      planId: plan.planId,
      graphId: options.graphId,
      traceId: options.traceId,
      success: false,
      skippedDuplicate: Boolean(existing),
      latencyMs: performance.now() - started,
      mutatedMap: false
    });
  }

  const renderHandler = options.renderMapResultOnRuntime;
  const mapResult = plan.mapResultPayload;
  if (!renderHandler || !mapResult) {
    return createMapExecutionReceipt({
      planId: plan.planId,
      graphId: options.graphId,
      traceId: options.traceId,
      success: false,
      latencyMs: performance.now() - started,
      mutatedMap: false
    });
  }

  if (existing?.featureKeys?.length) {
    const receipt = createMapExecutionReceipt({
      planId: plan.planId,
      graphId: options.graphId,
      traceId: options.traceId,
      actionIds: (plan.actions || []).map((action) => action.actionId),
      layerIds: [DETERMINISTIC_RESULTS_LAYER_ID],
      featureKeys: existing.featureKeys,
      success: true,
      skippedDuplicate: true,
      latencyMs: performance.now() - started
    });
    receipt.mutatedMap = false;
    return receipt;
  }

  await renderHandler(mapResult, options.renderOptions || {});
  const featureKeys = plan.stableFeatureKeys || [];
  store.set(key, { featureKeys, layerIds: [DETERMINISTIC_RESULTS_LAYER_ID] });

  const receipt = createMapExecutionReceipt({
    planId: plan.planId,
    graphId: options.graphId,
    traceId: options.traceId,
    actionIds: (plan.actions || []).map((action) => action.actionId),
    layerIds: [DETERMINISTIC_RESULTS_LAYER_ID],
    featureKeys,
    success: true,
    skippedDuplicate: false,
    latencyMs: performance.now() - started
  });
  receipt.mutatedMap = true;
  return receipt;
}

export function resetMapActionExecutorStore() {
  executionStore.clear();
}
