/**
 * Minimal analyst-facing orchestrator status projection.
 */
const STATUS_LABELS = Object.freeze({
  UNDERSTANDING: 'Understanding request',
  MAPPING: 'Mapping',
  COMPLETE: 'Complete',
  DEGRADED: 'Complete (degraded)',
  FAILED: 'Failed'
});

/**
 * @param {'UNDERSTANDING'|'MAPPING'|'COMPLETE'|'DEGRADED'|'FAILED'} phase
 */
export function projectOrchestratorStatus(phase) {
  return {
    schemaVersion: '1.0.0',
    phase,
    label: STATUS_LABELS[phase] || phase,
    updatedAt: new Date().toISOString()
  };
}

/**
 * @param {object} graphReceipt
 */
export function projectDevInspectorModel(graphReceipt = {}) {
  return {
    graphId: graphReceipt.graphId,
    traceId: graphReceipt.traceId,
    finalState: graphReceipt.finalState,
    cancelled: graphReceipt.cancelled,
    taskReceipts: graphReceipt.taskReceipts || [],
    milestones: graphReceipt.milestones || [],
    coordinatorOverheadMs: graphReceipt.coordinatorOverheadMs ?? null
  };
}
