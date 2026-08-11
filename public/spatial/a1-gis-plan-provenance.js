/**
 * DEV-only client GIS plan contract trail.
 */

const A1_GIS_PLAN_CONTRACT_VERSION = 'A1-AIMAP-CONTRACT-01';

const MAX_TRAIL = 40;

function ensureRoot() {
  if (typeof window === 'undefined') return null;
  if (!window.__IQAI_A1_GIS_PLAN_PROVENANCE__) {
    window.__IQAI_A1_GIS_PLAN_PROVENANCE__ = {
      contractVersion: A1_GIS_PLAN_CONTRACT_VERSION,
      trail: []
    };
  }
  return window.__IQAI_A1_GIS_PLAN_PROVENANCE__;
}

/**
 * @param {string} stage
 * @param {object} [detail]
 */
export function recordPlanContractEvent(stage, detail = {}) {
  const root = ensureRoot();
  if (!root) return null;
  const entry = {
    at: new Date().toISOString(),
    stage,
    ...detail
  };
  root.trail.push(entry);
  root.trail = root.trail.slice(-MAX_TRAIL);
  return entry;
}

export function getPlanContractTrail() {
  const root = ensureRoot();
  return root?.trail?.slice() || [];
}

/**
 * @param {object} audit
 */
export function recordPlanContractFromAudit(audit, commandId = null) {
  if (!audit) return;
  recordPlanContractEvent('PLAN_RECEIVED', { planId: audit.planId });
  if (!audit.valid) {
    recordPlanContractEvent('REJECTED', {
      planId: audit.planId,
      code: audit.errors?.[0]?.code || 'INVALID'
    });
    return;
  }
  recordPlanContractEvent('VALIDATED', { planId: audit.planId });
  recordPlanContractEvent('NORMALIZED', {
    planId: audit.planId,
    operation: audit.normalizedPlan?.operation,
    dataset: audit.normalizedPlan?.dataset || null
  });
  recordPlanContractEvent('ADAPTED', {
    planId: audit.planId,
    prompt: audit.adaptation?.prompt || null
  });
  if (commandId != null) {
    recordPlanContractEvent('COMMAND', { planId: audit.planId, commandId });
  }
  if (audit.settledAt || audit.execution?.status) {
    recordPlanContractEvent('SETTLED', {
      planId: audit.planId,
      commandId,
      status: audit.execution?.status || 'settled'
    });
  }
}

export function formatPlanContractOverlayLines() {
  const trail = getPlanContractTrail();
  if (!trail.length) return [];
  const last = trail[trail.length - 1];
  const lines = [`GIS PLAN CONTRACT: ${A1_GIS_PLAN_CONTRACT_VERSION}`];
  if (last.stage === 'REJECTED') {
    lines.push(`PLAN RECEIVED → REJECTED: ${last.code || 'INVALID'}`);
  } else if (last.stage === 'SETTLED') {
    lines.push(`PLAN RECEIVED → VALIDATED → NORMALIZED → ADAPTED → COMMAND #${last.commandId ?? '?'} → SETTLED`);
  } else {
    lines.push(`LAST STAGE: ${last.stage}`);
  }
  const recent = trail.slice(-6).map((entry) => `${entry.stage}${entry.code ? `: ${entry.code}` : ''}`);
  lines.push(...recent.map((line) => `  ${line}`));
  return lines;
}
