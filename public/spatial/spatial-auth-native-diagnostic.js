/**
 * AUTH-NATIVE Amenities activation diagnostics.
 * Records every stage; publishes to window + server without DevTools.
 */

/** @type {Record<string, string>} */
export const AUTH_NATIVE_SHORT_CODES = {
  not_osm_result: 'NOT_OSM',
  source_identity_mismatch: 'SOURCE_MISMATCH',
  no_source_object_ids: 'NO_OBJECT_IDS',
  webmap_not_ready: 'WEBMAP_NOT_READY',
  map_view_not_ready: 'MAPVIEW_NOT_READY',
  authoritative_webmap_layer_not_found: 'LAYER_NOT_FOUND',
  source_layer_load_failed: 'SOURCE_LOAD_FAILED',
  result_objectids_not_from_source_layer: 'OBJECTID_SOURCE_MISMATCH',
  layer_view_filter_failed: 'LAYERVIEW_FILTER_FAILED',
  filter_precondition_failed: 'FILTER_PRECONDITION_FAILED',
  when_layer_view_failed: 'LAYERVIEW_FAILED',
  feature_filter_create_failed: 'FILTER_CREATE_FAILED',
  filter_assign_failed: 'FILTER_ASSIGN_FAILED',
  filter_apply_returned_false: 'FILTER_APPLY_FALSE',
  auth_native_layer_view: 'SUCCESS',
  auth_native_unavailable: 'UNKNOWN'
};

/** @type {Record<string, unknown> | null} */
let activeDiagnostic = null;

let reportTimer = null;

function serializeError(error) {
  if (!error) return null;
  return {
    name: error.name || 'Error',
    message: error.message || String(error),
    stack: error.stack || null
  };
}

function normalizeUrl(url) {
  return String(url || '').replace(/\/$/, '').toLowerCase();
}

export function compareSourceIdentity(sourceDef, sourceLayer) {
  const deterministicUrl = normalizeUrl(sourceDef?.serviceUrl);
  const layerUrl = normalizeUrl(sourceLayer?.url);
  const layerId = sourceLayer?.layerId ?? sourceDef?.layerId ?? 0;
  const layerUrlWithIndex = layerUrl && /\/\d+$/.test(layerUrl)
    ? layerUrl
    : `${layerUrl}/${layerId}`;
  const deterministicWithIndex = `${deterministicUrl}/${layerId}`;
  const match = layerUrl === deterministicUrl
    || layerUrlWithIndex === deterministicWithIndex
    || layerUrl.startsWith(`${deterministicUrl}/`)
    || deterministicUrl.startsWith(`${layerUrl}/`);
  return {
    deterministicSourceUrl: sourceDef?.serviceUrl || null,
    deterministicLayerId: sourceDef?.layerId ?? 0,
    authoritativeLayerUrl: sourceLayer?.url || null,
    authoritativeLayerId: sourceLayer?.layerId ?? layerId,
    identityMatch: match
  };
}

/**
 * @param {object} [seed]
 */
export function beginAuthNativeDiagnostic(seed = {}) {
  activeDiagnostic = {
    startedAt: new Date().toISOString(),
    success: null,
    failureStage: null,
    failureReason: null,
    shortCode: null,
    fallbackInvoked: false,
    stages: [],
    webStyleSymbolEvents: [],
    ...seed
  };
  publishAuthNativeDiagnostic(activeDiagnostic);
  return activeDiagnostic;
}

/**
 * @param {string} stage
 * @param {Record<string, unknown>} [data]
 */
export function recordAuthNativeStage(stage, data = {}) {
  if (!activeDiagnostic) beginAuthNativeDiagnostic();
  activeDiagnostic.stages.push({
    stage,
    at: new Date().toISOString(),
    ...data
  });
  publishAuthNativeDiagnostic(activeDiagnostic);
}

/**
 * @param {string} reason
 * @param {Record<string, unknown>} [extra]
 * @param {Error | null} [error]
 */
