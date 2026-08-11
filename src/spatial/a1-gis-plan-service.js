/**
 * Agent 1 GIS plan contract orchestration — validate, adapt, optional execute.
 */

import crypto from 'node:crypto';
import { GIS_CAPABILITY_REGISTRY } from './a1-gis-capability-registry.js';
import { validateGISPlan } from './a1-gis-plan-validator.js';
import { adaptValidatedPlanToExecution } from './a1-gis-plan-adapter.js';
import { createPlanAuditRecord, recordPlanAudit } from './a1-gis-plan-provenance.js';

/**
 * @param {unknown} candidatePlan
 * @param {object} [context]
 */
export function processGisPlan(candidatePlan, context = {}) {
  const planId = crypto.randomUUID();
  const receivedAt = new Date().toISOString();
  const validation = validateGISPlan(candidatePlan, GIS_CAPABILITY_REGISTRY, context);

  if (!validation.valid) {
    const audit = createPlanAuditRecord({
      planId,
      receivedAt,
      candidatePlan,
      validation,
      adapted: null,
      execution: null
    });
    recordPlanAudit(audit);
    return {
      planId,
      valid: false,
      errors: validation.errors,
      audit
    };
  }

  const adapted = adaptValidatedPlanToExecution(validation.normalizedPlan);
  const audit = createPlanAuditRecord({
    planId,
    receivedAt,
    candidatePlan,
    validation,
    adapted,
    execution: null
  });
  recordPlanAudit(audit);

  return {
    planId,
    valid: true,
    normalizedPlan: validation.normalizedPlan,
    diagnostics: validation.diagnostics,
    adaptation: adapted,
    audit
  };
}

/**
 * Validate and adapt only — never executes GIS.
 * @param {unknown} candidatePlan
 * @param {object} [context]
 */
export function validateAndAdaptGisPlan(candidatePlan, context = {}) {
  return processGisPlan(candidatePlan, context);
}

/**
 * Validate, adapt, then route through the existing deterministic mapper.
 * Invalid plans never reach buildMapFromPrompt.
 *
 * @param {unknown} candidatePlan
 * @param {object} context
 * @param {(prompt: string, options?: object) => Promise<object>} buildMapFromPrompt
 */
export async function executeValidatedGisPlan(candidatePlan, context, buildMapFromPrompt) {
  const processed = processGisPlan(candidatePlan, context);
  if (!processed.valid) {
    return {
      ...processed,
      executed: false,
      supported: false
    };
  }

  const prompt = processed.adaptation.prompt;
  let result;
  try {
    result = await buildMapFromPrompt(prompt, { context });
  } catch (error) {
    const audit = {
      ...processed.audit,
      execution: {
        prompt,
        supported: false,
        operation: processed.normalizedPlan.operation,
        dataset: processed.normalizedPlan.dataset || null,
        status: 'engine_error',
        message: error?.message || 'Engine execution failed'
      },
      settledAt: new Date().toISOString()
    };
    recordPlanAudit(audit);
    return {
      planId: processed.planId,
      valid: true,
      executed: true,
      supported: false,
      status: 'ENGINE_REJECTED',
      normalizedPlan: processed.normalizedPlan,
      diagnostics: processed.diagnostics,
      adaptation: processed.adaptation,
      execution: null,
      audit,
      gisExecuted: true,
      engineError: error?.message || 'Engine execution failed'
    };
  }
  const audit = {
    ...processed.audit,
    execution: {
      prompt,
      supported: Boolean(result?.supported),
      operation: processed.normalizedPlan.operation,
      dataset: processed.normalizedPlan.dataset || null,
      status: result?.supported ? 'settled_request' : 'rejected_by_engine'
    },
    settledAt: new Date().toISOString()
  };
  recordPlanAudit(audit);

  return {
    planId: processed.planId,
    valid: true,
    executed: true,
    supported: Boolean(result?.supported),
    normalizedPlan: processed.normalizedPlan,
    diagnostics: processed.diagnostics,
    adaptation: processed.adaptation,
    execution: result,
    audit
  };
}
