/**
 * AI Spatial runtime config — delegates to governed GIS plan provider boundary.
 */

import { getGisPlanProviderRuntimeConfig } from './a1-gis-plan-model-provider.js';

export function getAiSpatialRuntimeConfig() {
  return getGisPlanProviderRuntimeConfig();
}

/**
 * @deprecated Use planNaturalLanguageGISRequest from a1-gis-plan-natural-language-service.js
 */
export async function planAiSpatialRequest(userPrompt, context = {}) {
  const { planNaturalLanguageGISRequest } = await import('./a1-gis-plan-natural-language-service.js');
  const result = await planNaturalLanguageGISRequest({ text: userPrompt, context });
  if (result.status === 'VALID_PLAN') {
    return {
      supported: true,
      canonicalPrompt: result.adaptation?.prompt || null,
      interpretation: `${result.normalizedPlan.operation}${result.normalizedPlan.dataset ? ` · ${result.normalizedPlan.dataset}` : ''}`,
      planner: {
        provider: result.provider,
        model: result.model,
        providerLabel: result.providerLabel
      },
      validation: {
        action: result.normalizedPlan.operation
      },
      normalizedPlan: result.normalizedPlan,
      adaptation: result.adaptation,
      requestId: result.requestId
    };
  }
  if (result.status === 'NEEDS_CLARIFICATION') {
    return {
      supported: false,
      message: result.question,
      needsClarification: true,
      requestId: result.requestId
    };
  }
  if (result.status === 'UNSUPPORTED') {
    return {
      supported: false,
      message: result.reason,
      unsupported: true,
      requestId: result.requestId
    };
  }
  return {
    supported: false,
    message: result.message || result.errors?.[0]?.message || 'AI could not produce a supported GIS plan.',
    validationRejected: result.status === 'INVALID_MODEL_OUTPUT',
    failureCode: result.failureCode || null,
    requestId: result.requestId
  };
}
