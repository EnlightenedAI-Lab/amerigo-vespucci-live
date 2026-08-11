/**
 * Intelligence MapActionPlan executor — ArcGIS-native GraphicsLayer upsert path.
 */
import { createMapExecutionReceipt } from './orchestrator-contracts.js';
import {
  renderIntelligenceLayer,
  upsertIntelligenceEventGraphic
} from '../intelligence-layer-map.js';
import { normalizeIntelligenceSearchResponse } from '../intelligence-layer-model.js';

const executionStore = new Map();

/**
 * @param {object} plan
 * @param {object} options
 */
export async function executeIntelligenceMapActionPlan(plan, options = {}) {
  const started = performance.now();
  const store = options.idempotencyStore || executionStore;
  const key = options.idempotencyKey || plan.planId;
  const payload = plan.mapResultPayload;
  const layerId = payload?.layerId;
  const featureKey = payload?.featureKey || plan.stableFeatureKeys?.[0];

  if (options.cancelled) {
    const receipt = createMapExecutionReceipt({
      planId: plan.planId,
      graphId: options.graphId,
      traceId: options.traceId,
      success: false,
      skippedDuplicate: Boolean(store.get(key)),
      latencyMs: performance.now() - started
    });
    receipt.mutatedMap = false;
    return receipt;
  }

  if (!payload || !layerId) {
    const receipt = createMapExecutionReceipt({
      planId: plan.planId,
      graphId: options.graphId,
      traceId: options.traceId,
      success: false,
      latencyMs: performance.now() - started
    });
    receipt.mutatedMap = false;
    return receipt;
  }

  const isUpdate = payload.patchType != null || store.has(featureKey);
  if (!isUpdate && store.has(key)) {
    const receipt = createMapExecutionReceipt({
      planId: plan.planId,
      graphId: options.graphId,
      traceId: options.traceId,
      featureKeys: store.get(key)?.featureKeys || plan.stableFeatureKeys,
      success: true,
      skippedDuplicate: true,
      latencyMs: performance.now() - started
    });
    receipt.mutatedMap = false;
    return receipt;
  }

  const event = payload.mappableEvents?.[0] || payload.events?.[0];
  let mutated = false;

  if (isUpdate && event) {
    const upsert = await upsertIntelligenceEventGraphic(layerId, event, {
      trace: options.trace,
      governedEventVersion: payload.governedEventVersion,
      patchType: payload.patchType
    });
    mutated = upsert.updated === true;
  } else {
    const normalized = normalizeIntelligenceSearchResponse({
      ok: true,
      events: payload.events || [],
      combined: { distinctEvents: (payload.events || []).length, mappable: (payload.mappableEvents || []).length }
    }, {
      query: payload.conceptId,
      conceptId: payload.conceptId,
      geography: 'Greater Montréal'
    });
    normalized.layerTitle = payload.conceptId || 'Intelligence events';
    normalized.mappableEvents = payload.mappableEvents || [];
    await renderIntelligenceLayer(layerId, normalized, { trace: options.trace });
    mutated = (payload.mappableEvents || []).length > 0;
  }

  if (featureKey) {
    store.set(featureKey, { featureKeys: [featureKey], layerIds: [layerId] });
  }
  store.set(key, { featureKeys: plan.stableFeatureKeys || [featureKey], layerIds: [layerId] });

  const receipt = createMapExecutionReceipt({
    planId: plan.planId,
    graphId: options.graphId,
    traceId: options.traceId,
    actionIds: (plan.actions || []).map((a) => a.actionId),
    layerIds: [layerId],
    featureKeys: plan.stableFeatureKeys || [featureKey],
    success: true,
    skippedDuplicate: false,
    latencyMs: performance.now() - started
  });
  receipt.mutatedMap = mutated;
  return receipt;
}

export function resetIntelligenceMapActionExecutorStore() {
  executionStore.clear();
}
