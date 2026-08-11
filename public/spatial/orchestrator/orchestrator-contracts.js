/**
 * Browser-safe orchestrator contracts (subset).
 */
export function createMapExecutionReceipt(receipt = {}) {
  return {
    schemaVersion: '1.0.0',
    receiptId: receipt.receiptId || crypto.randomUUID(),
    planId: receipt.planId,
    graphId: receipt.graphId,
    traceId: receipt.traceId,
    actionIds: receipt.actionIds || [],
    layerIds: receipt.layerIds || [],
    featureKeys: receipt.featureKeys || [],
    success: receipt.success !== false,
    skippedDuplicate: Boolean(receipt.skippedDuplicate),
    latencyMs: receipt.latencyMs ?? null,
    mutatedMap: receipt.mutatedMap,
    createdAt: receipt.createdAt || new Date().toISOString()
  };
}

export const DETERMINISTIC_RESULTS_LAYER_ID = 'iqai-deterministic-results';
