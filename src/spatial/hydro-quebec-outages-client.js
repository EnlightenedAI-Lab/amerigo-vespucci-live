import {
  HYDRO_BASE_URL,
  HYDRO_VERSION_PATH,
  HYDRO_MARKERS_PATH_PREFIX,
  HYDRO_POLY_PATH_PREFIX,
  HYDRO_POLY_SUFFIX,
  HYDRO_SOURCE_NAME,
  HYDRO_REFRESH_MS
} from './hydro-quebec-outages-config.js';
import {
  normalizeHydroMarkersPayload,
  parseHydroVersionTimestamp
} from './hydro-quebec-outages-normalize.js';
import {
  extractKmlFromKmzBuffer,
  parseHydroOutageAreasFromKml,
  linkHydroAreasToOutages
} from './hydro-quebec-kmz-parse.js';

/** @type {{ payload: object, receivedAtMs: number, version: string | null } | null} */
let lastSuccessfulSnapshot = null;
/** @type {{ areas: object[], version: string | null, receivedAtMs: number } | null} */
let lastSuccessfulPolygonSnapshot = null;

function parseVersionBody(text) {
  const trimmed = String(text || '').trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === 'string' || typeof parsed === 'number') {
      return String(parsed).trim();
    }
  } catch {
    // bisversion may be a bare quoted string body
  }
  return trimmed.replace(/^"+|"+$/g, '');
}

function looksLikeHtml(text) {
  const sample = String(text || '').trim().slice(0, 200).toLowerCase();
  return sample.startsWith('<!doctype') || sample.startsWith('<html') || sample.includes('<body');
}

