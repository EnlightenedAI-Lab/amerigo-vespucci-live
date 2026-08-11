/**
 * DEV-only runtime hook: validated GIS plan → existing AppShell.runMapCommand path.
 * Does NOT enable analyst AI MAP UI or connect an LLM.
 */

import {
  formatPlanContractOverlayLines,
  recordPlanContractEvent,
  recordPlanContractFromAudit
} from './a1-gis-plan-provenance.js';
import { recordCommandBoundary } from './a1-runtime-provenance.js';

/**
 * @param {object} app — AppShell instance
 * @param {object} candidatePlan
 * @param {object} [context]
 */
export async function executeValidatedGisPlanOnApp(app, candidatePlan, context = {}) {
  recordPlanContractEvent('PLAN_RECEIVED', { source: 'dev_runtime' });

  const response = await fetch('/api/spatial/gis-plan/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan: candidatePlan, context })
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok || !body.valid) {
    recordPlanContractEvent('REJECTED', { code: body.errors?.[0]?.code || 'INVALID' });
    return {
      valid: false,
      executed: false,
      errors: body.errors || [{ code: 'VALIDATION_FAILED', message: 'Validation request failed.' }]
    };
  }

  recordPlanContractFromAudit(body.audit);

  const prompt = body.adaptation?.prompt;
  if (!prompt || typeof app?.runMapCommand !== 'function') {
    return {
      valid: true,
      executed: false,
      normalizedPlan: body.normalizedPlan,
      adaptation: body.adaptation,
      errors: [{ code: 'ADAPTER_FAILED', message: 'Validated plan could not be adapted to a prompt.' }]
    };
  }

  recordPlanContractEvent('ADAPTED', { prompt });
  const commandId = await app.runMapCommand(prompt);
  recordPlanContractEvent('COMMAND', { commandId, prompt });
  recordPlanContractEvent('SETTLED', { commandId });
  recordCommandBoundary('gisPlanContractSettled', {
    planId: body.planId,
    commandId,
    operation: body.normalizedPlan?.operation,
    dataset: body.normalizedPlan?.dataset || null
  });

  return {
    valid: true,
    executed: true,
    planId: body.planId,
    commandId,
    normalizedPlan: body.normalizedPlan,
    adaptation: body.adaptation,
    prompt
  };
}

export function initGisPlanDevRuntime(app) {
  if (typeof window === 'undefined') return;
  window.__IQAI_DEV_EXECUTE_GIS_PLAN__ = (plan, context) => executeValidatedGisPlanOnApp(app, plan, context);
  window.__IQAI_GIS_PLAN_CONTRACT_LINES__ = formatPlanContractOverlayLines;
}

export { formatPlanContractOverlayLines };
