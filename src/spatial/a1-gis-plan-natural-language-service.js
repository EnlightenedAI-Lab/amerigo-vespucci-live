/**
 * Agent 1 live natural-language → GIS plan service boundary.
 * Only VALID_PLAN may proceed to execution.
 */

import crypto from 'node:crypto';
import { parseModelResponseEnvelope } from './a1-gis-plan-model-parser.js';
import {
  generateGISPlanCandidate,
  getGisPlanProviderRuntimeConfig
} from './a1-gis-plan-model-provider.js';
import { validateGISPlan } from './a1-gis-plan-validator.js';
import { adaptValidatedPlanToExecution } from './a1-gis-plan-adapter.js';
import { executeValidatedGisPlan } from './a1-gis-plan-service.js';
import { GIS_CAPABILITY_REGISTRY } from './a1-gis-capability-registry.js';
import {
  createLiveModelAuditRecord,
  recordLiveModelAudit
} from './a1-gis-plan-provenance.js';

const MAX_REQUEST_LEN = 800;

function boundedRawResponse(rawContent, maxLen = 4000) {
  const text = String(rawContent || '');
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}…`;
}

function mapProviderError(error) {
  const code = error?.code || 'MODEL_PROVIDER_ERROR';
  if (code === 'MODEL_TIMEOUT') {
    return { status: 'PROVIDER_ERROR', failureCode: 'MODEL_TIMEOUT', message: 'Live model request timed out.' };
  }
  if (code === 'RATE_LIMIT') {
    return { status: 'PROVIDER_ERROR', failureCode: 'MODEL_PROVIDER_ERROR', message: 'Live model rate limit reached.' };
  }
  if (code === 'AUTH_FAILURE' || code === 'MISSING_API_KEY') {
    return { status: 'PROVIDER_ERROR', failureCode: 'MODEL_PROVIDER_ERROR', message: 'Live model authentication failed.' };
  }
  return {
    status: 'PROVIDER_ERROR',
    failureCode: 'MODEL_PROVIDER_ERROR',
    message: error?.message || 'Live model provider failed.'
  };
}

/**
 * @param {{ text: string, context?: object, options?: object }} params
 */
export async function planNaturalLanguageGISRequest({ text, context = {}, options = {} }) {
  const requestId = crypto.randomUUID();
  const receivedAt = new Date().toISOString();
  const userRequest = String(text || '').trim();

  if (!userRequest) {
    return {
      status: 'INVALID_MODEL_OUTPUT',
      requestId,
      failureCode: 'MISSING_REQUEST',
      message: 'Request text is required.',
      gisExecuted: false
    };
  }
  if (userRequest.length > MAX_REQUEST_LEN) {
    return {
      status: 'INVALID_MODEL_OUTPUT',
      requestId,
      failureCode: 'REQUEST_TOO_LONG',
      message: 'Request exceeds maximum length.',
      gisExecuted: false
    };
  }
  if (options.alreadyValidated || context.alreadyValidated || options.skipValidation) {
    return {
      status: 'INVALID_MODEL_OUTPUT',
      requestId,
      failureCode: 'TRUST_BYPASS_REJECTED',
      message: 'Client trust-bypass flags are not permitted.',
      gisExecuted: false
    };
  }

  const runtime = getGisPlanProviderRuntimeConfig();
  /** @type {object} */
  const auditBase = {
    requestId,
    receivedAt,
    userRequest,
    contextSummary: {
      previousLocationText: context.previousLocationText || context.conversationState?.lastLocationText || null,
      previousMatchedAddress: context.previousMatchedAddress || context.conversationState?.lastMatchedAddress || null
    },
    provider: runtime.provider,
    model: runtime.model,
    providerLabel: runtime.providerLabel
  };

  let providerResult;
  try {
    providerResult = await generateGISPlanCandidate(userRequest, context, options);
  } catch (error) {
    const mapped = mapProviderError(error);
    const audit = createLiveModelAuditRecord({
      ...auditBase,
      providerStatus: 'error',
      providerErrorCode: error?.code || mapped.failureCode,
      failureCode: mapped.failureCode,
      status: mapped.status,
      gisExecuted: false
    });
    recordLiveModelAudit(audit);
    return { ...mapped, requestId, audit, gisExecuted: false };
  }

  const parsed = parseModelResponseEnvelope(providerResult.rawContent);
  if (!parsed.ok) {
    const audit = createLiveModelAuditRecord({
      ...auditBase,
      provider: providerResult.provider,
      model: providerResult.model,
      providerStatus: 'ok',
      rawCandidateResponse: boundedRawResponse(providerResult.rawContent),
      envelopeType: null,
      parseCode: parsed.code,
      status: 'INVALID_MODEL_OUTPUT',
      failureCode: parsed.code,
      gisExecuted: false
    });
    recordLiveModelAudit(audit);
    return {
      status: 'INVALID_MODEL_OUTPUT',
      requestId,
      failureCode: parsed.code,
      message: parsed.message,
      audit,
      gisExecuted: false
    };
  }

  if (parsed.type === 'NEEDS_CLARIFICATION') {
    const audit = createLiveModelAuditRecord({
      ...auditBase,
      provider: providerResult.provider,
      model: providerResult.model,
      providerStatus: 'ok',
      rawCandidateResponse: boundedRawResponse(providerResult.rawContent),
      envelopeType: parsed.type,
      clarificationQuestion: parsed.question,
      status: 'NEEDS_CLARIFICATION',
      gisExecuted: false
    });
    recordLiveModelAudit(audit);
    return {
      status: 'NEEDS_CLARIFICATION',
      requestId,
      question: parsed.question,
      audit,
      gisExecuted: false
    };
  }

  if (parsed.type === 'UNSUPPORTED') {
    const audit = createLiveModelAuditRecord({
      ...auditBase,
      provider: providerResult.provider,
      model: providerResult.model,
      providerStatus: 'ok',
      rawCandidateResponse: boundedRawResponse(providerResult.rawContent),
      envelopeType: parsed.type,
      unsupportedReason: parsed.reason,
      status: 'UNSUPPORTED',
      gisExecuted: false
    });
    recordLiveModelAudit(audit);
    return {
      status: 'UNSUPPORTED',
      requestId,
      reason: parsed.reason,
      audit,
      gisExecuted: false
    };
  }

  const validation = validateGISPlan(parsed.plan, GIS_CAPABILITY_REGISTRY, context);
  if (!validation.valid) {
    const audit = createLiveModelAuditRecord({
      ...auditBase,
      provider: providerResult.provider,
      model: providerResult.model,
      providerStatus: 'ok',
      rawCandidateResponse: boundedRawResponse(providerResult.rawContent),
      envelopeType: 'PLAN',
      candidatePlan: parsed.plan,
      validatorResult: validation,
      status: 'INVALID_MODEL_OUTPUT',
      failureCode: validation.errors?.[0]?.code || 'VALIDATION_FAILED',
      gisExecuted: false
    });
    recordLiveModelAudit(audit);
    return {
      status: 'INVALID_MODEL_OUTPUT',
      requestId,
      failureCode: validation.errors?.[0]?.code || 'VALIDATION_FAILED',
      errors: validation.errors,
      audit,
      gisExecuted: false
    };
  }

  const adaptation = adaptValidatedPlanToExecution(validation.normalizedPlan);
  const audit = createLiveModelAuditRecord({
    ...auditBase,
    provider: providerResult.provider,
    model: providerResult.model,
    providerStatus: 'ok',
    rawCandidateResponse: boundedRawResponse(providerResult.rawContent),
    envelopeType: 'PLAN',
    candidatePlan: parsed.plan,
    validatorResult: validation,
    normalizedPlan: validation.normalizedPlan,
    adaptation,
    status: 'VALID_PLAN',
    gisExecuted: false
  });
  recordLiveModelAudit(audit);

  return {
    status: 'VALID_PLAN',
    requestId,
    normalizedPlan: validation.normalizedPlan,
    diagnostics: validation.diagnostics,
    adaptation,
    provider: providerResult.provider,
    model: providerResult.model,
    providerLabel: providerResult.providerLabel,
    audit,
    gisExecuted: false
  };
}

/**
 * @param {{ text: string, context?: object, options?: object }} params
 * @param {(prompt: string, options?: object) => Promise<object>} buildMapFromPrompt
 */
export async function executeNaturalLanguageGISRequest({ text, context = {}, options = {} }, buildMapFromPrompt) {
  const planned = await planNaturalLanguageGISRequest({ text, context, options });
  if (planned.status !== 'VALID_PLAN') {
    return {
      ...planned,
      executed: false,
      supported: false,
      gisExecuted: false
    };
  }

  const executed = await executeValidatedGisPlan(planned.normalizedPlan, context, buildMapFromPrompt);
  const audit = {
    ...planned.audit,
    execution: executed.execution,
    executionPrompt: executed.adaptation?.prompt || planned.adaptation?.prompt || null,
    commandPlanId: executed.planId || null,
    gisExecuted: Boolean(executed.executed),
    settledAt: new Date().toISOString(),
    status: executed.supported ? 'VALID_PLAN_EXECUTED' : 'ENGINE_REJECTED'
  };
  recordLiveModelAudit(audit);

  return {
    status: executed.supported ? 'VALID_PLAN' : 'ENGINE_REJECTED',
    requestId: planned.requestId,
    executed: Boolean(executed.executed),
    supported: Boolean(executed.supported),
    gisExecuted: Boolean(executed.executed),
    normalizedPlan: planned.normalizedPlan,
    adaptation: planned.adaptation,
    execution: executed.execution,
    planId: executed.planId,
    provider: planned.provider,
    model: planned.model,
    audit
  };
}

export function getNaturalLanguageGisRuntimeConfig() {
  return getGisPlanProviderRuntimeConfig();
}
