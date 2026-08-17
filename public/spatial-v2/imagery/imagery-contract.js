/**
 * IQAI Spatial V2 imagery contract.
 *
 * Imagery time is not Situation time, OWI AS_OF, or Point Intelligence AT/RANGE.
 * Missing acquisition dates stay null. Year-only vintage is not a fabricated day.
 */

export const IMAGERY_PLANE_ID = 'iqai-v2-imagery-plane';
export const IMAGERY_PLANE_TITLE = 'IQAI V2 Imagery';
export const TIME_ENGINE_LAYER_ID = 'iqai-v2-imagery-time-observation';

export const AOI_MODE = Object.freeze({
  VIEWPORT: 'viewport',
  POINT: 'point'
});

export const TIME_PROVIDER_FILTER = Object.freeze({
  ALL: 'all',
  WAYBACK: 'wayback',
  NEARMAP: 'nearmap'
});

export const TIME_ENGINE_STATE = Object.freeze({
  IDLE: 'IDLE',
  DISCOVERING: 'DISCOVERING',
  READY: 'READY',
  APPLYING: 'APPLYING',
  ERROR: 'ERROR'
});

export const GROUND_MODE = Object.freeze({
  AUTHORED_WEBMAP: 'AUTHORED_WEBMAP',
  PURE_BLACK: 'PURE_BLACK',
  PURE_WHITE: 'PURE_WHITE',
  ESRI_WORLD_IMAGERY: 'ESRI_WORLD_IMAGERY',
  LEGACY_GOOGLE_SATELLITE_DEMO: 'LEGACY_GOOGLE_SATELLITE_DEMO',
  GOOGLE_SATELLITE: 'GOOGLE_SATELLITE',
  NEARMAP: 'NEARMAP',
  LOCAL_HIGHRES: 'LOCAL_HIGHRES'
});

export const GROUND_MODE_LABEL = Object.freeze({
  [GROUND_MODE.AUTHORED_WEBMAP]: 'AUTHORED',
  [GROUND_MODE.PURE_BLACK]: 'PURE BLACK',
  [GROUND_MODE.PURE_WHITE]: 'PURE WHITE',
  [GROUND_MODE.ESRI_WORLD_IMAGERY]: 'ESRI WORLD IMAGERY',
  [GROUND_MODE.LEGACY_GOOGLE_SATELLITE_DEMO]: 'GOOGLE SATELLITE DEMO',
  [GROUND_MODE.GOOGLE_SATELLITE]: 'GOOGLE SATELLITE (OFFICIAL)',
  [GROUND_MODE.NEARMAP]: 'NEARMAP',
  [GROUND_MODE.LOCAL_HIGHRES]: 'LOCAL HIGH-RES'
});

export const ENABLED_GROUND_MODES = Object.freeze([
  GROUND_MODE.AUTHORED_WEBMAP,
  GROUND_MODE.PURE_BLACK,
  GROUND_MODE.PURE_WHITE,
  GROUND_MODE.ESRI_WORLD_IMAGERY,
  GROUND_MODE.LEGACY_GOOGLE_SATELLITE_DEMO,
  GROUND_MODE.NEARMAP
]);

export const PROVIDER_KIND = Object.freeze({
  CANVAS: 'canvas',
  CURRENT_GROUND: 'current-ground',
  ARCHIVE: 'archive'
});

export const ENTITLEMENT_STATE = Object.freeze({
  READY: 'ready',
  AUTH_REQUIRED: 'auth-required',
  ENTITLEMENT_MISSING: 'entitlement-missing',
  DENIED: 'denied',
  FAILED: 'failed'
});

export const DATE_KIND = Object.freeze({
  ACQUISITION: 'acquisitionDate',
  SURVEY_INTERVAL: 'surveyInterval',
  RELEASE: 'releaseDate',
  FIRST_PUBLIC: 'firstPublicDate',
  SERVICE_UPDATE: 'serviceUpdateDate',
  VINTAGE: 'vintage',
  SERVICE_CURRENT: 'service-current',
  UNRESOLVED: 'unresolved',
  NONE: 'none'
});

export const RIGHTS = Object.freeze({
  PERMITTED: 'permitted',
  PROHIBITED: 'prohibited',
  UNKNOWN: 'unknown'
});

