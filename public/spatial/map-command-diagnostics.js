/**
 * TEMPORARY — map command failure instrumentation (remove after diagnosis).
 */

/** @type {string | null} */
let currentStage = null;
/** @type {object[]} */
const completedStages = [];

function safeSerialize(value, depth = 0) {
  if (value == null) return value;
  if (depth > 4) return '[max-depth]';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((item) => safeSerialize(item, depth + 1));
  if (typeof value === 'function') return undefined;
  if (typeof value !== 'object') return String(value);

  if (value.declaredClass || value.name === 'request:server' || value.details) {
    return {
      declaredClass: value.declaredClass || null,
      name: value.name || null,
      message: value.message || null,
      details: safeSerialize(value.details, depth + 1)
    };
  }

  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'stack' && typeof child === 'string') {
      out[key] = child;
      continue;
    }
    const serialized = safeSerialize(child, depth + 1);
    if (serialized !== undefined) out[key] = serialized;
  }
  return out;
}

export function serializeMapCommandError(error) {
  if (!error) return { name: 'Error', message: '' };
  const out = {
    name: error.name || 'Error',
    message: error.message || '',
    stack: error.stack || '',
    details: error.details ? safeSerialize(error.details) : undefined
  };
  if (error.error) out.arcgisError = safeSerialize(error.error);
  return out;
}

export function snapshotFirstFeature(mapResult) {
  const datasetResult = mapResult?.datasetResults?.[0];
  const feature = datasetResult?.features?.[0] || mapResult?.features?.[0];
  if (!feature) return null;
  return {
    objectId: feature.objectId,
    longitude: feature.longitude,
    latitude: feature.latitude,
    distanceMeters: feature.distanceMeters,
    distanceLabel: feature.distanceLabel,
    datasetId: feature.datasetId || datasetResult?.datasetId,
    conceptId: feature.conceptId || datasetResult?.conceptId,
    sourceType: feature.sourceType || datasetResult?.sourceType,
    rawOBJECTID: feature.rawAttributes?.OBJECTID
  };
}

export function snapshotApiBody(body, status) {
  return {
    httpStatus: status,
    supported: body?.supported,
    message: body?.message,
    action: body?.action,
    conceptId: body?.summary?.conceptId || body?.datasetResults?.[0]?.conceptId,
    sourceType: body?.summary?.layerSource || body?.datasetResults?.[0]?.sourceType,
    plan: body?.summary?.action || body?.request?.action,
    matchedFeatures: body?.summary?.matchedFeatures,
    datasetResultCount: body?.datasetResults?.length,
    firstFeature: snapshotFirstFeature(body)
  };
}

export function markMapDiagStage(stage, extra = null) {
  currentStage = stage;
  const entry = {
    stage,
    at: new Date().toISOString(),
    ...(extra && typeof extra === 'object' ? extra : {})
  };
  completedStages.push(entry);
  if (typeof window !== 'undefined') {
    window.__IQAI_MAP_DIAG_STAGES__ = completedStages.slice();
  }
  return entry;
}

export function getCurrentMapDiagStage() {
  return currentStage;
}

export function captureMapCommandFailure(stage, error, context = {}) {
  const diagnostic = {
    stage: stage || currentStage || 'unknown',
    error: serializeMapCommandError(error),
    completedStages: completedStages.slice(),
    ...context
  };
  if (typeof window !== 'undefined') {
    window.__IQAI_LAST_MAP_ERROR__ = diagnostic;
    console.error('[IQAI MAP ERROR]', diagnostic);
  }
  return diagnostic;
}

export function clearMapCommandDiagnostics() {
  currentStage = null;
  completedStages.length = 0;
  if (typeof window !== 'undefined') {
    window.__IQAI_MAP_DIAG_STAGES__ = [];
    window.__IQAI_LAST_MAP_ERROR__ = null;
  }
}

export function formatMapCommandFailureMessage(diagnostic) {
  if (!diagnostic) return 'Map command failed';
  const stage = diagnostic.stage || 'unknown';
  const err = diagnostic.error || {};
  let detail = err.message || '';
  if (!detail) {
    detail = err.name || 'unknown error';
    const arcgisBits = [];
    if (err.details) arcgisBits.push(JSON.stringify(err.details));
    if (err.arcgisError) arcgisBits.push(JSON.stringify(err.arcgisError));
    if (arcgisBits.length) detail += ` (${arcgisBits.join('; ')})`;
  }
  return `Map command failed — ${stage}: ${detail}`;
}

export function getLastMapCommandError() {
  return typeof window !== 'undefined' ? window.__IQAI_LAST_MAP_ERROR__ : null;
}

export function wrapMapCommandError(stage, error, context = {}) {
  const diagnostic = captureMapCommandFailure(stage, error, context);
  const wrapped = new Error(formatMapCommandFailureMessage(diagnostic));
  wrapped.iqaiMapDiagnostic = diagnostic;
  wrapped.iqaiMapStage = stage;
  return wrapped;
}
