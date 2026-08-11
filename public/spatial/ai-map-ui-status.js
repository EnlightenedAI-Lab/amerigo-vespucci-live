/**
 * Analyst-facing AI MAP status presentation — no raw JSON or engineering internals.
 */

/**
 * @param {object} body
 */
export function formatAiMapUiResponse(body = {}) {
  const status = String(body.status || '').toUpperCase();

  if (status === 'NEEDS_CLARIFICATION') {
    const question = String(body.question || body.message || '').trim()
      || 'More detail is needed before AI MAP can plan this request.';
    return {
      status,
      severity: 'info',
      message: question,
      chain: ['Planning', 'Clarification needed', 'No map change']
    };
  }

  if (status === 'UNSUPPORTED') {
    const reason = String(body.reason || body.message || '').trim();
    return {
      status,
      severity: 'info',
      message: reason
        ? `That request is not currently supported by AI MAP. ${reason}`
        : 'That request is not currently supported by AI MAP.',
      chain: ['Planning', 'Unsupported capability', 'No map change']
    };
  }

  if (status === 'PROVIDER_ERROR' || body.failureCode === 'MODEL_TIMEOUT') {
    return {
      status: status || 'PROVIDER_ERROR',
      severity: 'warning',
      message: 'AI MAP is temporarily unavailable. The map was not changed.',
      chain: ['Provider unavailable', 'No map change']
    };
  }

  if (status === 'INVALID_MODEL_OUTPUT' || body.validationRejected) {
    return {
      status: status || 'INVALID_MODEL_OUTPUT',
      severity: 'info',
      message: 'AI MAP could not produce a valid GIS plan for that request.',
      chain: ['Planning', 'Plan rejected', 'No map change']
    };
  }

  if (status === 'ENGINE_REJECTED') {
    return {
      status,
      severity: 'error',
      message: body.engineError || body.message || 'GIS execution failed for a validated AI MAP plan.',
      chain: ['Plan validated', 'GIS execution failed']
    };
  }

  const fallback = String(body.message || body.reason || '').trim();
  return {
    status: status || 'REJECTED',
    severity: 'info',
    message: fallback || 'AI MAP could not complete that request.',
    chain: ['Planning', 'Request not executed']
  };
}

/**
 * @param {object} mapResult
 */
export function formatAiMapSuccessMessage(mapResult = {}) {
  const summary = mapResult.summary || {};
  const dataset = summary.dataset || mapResult.datasetResults?.[0]?.displayName || 'Results';
  const action = String(summary.action || summary.spatialOperation || mapResult.action || '').toUpperCase();
  const count = summary.matchedFeatures ?? mapResult.features?.length ?? null;

  if (action === 'LOCATE') {
    const location = summary.location || summary.matchedAddress || 'the requested address';
    return `Location marked: ${location}.`;
  }
  if (action === 'COUNT') {
    return count != null
      ? `Count complete: ${count} ${dataset.toLowerCase()} found.`
      : `Count complete for ${dataset}.`;
  }
  if (action === 'NEAREST') {
    return count != null
      ? `Nearest results ready: ${count} ${dataset.toLowerCase()}.`
      : `Nearest results ready for ${dataset}.`;
  }
  if (action === 'CLEAR') {
    return 'Result cleared.';
  }
  if (count != null) {
    return `${dataset}: ${count} feature${count === 1 ? '' : 's'} mapped.`;
  }
  return `${dataset} mapped successfully.`;
}

/**
 * @param {object} body
 */
export function formatAiMapSuccessChain(body = {}) {
  const aiPlan = body.aiPlan || {};
  const provider = aiPlan.provider || body.provider || 'Model';
  const model = aiPlan.model || body.model || '';
  const providerLabel = model ? `${provider} · ${model}` : provider;
  return [
    providerLabel,
    'Plan validated',
    'Deterministic engine',
    'Complete'
  ];
}