export const LAYER_SLOT = Object.freeze({
  GROUND: 'ground',
  COMPARE_START: 'compare-start',
  COMPARE_END: 'compare-end',
  PLAYBACK_CURRENT: 'playback-current',
  PLAYBACK_NEXT: 'playback-next',
  TIME_ENGINE: 'time-engine'
});

export const ACCESS_STATE = Object.freeze({
  READY_TO_ACQUIRE: 'READY_TO_ACQUIRE',
  LOCAL: 'LOCAL',
  STREAMABLE: 'STREAMABLE',
  ORDER_REQUIRED: 'ORDER_REQUIRED',
  MANUAL_REQUEST_REQUIRED: 'MANUAL_REQUEST_REQUIRED',
  PAYMENT_REQUIRED: 'PAYMENT_REQUIRED',
  RIGHTS_UNKNOWN: 'RIGHTS_UNKNOWN',
  NOT_AVAILABLE: 'NOT_AVAILABLE'
});

export const MATCH_KIND = Object.freeze({
  EXACT: 'exact',
  NEAREST: 'nearest',
  NONE: 'none'
});

export const GROUND_APPLY_STATE = Object.freeze({
  IDLE: 'IDLE',
  APPLYING: 'APPLYING',
  READY: 'READY',
  ERROR: 'ERROR'
});

export function emptyRights(overrides = {}) {
  return {
    display: RIGHTS.UNKNOWN,
    export: RIGHTS.PROHIBITED,
    cache: RIGHTS.PROHIBITED,
    analysis: RIGHTS.PROHIBITED,
    attributionRequired: true,
    ...overrides
  };
}

export function emptyObservation(partial = {}) {
  return {
    id: null,
    providerId: null,
    productName: null,
    requestedDate: null,
    acquisitionDate: null,
    surveyInterval: null,
    releaseDate: null,
    firstPublicDate: null,
    serviceUpdateDate: null,
    vintageYear: null,
    vintageLabel: null,
    season: null,
    dateKindUsed: DATE_KIND.UNRESOLVED,
    gsdMeters: null,
    footprint: null,
    sourceIdentity: null,
    rights: emptyRights(),
    limitation: null,
    establishes: null,
    doesNotEstablish: null,
    accessState: null,
    assets: [],
    matchDate: null,
    ...partial
  };
}

export function isoDateFromCompact(value) {
  const text = String(value ?? '').replace(/\D/g, '');
  if (!/^\d{8}$/.test(text)) return null;
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(4, 6));
  const day = Number(text.slice(6, 8));
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function isoDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  if (/^\d{4}$/.test(text)) return null;
  const ms = Number(value);
  if (Number.isFinite(ms) && ms > 1e11) {
    return new Date(ms).toISOString().slice(0, 10);
  }
  return null;
}

export function vintageYearFrom(value) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  const year = text.match(/^(\d{4})/);
  if (year) return Number(year[1]);
  const ms = Number(value);
  if (Number.isFinite(ms) && ms > 1e11) return new Date(ms).getUTCFullYear();
  return null;
}

export function deltaDays(requestedIso, selectedIso) {
  if (!requestedIso || !selectedIso) return null;
  const a = Date.parse(`${requestedIso}T00:00:00Z`);
  const b = Date.parse(`${selectedIso}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

export function nearestByIsoDate(records, requestedIso, dateField) {
  if (!requestedIso || !Array.isArray(records) || !records.length) {
    return { match: MATCH_KIND.NONE, record: null, deltaDays: null };
  }
  const requested = Date.parse(`${requestedIso}T00:00:00Z`);
  if (!Number.isFinite(requested)) {
    return { match: MATCH_KIND.NONE, record: null, deltaDays: null };
  }
  let best = null;
  let bestAbs = Infinity;
  let bestDelta = null;
  for (const record of records) {
    const iso = record?.[dateField];
    if (!iso) continue;
    const ts = Date.parse(`${iso}T00:00:00Z`);
    if (!Number.isFinite(ts)) continue;
    const delta = Math.round((ts - requested) / 86400000);
    const abs = Math.abs(delta);
    if (abs < bestAbs) {
      best = record;
      bestAbs = abs;
      bestDelta = delta;
    }
  }
  if (!best) return { match: MATCH_KIND.NONE, record: null, deltaDays: null };
  return {
    match: bestAbs === 0 ? MATCH_KIND.EXACT : MATCH_KIND.NEAREST,
    record: best,
    deltaDays: bestDelta
  };
}