export function failAuthNativeDiagnostic(reason, extra = {}, error = null) {
  if (!activeDiagnostic) beginAuthNativeDiagnostic();
  const shortCode = AUTH_NATIVE_SHORT_CODES[reason] || reason.toUpperCase();
  activeDiagnostic.success = false;
  activeDiagnostic.failureStage = extra.failureStage || reason;
  activeDiagnostic.failureReason = reason;
  activeDiagnostic.shortCode = shortCode;
  activeDiagnostic.fallbackInvoked = true;
  activeDiagnostic.exception = serializeError(error);
  Object.assign(activeDiagnostic, extra);
  recordAuthNativeStage('failure', {
    reason,
    shortCode,
    exception: activeDiagnostic.exception,
    ...extra
  });
  publishAuthNativeDiagnostic(activeDiagnostic);
  return activeDiagnostic;
}

/**
 * @param {Record<string, unknown>} [extra]
 */
export function succeedAuthNativeDiagnostic(extra = {}) {
  if (!activeDiagnostic) beginAuthNativeDiagnostic();
  activeDiagnostic.success = true;
  activeDiagnostic.failureStage = null;
  activeDiagnostic.failureReason = null;
  activeDiagnostic.shortCode = 'SUCCESS';
  activeDiagnostic.fallbackInvoked = false;
  Object.assign(activeDiagnostic, extra);
  recordAuthNativeStage('success', { shortCode: 'SUCCESS', ...extra });
  publishAuthNativeDiagnostic(activeDiagnostic);
  return activeDiagnostic;
}

export function getAuthNativeDiagnostic() {
  return activeDiagnostic ? { ...activeDiagnostic } : null;
}

function scheduleServerReport(payload) {
  if (reportTimer) return;
  reportTimer = setTimeout(async () => {
    reportTimer = null;
    try {
      await fetch('/api/spatial/runtime-info/client-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        cache: 'no-store'
      });
    } catch {
      // preview endpoint may be unavailable
    }
  }, 80);
}

/**
 * @param {Record<string, unknown>} diagnostic
 */
export function publishAuthNativeDiagnostic(diagnostic) {
  const snapshot = { ...diagnostic };
  if (typeof window !== 'undefined') {
    window.__IQAI_AUTH_NATIVE_DIAGNOSTIC__ = snapshot;
  }
  scheduleServerReport({
    authNativeDiagnostic: snapshot,
    authNativeShortReason: snapshot.shortCode || null,
    fallbackReason: snapshot.failureReason || snapshot.shortCode || null
  });
}

/** @type {Record<string, unknown>[]} */
const webStyleSymbolEvents = [];

export function recordWebStyleSymbolEvent(source, detail) {
  const event = {
    at: new Date().toISOString(),
    source,
    detail
  };
  webStyleSymbolEvents.push(event);
  if (activeDiagnostic) {
    activeDiagnostic.webStyleSymbolEvents = [...webStyleSymbolEvents];
    publishAuthNativeDiagnostic(activeDiagnostic);
  }
  if (typeof window !== 'undefined') {
    window.__IQAI_WEBSTYLE_SYMBOL_DIAGNOSTIC__ = {
      events: [...webStyleSymbolEvents],
      likelyAmenitiesRelated: false,
      likelyVesselRelated: source === 'vessels-live-symbols' || String(detail).toLowerCase().includes('ferry')
    };
  }
}

export function installWebStyleSymbolTrace() {
  if (typeof window === 'undefined' || window.__IQAI_WEBSTYLE_TRACE_INSTALLED__) return;
  window.__IQAI_WEBSTYLE_TRACE_INSTALLED__ = true;

  const originalWarn = console.warn.bind(console);
  console.warn = (...args) => {
    const text = args.map((a) => String(a)).join(' ');
    if (/WebStyleSymbol|fetchSymbol/i.test(text)) {
      recordWebStyleSymbolEvent('console.warn', text);
    }
    return originalWarn(...args);
  };

  const originalError = console.error.bind(console);
  console.error = (...args) => {
    const text = args.map((a) => String(a)).join(' ');
    if (/WebStyleSymbol|fetchSymbol/i.test(text)) {
      recordWebStyleSymbolEvent('console.error', text);
    }
    return originalError(...args);
  };
}

export function listWebMapLayerCandidates(webMap) {
  const layers = [];
  const items = webMap?.layers?.items || webMap?.layers || [];
  const walk = (collection) => {
    for (const layer of collection?.items || collection || []) {
      layers.push({
        id: layer.id || null,
        title: layer.title || null,
        type: layer.type || null,
        url: layer.url || layer.parsedUrl?.path || null
      });
      if (layer.type === 'group' && layer.layers) walk(layer.layers);
    }
  };
  walk(items);
  return layers;
}
