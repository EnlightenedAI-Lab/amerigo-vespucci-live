/**
 * In-memory GIS plan provenance for IQAI auditability.
 * Does not persist credentials or ArcGIS internals.
 */

const MAX_AUDIT_TRAIL = 80;
const MAX_LIVE_AUDIT_TRAIL = 80;

/** @type {object[]} */
const auditTrail = [];

/** @type {object[]} */
const liveModelAuditTrail = [];

/**
 * @param {object} detail
 */
export function createPlanAuditRecord(detail) {
  const validation = detail.validation || {};
  return {
    planId: detail.planId,
    schemaVersion: validation.normalizedPlan?.schemaVersion
      || detail.candidatePlan?.schemaVersion
      || null,
    receivedAt: detail.receivedAt || new Date().toISOString(),
    candidatePlan: detail.candidatePlan,
    valid: Boolean(validation.valid),
    normalizedPlan: validation.normalizedPlan || null,
    diagnostics: validation.diagnostics || [],
    errors: validation.errors || [],
    adaptation: detail.adapted || null,
    execution: detail.execution || null,
    settledAt: detail.settledAt || null
  };
}

/**
 * @param {object} detail
 */
export function createLiveModelAuditRecord(detail) {
  return {
    requestId: detail.requestId,
    receivedAt: detail.receivedAt || new Date().toISOString(),
    userRequest: detail.userRequest || null,
    contextSummary: detail.contextSummary || null,
    provider: detail.provider || null,
    model: detail.model || null,
    providerLabel: detail.providerLabel || null,
    providerStatus: detail.providerStatus || null,
    providerErrorCode: detail.providerErrorCode || null,
    rawCandidateResponse: detail.rawCandidateResponse || null,
    envelopeType: detail.envelopeType || null,
    candidatePlan: detail.candidatePlan || null,
    validatorResult: detail.validatorResult || null,
    normalizedPlan: detail.normalizedPlan || null,
    adaptation: detail.adaptation || null,
    clarificationQuestion: detail.clarificationQuestion || null,
    unsupportedReason: detail.unsupportedReason || null,
    parseCode: detail.parseCode || null,
    failureCode: detail.failureCode || null,
    status: detail.status || null,
    execution: detail.execution || null,
    executionPrompt: detail.executionPrompt || null,
    commandPlanId: detail.commandPlanId || null,
    gisExecuted: Boolean(detail.gisExecuted),
    settledAt: detail.settledAt || null
  };
}

/**
 * @param {object} record
 */
export function recordPlanAudit(record) {
  auditTrail.push(record);
  if (auditTrail.length > MAX_AUDIT_TRAIL) {
    auditTrail.splice(0, auditTrail.length - MAX_AUDIT_TRAIL);
  }
  return record;
}

/**
 * @param {object} record
 */
export function recordLiveModelAudit(record) {
  liveModelAuditTrail.push(record);
  if (liveModelAuditTrail.length > MAX_LIVE_AUDIT_TRAIL) {
    liveModelAuditTrail.splice(0, liveModelAuditTrail.length - MAX_LIVE_AUDIT_TRAIL);
  }
  return record;
}

export function getPlanAuditTrail() {
  return auditTrail.slice();
}

export function getLiveModelAuditTrail() {
  return liveModelAuditTrail.slice();
}

export function getLatestPlanAudit() {
  return auditTrail.length ? auditTrail[auditTrail.length - 1] : null;
}

export function getLatestLiveModelAudit() {
  return liveModelAuditTrail.length ? liveModelAuditTrail[liveModelAuditTrail.length - 1] : null;
}

export function clearPlanAuditTrail() {
  auditTrail.length = 0;
}

export function clearLiveModelAuditTrail() {
  liveModelAuditTrail.length = 0;
}

/**
 * @param {object} record
 */
export function formatPlanContractTrail(record) {
  if (!record) return [];
  if (!record.valid) {
    const code = record.errors?.[0]?.code || 'REJECTED';
    return ['PLAN RECEIVED', `REJECTED: ${code}`];
  }
  const lines = ['PLAN RECEIVED', 'VALIDATED', 'NORMALIZED', 'ADAPTED'];
  if (record.execution?.prompt) {
    lines.push(`PROMPT: ${record.execution.prompt}`);
    lines.push(`ENGINE: ${record.execution.status || 'pending'}`);
  }
  if (record.settledAt) lines.push('SETTLED');
  return lines;
}

/**
 * @param {object} record
 */
export function formatLiveModelContractTrail(record) {
  if (!record) return [];
  const lines = [`LIVE REQUEST: ${record.requestId || '?'}`];
  if (record.provider) lines.push(`PROVIDER: ${record.provider} / ${record.model || '?'}`);
  if (record.envelopeType) lines.push(`ENVELOPE: ${record.envelopeType}`);
  if (record.status === 'NEEDS_CLARIFICATION') {
    lines.push('NEEDS_CLARIFICATION');
    return lines;
  }
  if (record.status === 'UNSUPPORTED' || record.status === 'INVALID_MODEL_OUTPUT' || record.status === 'PROVIDER_ERROR') {
    lines.push(`REJECTED: ${record.failureCode || record.status}`);
    return lines;
  }
  if (record.status === 'VALID_PLAN' || record.status === 'VALID_PLAN_EXECUTED') {
    lines.push('PLAN RECEIVED', 'VALIDATED', 'NORMALIZED', 'ADAPTED');
    if (record.executionPrompt) lines.push(`PROMPT: ${record.executionPrompt}`);
    if (record.gisExecuted) lines.push('GIS EXECUTED');
    else lines.push('NO GIS EXECUTION');
  }
  return lines;
}
