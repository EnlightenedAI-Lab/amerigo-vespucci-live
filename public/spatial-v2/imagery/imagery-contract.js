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

export const IMAGERY_POOL = Object.freeze({
  LATEST: 'LATEST',
  HISTORY: 'HISTORY',
  BEST_FOR_DATE: 'BEST_FOR_DATE'
});

export const DROP_PIN_THEN_LATEST = 'DROP PIN on the map to choose a place, then click LATEST.';

export const CAPTURE_PRECISION = Object.freeze({
  DAY: 'DAY',
  MONTH: 'MONTH',
  YEAR: 'YEAR',
  UNKNOWN: 'UNKNOWN'
});

export const TIME_ENGINE_STATE = Object.freeze({
  IDLE: 'IDLE',
  DISCOVERING: 'DISCOVERING',
  READY: 'READY',
  APPLYING: 'APPLYING',
  ERROR: 'ERROR'
});

export const DISPLAY_STATE = Object.freeze({
  NONE: 'NONE',
  SELECTED: 'SELECTED',
  ACTIVATED: 'ACTIVATED',
  LAYER_ATTACHED: 'LAYER_ATTACHED',
  LAYER_LOADED: 'LAYER_LOADED',
  DISPLAY_NOT_CONFIRMED: 'DISPLAY_NOT_CONFIRMED',
  DISPLAY_CONFIRMED: 'DISPLAY_CONFIRMED'
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
  GROUND_MODE.ESRI_WORLD_IMAGERY
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

export const PROVIDER_READINESS_STATE = Object.freeze({
  READY: 'READY',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  ENTITLEMENT_REQUIRED: 'ENTITLEMENT_REQUIRED',
  NO_COVERAGE: 'NO_COVERAGE',
  UNAVAILABLE: 'UNAVAILABLE'
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
    retrievedDate: null,
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

export function captureClock(observation) {
  const acquisition = isoDateOnly(observation?.acquisitionDate || observation?.captureDate);
  if (acquisition) {
    return {
      date: acquisition,
      display: acquisition,
      precision: CAPTURE_PRECISION.DAY,
      kind: DATE_KIND.ACQUISITION
    };
  }
  const vintageLabel = String(observation?.vintageLabel || '').trim();
  if (/^\d{4}-\d{2}$/.test(vintageLabel)) {
    return {
      date: `${vintageLabel}-01`,
      display: vintageLabel,
      precision: CAPTURE_PRECISION.MONTH,
      kind: DATE_KIND.VINTAGE
    };
  }
  const year = vintageYearFrom(observation?.vintageYear || vintageLabel);
  if (year) {
    return {
      date: `${year}-01-01`,
      display: String(year),
      precision: CAPTURE_PRECISION.YEAR,
      kind: DATE_KIND.VINTAGE
    };
  }
  return {
    date: null,
    display: null,
    precision: CAPTURE_PRECISION.UNKNOWN,
    kind: DATE_KIND.NONE
  };
}

export function isCaptureClassObservation(observation) {
  return captureClock(observation).precision !== CAPTURE_PRECISION.UNKNOWN;
}

export function isWaybackObservation(observation) {
  return observation?.providerId === 'esri-wayback';
}

export function isCurrentMosaicObservation(observation) {
  return observation?.dateKindUsed === DATE_KIND.SERVICE_CURRENT
    || observation?.providerId === 'nearmap-wms-latest'
    || observation?.providerId === 'esri-world-imagery'
    || observation?.providerId === 'google-map-tiles';
}

export function formatKnownResolution(gsdMeters) {
  const gsd = Number(gsdMeters);
  if (!Number.isFinite(gsd) || gsd <= 0) return null;
  if (gsd < 1) {
    const cm = Number((gsd * 100).toFixed(1));
    const text = Number.isInteger(cm) ? String(cm) : String(cm);
    return `${text} CM`;
  }
  const meters = Number(gsd.toFixed(2));
  const text = Number.isInteger(meters) ? String(meters) : String(meters);
  return `${text} M`;
}

function authorityScore(observation) {
  if (observation?.providerId === 'nearmap') return 3;
  if (observation?.providerId === 'esri-wayback' && isCaptureClassObservation(observation)) return 2;
  return 1;
}

function displayScore(observation) {
  return observation?.accessState === ACCESS_STATE.STREAMABLE ? 1 : 0;
}

function coverageScore(observation) {
  const coverage = Number(observation?.aoiCoverage);
  return Number.isFinite(coverage) ? coverage : null;
}

export function rankBestForDate(records, requestedIso) {
  const eligible = (Array.isArray(records) ? records : []).filter((item) => (
    isCaptureClassObservation(item)
    && !isCurrentMosaicObservation(item)
  ));
  if (!requestedIso || !eligible.length) {
    return { match: MATCH_KIND.NONE, record: null, deltaDays: null };
  }
  const ranked = eligible.map((record) => {
    const clock = captureClock(record);
    const delta = deltaDays(requestedIso, clock.date);
    const abs = delta == null ? Number.POSITIVE_INFINITY : Math.abs(delta);
    const gsd = Number(record.gsdMeters);
    const coverage = coverageScore(record);
    return {
      record,
      abs,
      delta,
      gsdRank: Number.isFinite(gsd) && gsd > 0 ? gsd : Number.POSITIVE_INFINITY,
      coverageRank: coverage == null ? -1 : coverage,
      authority: authorityScore(record),
      display: displayScore(record)
    };
  }).sort((a, b) => (
    a.abs - b.abs
    || a.gsdRank - b.gsdRank
    || b.coverageRank - a.coverageRank
    || b.authority - a.authority
    || b.display - a.display
  ));
  const best = ranked[0];
  if (!best || !Number.isFinite(best.abs)) {
    return { match: MATCH_KIND.NONE, record: null, deltaDays: null };
  }
  return {
    match: best.abs === 0 ? MATCH_KIND.EXACT : MATCH_KIND.NEAREST,
    record: best.record,
    deltaDays: best.delta
  };
}

export function sortHistoryObservations(records) {
  return [...(records || [])].sort((a, b) => {
    const clockA = captureClock(a);
    const clockB = captureClock(b);
    const knownA = clockA.precision === CAPTURE_PRECISION.UNKNOWN ? 1 : 0;
    const knownB = clockB.precision === CAPTURE_PRECISION.UNKNOWN ? 1 : 0;
    if (knownA !== knownB) return knownA - knownB;
    const captureCmp = String(clockB.date || '').localeCompare(String(clockA.date || ''));
    if (captureCmp) return captureCmp;
    return String(b.releaseDate || '').localeCompare(String(a.releaseDate || ''));
  });
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