function parseJsonBody(text, contextLabel) {
  if (looksLikeHtml(text)) {
    throw new Error(`${contextLabel} returned HTML instead of JSON`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${contextLabel} returned invalid JSON: ${error?.message || 'parse failed'}`);
  }
}

async function fetchText(fetchFn, url, accept = 'application/json, text/plain, */*') {
  const response = await fetchFn(url, {
    headers: {
      accept,
      'user-agent': 'IQAI-Spatial/1.0 (Hydro-Québec open data consumer)'
    }
  });
  const contentType = String(response.headers?.get?.('content-type') || '');
  const text = await response.text();
  return { response, contentType, text };
}

async function fetchBinary(fetchFn, url) {
  const response = await fetchFn(url, {
    headers: {
      accept: 'application/vnd.google-earth.kmz, application/octet-stream, */*',
      'user-agent': 'IQAI-Spatial/1.0 (Hydro-Québec open data consumer)'
    }
  });
  const contentType = String(response.headers?.get?.('content-type') || '');
  const buffer = Buffer.from(await response.arrayBuffer());
  return { response, contentType, buffer };
}

async function fetchPolygonAreas(fetchFn, version, feedTimestamp, receivedAt) {
  const polyUrl = `${HYDRO_BASE_URL}${HYDRO_POLY_PATH_PREFIX}${version}${HYDRO_POLY_SUFFIX}`;
  const { response, contentType, buffer } = await fetchBinary(fetchFn, polyUrl);
  if (!response.ok) {
    throw new Error(`Hydro polygons HTTP ${response.status}`);
  }
  if (contentType.includes('text/html') || looksLikeHtml(buffer.toString('utf8', 0, Math.min(200, buffer.length)))) {
    throw new Error(`Hydro polygons endpoint returned HTML (content-type: ${contentType || 'unknown'})`);
  }
  const kml = extractKmlFromKmzBuffer(buffer);
  const areas = parseHydroOutageAreasFromKml(kml, {
    version,
    feedTimestamp,
    receivedAt,
    sourceName: HYDRO_SOURCE_NAME
  });
  return { areas, polyUrl };
}

/**
 * @param {{ fetchFn?: typeof fetch, force?: boolean }} [options]
 */
export async function fetchHydroQuebecOutages(options = {}) {
  const fetchFn = options.fetchFn || globalThis.fetch;
  const now = Date.now();
  const receivedAt = new Date(now).toISOString();

  if (
    !options.force
    && lastSuccessfulSnapshot
    && now - lastSuccessfulSnapshot.receivedAtMs < HYDRO_REFRESH_MS
  ) {
    return {
      ok: true,
      fromCache: true,
      ...lastSuccessfulSnapshot.payload
    };
  }

  let version = null;
  let feedTimestamp = null;
  let outages = [];
  let markersError = null;
  let polygonError = null;
  let polygonStatus = 'ERROR';
  let areas = lastSuccessfulPolygonSnapshot?.areas || [];

  try {
    const versionUrl = `${HYDRO_BASE_URL}${HYDRO_VERSION_PATH}`;
    const { response: versionResponse, contentType: versionType, text: versionText } = await fetchText(fetchFn, versionUrl);
    if (!versionResponse.ok) {
      throw new Error(`Hydro version HTTP ${versionResponse.status}`);
    }
    if (looksLikeHtml(versionText)) {
      throw new Error(`Hydro version endpoint returned HTML (content-type: ${versionType || 'unknown'})`);
    }

    version = parseVersionBody(versionText);
    if (!version) {
      throw new Error('Hydro version response was empty');
    }
    feedTimestamp = parseHydroVersionTimestamp(version);

    const markersUrl = `${HYDRO_BASE_URL}${HYDRO_MARKERS_PATH_PREFIX}${version}.json`;
    const { response: markersResponse, contentType: markersType, text: markersText } = await fetchText(fetchFn, markersUrl);
    if (!markersResponse.ok) {
      throw new Error(`Hydro markers HTTP ${markersResponse.status}`);
    }
    if (looksLikeHtml(markersText)) {
      throw new Error(`Hydro markers endpoint returned HTML (content-type: ${markersType || 'unknown'})`);
    }

    const markersPayload = parseJsonBody(markersText, 'Hydro markers');
    outages = normalizeHydroMarkersPayload(markersPayload, {
      version,
      feedTimestamp,
      receivedAt
    });

    try {
      const polygonResult = await fetchPolygonAreas(fetchFn, version, feedTimestamp, receivedAt);
      areas = linkHydroAreasToOutages(polygonResult.areas, outages);
      lastSuccessfulPolygonSnapshot = {
        areas,
        version,
        receivedAtMs: now
      };
      polygonStatus = 'CURRENT';
    } catch (error) {
      polygonError = error?.message || 'Hydro polygon fetch failed';
      if (lastSuccessfulPolygonSnapshot?.areas?.length) {
        areas = lastSuccessfulPolygonSnapshot.areas;
        polygonStatus = 'STALE';
      } else {
        areas = [];
        polygonStatus = 'ERROR';
      }
    }

    const payload = {
      status: 'CURRENT',
      source: HYDRO_SOURCE_NAME,
      version,
      feedTimestamp,
      receivedAt,
      outageCount: outages.length,
      outages,
      polygonCount: areas.length,
      areas,
      polygonStatus,
      polygonError,
      stale: false,
      error: null
    };

    lastSuccessfulSnapshot = {
      payload,
      receivedAtMs: now,
      version
    };

    return { ok: true, ...payload };
  } catch (error) {
    markersError = error?.message || 'Hydro refresh failed';
    if (lastSuccessfulSnapshot) {
      return {
        ok: true,
        ...lastSuccessfulSnapshot.payload,
        status: 'STALE',
        stale: true,
        error: markersError,
        receivedAt: lastSuccessfulSnapshot.payload.receivedAt,
        polygonStatus: polygonError ? 'STALE' : lastSuccessfulSnapshot.payload.polygonStatus,
        polygonError: polygonError || lastSuccessfulSnapshot.payload.polygonError,
        fromCache: true
      };
    }
    return {
      ok: false,
      status: 'ERROR',
      source: HYDRO_SOURCE_NAME,
      version,
      feedTimestamp,
      receivedAt,
      outageCount: 0,
      outages: [],
      polygonCount: areas.length,
      areas,
      polygonStatus,
      polygonError: polygonError || markersError,
      stale: true,
      error: markersError
    };
  }
}

/**
 * @param {{ fetchFn?: typeof fetch, force?: boolean }} [options]
 */
export async function fetchHydroQuebecOutageAreas(options = {}) {
  const feed = await fetchHydroQuebecOutages(options);
  return {
    ok: feed.ok,
    status: feed.polygonStatus || feed.status,
    source: feed.source,
    version: feed.version,
    feedTimestamp: feed.feedTimestamp,
    receivedAt: feed.receivedAt,
    polygonCount: feed.polygonCount ?? feed.areas?.length ?? 0,
    areas: feed.areas || [],
    stale: feed.polygonStatus === 'STALE' || feed.stale,
    error: feed.polygonError || feed.error
  };
}

export function __resetHydroOutageCacheForTests() {
  lastSuccessfulSnapshot = null;
  lastSuccessfulPolygonSnapshot = null;
}
