import {
  SPVM_UPSTREAM_GEOJSON_URL,
  SPVM_UPSTREAM_STATUS_URL,
  SPVM_SERVER_CACHE_MS,
  SPVM_USER_AGENT,
  SPVM_SOURCE_NAME,
  SPVM_DATASET_NAME,
  SPVM_LICENSE
} from './spvm-crime-config.js';

/** @type {{ payload: object, fetchedAtMs: number } | null} */
let geojsonCache = null;
/** @type {{ payload: object, fetchedAtMs: number } | null} */
let statusCache = null;

/**
 * @param {string} url
 * @param {{ fetchFn?: typeof fetch }} options
 */
async function fetchUpstreamJson(url, options = {}) {
  const fetchFn = options.fetchFn || globalThis.fetch;
  const response = await fetchFn(url, {
    headers: {
      'User-Agent': SPVM_USER_AGENT,
      Accept: 'application/json, application/geo+json, text/json'
    },
    redirect: 'follow'
  });

  if (!response.ok) {
    throw new Error(`SPVM upstream HTTP ${response.status} for ${url}`);
  }

  const text = await response.text();
  if (!text?.trim()) {
    throw new Error('SPVM upstream empty response');
  }

  return JSON.parse(text);
}

/**
 * @param {object} geojson
 */
function validateGeojsonFeatureCollection(geojson) {
  if (!geojson || geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
    throw new Error('SPVM upstream is not a valid GeoJSON FeatureCollection');
  }
  if (!geojson.features.length) {
    throw new Error('SPVM upstream FeatureCollection has zero features');
  }
}

/**
 * @param {{ fetchFn?: typeof fetch, force?: boolean }} [options]
 */
export async function fetchSpvmCrimeGeojson(options = {}) {
  const fetchFn = options.fetchFn || globalThis.fetch;
  const now = Date.now();

  if (
    !options.force
    && geojsonCache
    && now - geojsonCache.fetchedAtMs < SPVM_SERVER_CACHE_MS
  ) {
    return {
      ok: true,
      cached: true,
      stale: false,
      geojson: geojsonCache.payload.geojson,
      featureCount: geojsonCache.payload.featureCount,
      fetchedAt: geojsonCache.payload.fetchedAt,
      upstreamUrl: SPVM_UPSTREAM_GEOJSON_URL
    };
  }

  try {
    const geojson = await fetchUpstreamJson(SPVM_UPSTREAM_GEOJSON_URL, { fetchFn });
    validateGeojsonFeatureCollection(geojson);

    const payload = {
      geojson,
      featureCount: geojson.features.length,
      fetchedAt: new Date().toISOString()
    };
    geojsonCache = { fetchedAtMs: now, payload };

    return {
      ok: true,
      cached: false,
      stale: false,
      ...payload,
      upstreamUrl: SPVM_UPSTREAM_GEOJSON_URL
    };
  } catch (error) {
    if (geojsonCache) {
      return {
        ok: true,
        cached: true,
        stale: true,
        error: error.message || String(error),
        geojson: geojsonCache.payload.geojson,
        featureCount: geojsonCache.payload.featureCount,
        fetchedAt: geojsonCache.payload.fetchedAt,
        upstreamUrl: SPVM_UPSTREAM_GEOJSON_URL
      };
    }
    return {
      ok: false,
      stale: true,
      error: error.message || String(error),
      upstreamUrl: SPVM_UPSTREAM_GEOJSON_URL
    };
  }
}

/**
 * @param {{ fetchFn?: typeof fetch, force?: boolean }} [options]
 */
export async function fetchSpvmStatus(options = {}) {
  const fetchFn = options.fetchFn || globalThis.fetch;
  const now = Date.now();

  if (
    !options.force
    && statusCache
    && now - statusCache.fetchedAtMs < SPVM_SERVER_CACHE_MS
  ) {
    return {
      ok: true,
      cached: true,
      stale: false,
      status: statusCache.payload.status,
      fetchedAt: statusCache.payload.fetchedAt,
      upstreamUrl: SPVM_UPSTREAM_STATUS_URL
    };
  }

  try {
    const status = await fetchUpstreamJson(SPVM_UPSTREAM_STATUS_URL, { fetchFn });
    if (!status || typeof status !== 'object') {
      throw new Error('SPVM status JSON invalid');
    }

    const payload = {
      status,
      fetchedAt: new Date().toISOString()
    };
    statusCache = { fetchedAtMs: now, payload };

    return {
      ok: true,
      cached: false,
      stale: false,
      ...payload,
      upstreamUrl: SPVM_UPSTREAM_STATUS_URL
    };
  } catch (error) {
    if (statusCache) {
      return {
        ok: true,
        cached: true,
        stale: true,
        error: error.message || String(error),
        status: statusCache.payload.status,
        fetchedAt: statusCache.payload.fetchedAt,
        upstreamUrl: SPVM_UPSTREAM_STATUS_URL
      };
    }
    return {
      ok: false,
      stale: true,
      error: error.message || String(error),
      upstreamUrl: SPVM_UPSTREAM_STATUS_URL
    };
  }
}

export function getSpvmProxyDiagnostics() {
  return {
    source: SPVM_SOURCE_NAME,
    dataset: SPVM_DATASET_NAME,
    license: SPVM_LICENSE,
    upstreamGeojsonUrl: SPVM_UPSTREAM_GEOJSON_URL,
    upstreamStatusUrl: SPVM_UPSTREAM_STATUS_URL,
    cacheMs: SPVM_SERVER_CACHE_MS,
    geojsonCached: Boolean(geojsonCache),
    statusCached: Boolean(statusCache)
  };
}
