import {
  ADSB_LOL_BASE_URL,
  ADSB_LOL_SOURCE_ID,
  ADSB_LOL_SOURCE_NAME,
  ADSB_LOL_SOURCE_LICENSE,
  ADSB_LOL_SOURCE_URL,
  ADSB_LOL_SOURCE_NOTE,
  ADSB_DEFAULT_LAT,
  ADSB_DEFAULT_LON,
  ADSB_DEFAULT_RADIUS_NM,
  ADSB_MAX_RADIUS_NM,
  ADSB_REFRESH_MS
} from './adsb-lol-config.js';
import {
  normalizeAdsbAircraftPayload,
  getAdsbStableId
} from './adsb-lol-normalize.js';
import { LIVE_SOURCE_CLASS, LIVE_OBJECT_FRESHNESS } from './live-object-types.js';
import { buildLiveEngineDiagnostics } from './live-object-engine.js';

/** @type {{ payload: object, receivedAtMs: number } | null} */
let lastSuccessfulSnapshot = null;

function clampQuery(options = {}) {
  const lat = Number(options.lat ?? ADSB_DEFAULT_LAT);
  const lon = Number(options.lon ?? ADSB_DEFAULT_LON);
  const radiusNm = Number(options.radiusNm ?? options.radius ?? ADSB_DEFAULT_RADIUS_NM);

  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new Error('Invalid latitude');
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new Error('Invalid longitude');
  }
  if (!Number.isFinite(radiusNm) || radiusNm <= 0) {
    throw new Error('Invalid radius');
  }
  if (radiusNm > ADSB_MAX_RADIUS_NM) {
    throw new Error(`Radius exceeds maximum ${ADSB_MAX_RADIUS_NM} nautical miles`);
  }

  return {
    lat,
    lon,
    radiusNm
  };
}

function buildEndpoint(query) {
  return `${ADSB_LOL_BASE_URL}/lat/${query.lat}/lon/${query.lon}/dist/${query.radiusNm}`;
}

/**
 * ADSB.lol live-object adapter (server-side).
 */
export const adsbLolAdapter = {
  sourceId: ADSB_LOL_SOURCE_ID,
  sourceName: ADSB_LOL_SOURCE_NAME,
  sourceClass: LIVE_SOURCE_CLASS.OPEN_COMMUNITY_LIVE,
  sourceUrl: ADSB_LOL_SOURCE_URL,
  sourceLicense: ADSB_LOL_SOURCE_LICENSE,
  sourceNote: ADSB_LOL_SOURCE_NOTE,
  refreshMs: ADSB_REFRESH_MS,
  getStableId: getAdsbStableId,
  clampQuery,
  buildEndpoint
};

/**
 * @param {{ fetchFn?: typeof fetch, force?: boolean, lat?: number, lon?: number, radiusNm?: number }} [options]
 */
export async function fetchLiveAircraft(options = {}) {
  const fetchFn = options.fetchFn || globalThis.fetch;
  const now = Date.now();
  const query = clampQuery(options);

  if (
    !options.force
    && lastSuccessfulSnapshot
    && now - lastSuccessfulSnapshot.receivedAtMs < ADSB_REFRESH_MS
  ) {
    return {
      ok: true,
      fromCache: true,
      ...lastSuccessfulSnapshot.payload
    };
  }

  const receivedAt = new Date(now).toISOString();
  const endpoint = buildEndpoint(query);

  try {
    const response = await fetchFn(endpoint, {
      headers: {
        accept: 'application/json',
        'user-agent': 'IQAI-Spatial/1.0 (ADSB.lol open data consumer)'
      }
    });

    if (!response.ok) {
      throw new Error(`ADSB.lol HTTP ${response.status}`);
    }

    const raw = await response.json();
    const normalized = normalizeAdsbAircraftPayload(raw, {
      receivedAt,
      query
    });

    const payload = {
      status: LIVE_OBJECT_FRESHNESS.CURRENT,
      source: ADSB_LOL_SOURCE_NAME,
      sourceLicense: ADSB_LOL_SOURCE_LICENSE,
      sourceClass: LIVE_SOURCE_CLASS.OPEN_COMMUNITY_LIVE,
      sourceUrl: ADSB_LOL_SOURCE_URL,
      sourceNote: ADSB_LOL_SOURCE_NOTE,
      query,
      feedTimestamp: normalized.feedTimestamp,
      receivedAt: normalized.receivedAt,
      aircraftCount: normalized.objects.length,
      objects: normalized.objects,
      stale: false,
      error: null
    };

    lastSuccessfulSnapshot = {
      payload,
      receivedAtMs: now
    };

    return { ok: true, ...payload };
  } catch (error) {
    const message = error?.message || 'ADSB.lol fetch failed';
    if (lastSuccessfulSnapshot) {
      return {
        ok: true,
        ...lastSuccessfulSnapshot.payload,
        status: LIVE_OBJECT_FRESHNESS.STALE,
        stale: true,
        error: message,
        receivedAt: lastSuccessfulSnapshot.payload.receivedAt,
        fromCache: true
      };
    }
    return {
      ok: false,
      status: LIVE_OBJECT_FRESHNESS.ERROR,
      source: ADSB_LOL_SOURCE_NAME,
      sourceLicense: ADSB_LOL_SOURCE_LICENSE,
      sourceClass: LIVE_SOURCE_CLASS.OPEN_COMMUNITY_LIVE,
      sourceUrl: ADSB_LOL_SOURCE_URL,
      sourceNote: ADSB_LOL_SOURCE_NOTE,
      query,
      feedTimestamp: null,
      receivedAt,
      aircraftCount: 0,
      objects: [],
      stale: true,
      error: message
    };
  }
}

export function getAdsbAdapterInterface() {
  return {
    sourceId: adsbLolAdapter.sourceId,
    sourceName: adsbLolAdapter.sourceName,
    sourceClass: adsbLolAdapter.sourceClass,
    sourceUrl: adsbLolAdapter.sourceUrl,
    sourceLicense: adsbLolAdapter.sourceLicense,
    refreshMs: adsbLolAdapter.refreshMs,
    fetchSnapshot: 'fetchLiveAircraft({ lat, lon, radiusNm })',
    normalize: 'normalizeAdsbAircraftPayload(rawEnvelope, meta)',
    getStableId: 'getAdsbStableId(object) -> liveObjectId'
  };
}

export function getLiveAircraftDiagnostics(snapshot = lastSuccessfulSnapshot?.payload) {
  return buildLiveEngineDiagnostics({
    status: snapshot?.status,
    objectCount: snapshot?.aircraftCount,
    feedTimestamp: snapshot?.feedTimestamp,
    receivedAt: snapshot?.receivedAt,
    refreshMs: ADSB_REFRESH_MS,
    error: snapshot?.error,
    stale: snapshot?.stale
  });
}

export function __resetAdsbCacheForTests() {
  lastSuccessfulSnapshot = null;
}
