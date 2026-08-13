/**
 * Governed place search abstraction.
 * Primary: ArcGIS Places near-point. Fallback: approved OSM_NA_Amenities FeatureServer.
 * Does not scrape Google Maps or invent coordinates.
 */
import { getApprovedExternalSource, SOURCE_IDS } from './approved-external-source-registry.js';
import { validateGeographicCoordinates } from './external-feature-query.js';
import { haversineDistanceMeters } from './public-safety-geometry.js';
import { getPlacesAccessToken, isArcGisPlacesEnabled } from './arcgis-places-auth.js';
import { DYNAMIC_PLACE_STATUS } from './dynamic-place-search-status.js';

export const PLACES_NEAR_POINT_URL =
  'https://places-api.arcgis.com/arcgis/rest/services/places-service/v1/places/near-point';

export const PLACE_PROVIDERS = Object.freeze({
  ARCGIS_PLACES: 'ARCGIS_PLACES',
  OSM_NA_AMENITIES: SOURCE_IDS.OSM_NA_AMENITIES
});

const QUERY_TIMEOUT_MS = 30_000;
const PLACES_RADIUS_MIN = 1;
const PLACES_RADIUS_MAX = 10_000;
const PLACES_PAGE_SIZE = 20;
const PLACES_MAX_RESULTS = 50;

function escapeSqlLiteral(value) {
  return String(value || '').replace(/'/g, "''");
}

function clampPlacesRadius(radiusMeters) {
  const n = Number(radiusMeters);
  if (!Number.isFinite(n) || n <= 0) return 1000;
  return Math.min(PLACES_RADIUS_MAX, Math.max(PLACES_RADIUS_MIN, Math.round(n)));
}

function classifyHttpStatus(status, errorCode) {
  const code = Number(errorCode || status);
  if (status === 429 || code === 429) return DYNAMIC_PLACE_STATUS.RATE_LIMITED;
  if (status === 401 || status === 403 || code === 498 || code === 499) {
    return DYNAMIC_PLACE_STATUS.AUTH_REQUIRED;
  }
  if (status >= 500 || status === 0) return DYNAMIC_PLACE_STATUS.PROVIDER_UNAVAILABLE;
  return DYNAMIC_PLACE_STATUS.PROVIDER_UNAVAILABLE;
}

async function fetchJson(url, fetchFn, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
  try {
    const response = await fetchFn(url, { ...init, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    return { ok: false, status: 0, error: error?.message || 'Request failed', data: null };
  } finally {
    clearTimeout(timer);
  }
}

function omitEmpty(record) {
  const out = {};
  for (const [key, value] of Object.entries(record)) {
    if (value == null || value === '') continue;
    out[key] = value;
  }
  return out;
}

/**
 * @param {object} raw
 * @param {string} retrievedAt
 */
export function normalizeArcGisPlace(raw, retrievedAt) {
  const location = raw?.location || {};
  const longitude = Number(location.x ?? location.longitude);
  const latitude = Number(location.y ?? location.latitude);
  const coordCheck = validateGeographicCoordinates(longitude, latitude, PLACE_PROVIDERS.ARCGIS_PLACES);
  if (!coordCheck.ok) return null;
  const name = String(raw.name || '').trim();
  if (!name) return null;
  const category = raw.categories?.[0]?.label || null;
  const address = raw.address?.streetAddress
    || raw.address?.label
    || raw.formattedAddress
    || null;
  const distanceMeters = Number.isFinite(Number(raw.distance)) ? Number(raw.distance) : null;
  return omitEmpty({
    id: `places:${raw.placeId || `${longitude},${latitude}`}`,
    name,
    category,
    latitude,
    longitude,
    distanceMeters,
    address,
    provider: PLACE_PROVIDERS.ARCGIS_PLACES,
    providerId: raw.placeId || null,
    retrievedAt
  });
}

/**
 * @param {object} rawFeature
 * @param {object} poi
 * @param {object} origin
 * @param {object} source
 * @param {string} retrievedAt
 */
export function normalizeOsmPlace(rawFeature, poi, origin, source, retrievedAt) {
  const raw = rawFeature?.attributes || {};
  const geometry = rawFeature?.geometry || {};
  const longitude = Number(geometry.x);
  const latitude = Number(geometry.y);
  const coordCheck = validateGeographicCoordinates(longitude, latitude, source.id);
  if (!coordCheck.ok) return null;
  const name = String(raw.name || raw.name_en || raw.name_fr || poi?.label || '').trim();
  if (!name) return null;
  const objectId = raw.OBJECTID ?? raw.ObjectID ?? null;
  const street = [raw.addr_housenumber, raw.addr_street].filter(Boolean).join(' ').trim();
  const city = raw.addr_city || raw.addr_state || '';
  const address = [street, city].filter(Boolean).join(', ') || null;
  const distanceMeters = origin
    ? haversineDistanceMeters(origin.latitude, origin.longitude, latitude, longitude)
    : null;
  return omitEmpty({
    id: `osm:${objectId ?? `${longitude},${latitude}`}`,
    name,
    category: poi?.category || raw.amenity || null,
    latitude,
    longitude,
    distanceMeters,
    address,
    provider: PLACE_PROVIDERS.OSM_NA_AMENITIES,
    providerId: raw.osm_id != null ? String(raw.osm_id) : (objectId != null ? String(objectId) : null),
    retrievedAt
  });
}

function buildOsmWhere(poi = {}) {
  const parts = [];
  if (poi.amenity) {
    parts.push(`amenity = '${escapeSqlLiteral(poi.amenity)}'`);
  }
  if (poi.namePattern) {
    const pattern = escapeSqlLiteral(poi.namePattern);
    parts.push(`(UPPER(name) LIKE UPPER('%${pattern}%') OR UPPER(name_en) LIKE UPPER('%${pattern}%') OR UPPER(name_fr) LIKE UPPER('%${pattern}%'))`);
  }
  return parts.length ? parts.join(' AND ') : '1=1';
}

async function searchArcGisPlacesNearPoint(params, options = {}) {
  const retrievedAt = new Date().toISOString();
  const fetchFn = options.placesFetchFn || options.fetchFn || globalThis.fetch;
  const tokenResult = options.accessToken
    ? { ok: true, token: options.accessToken, source: 'INJECTED' }
    : await getPlacesAccessToken({ fetchFn: options.authFetchFn || fetchFn });
  if (!tokenResult.ok) {
    return {
      status: tokenResult.status || DYNAMIC_PLACE_STATUS.AUTH_REQUIRED,
      provider: PLACE_PROVIDERS.ARCGIS_PLACES,
      places: [],
      retrievedAt,
      providerQuery: null,
      message: tokenResult.message || 'ArcGIS Places authentication failed.'
    };
  }

  const radius = clampPlacesRadius(params.radiusMeters);
  const limit = Math.min(Math.max(Number(params.limit) || PLACES_MAX_RESULTS, 1), PLACES_MAX_RESULTS);
  const searchText = String(params.query || '').trim();
  const providerQuery = {
    endpoint: 'places/near-point',
    x: params.point.longitude,
    y: params.point.latitude,
    radius,
    searchText: searchText || null,
    pageSize: Math.min(PLACES_PAGE_SIZE, limit)
  };

  const places = [];
  let offset = 0;
  while (places.length < limit) {
    const qs = new URLSearchParams({
      x: String(params.point.longitude),
      y: String(params.point.latitude),
      radius: String(radius),
      pageSize: String(Math.min(PLACES_PAGE_SIZE, limit - places.length)),
      offset: String(offset),
      f: 'json',
      token: tokenResult.token
    });
    if (searchText.length >= 3) qs.set('searchText', searchText);
    if (Array.isArray(params.categories) && params.categories.length) {
      qs.set('categoryIds', params.categories.slice(0, 10).join(','));
    }

    const fetched = await fetchJson(`${PLACES_NEAR_POINT_URL}?${qs}`, fetchFn);
    if (!fetched.ok || fetched.data?.error) {
      const errorCode = fetched.data?.error?.code;
      return {
        status: classifyHttpStatus(fetched.status || 401, errorCode),
        provider: PLACE_PROVIDERS.ARCGIS_PLACES,
        places: [],
        retrievedAt,
        providerQuery,
        message: 'ArcGIS Places near-point query failed.'
      };
    }

    const rows = fetched.data?.results || fetched.data?.places || [];
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const row of rows) {
      const normalized = normalizeArcGisPlace(row, retrievedAt);
      if (normalized) places.push(normalized);
      if (places.length >= limit) break;
    }
    if (rows.length < PLACES_PAGE_SIZE || !fetched.data?.pagination?.nextUrl) break;
    offset += rows.length;
  }

  return {
    status: places.length ? DYNAMIC_PLACE_STATUS.PASS : DYNAMIC_PLACE_STATUS.NO_VERIFIED_RESULTS,
    provider: PLACE_PROVIDERS.ARCGIS_PLACES,
    places,
    retrievedAt,
    providerQuery,
    message: places.length
      ? `ArcGIS Places returned ${places.length} verified result(s).`
      : 'ArcGIS Places returned no verified results.'
  };
}

async function searchOsmAmenities(params, options = {}) {
  const retrievedAt = new Date().toISOString();
  const source = getApprovedExternalSource(SOURCE_IDS.OSM_NA_AMENITIES);
  if (!source) {
    return {
      status: DYNAMIC_PLACE_STATUS.PROVIDER_UNAVAILABLE,
      provider: PLACE_PROVIDERS.OSM_NA_AMENITIES,
      places: [],
      retrievedAt,
      providerQuery: null,
      message: 'Approved OSM amenities provider is not registered.'
    };
  }

  const fetchFn = options.fetchFn || globalThis.fetch;
  const where = buildOsmWhere(params.poi || { namePattern: params.query });
  const providerQuery = {
    endpoint: `${source.serviceUrl}/${source.layerId}/query`,
    where,
    geometry: `${params.point.longitude},${params.point.latitude}`,
    distance: params.radiusMeters,
    units: 'esriSRUnit_Meter'
  };
  const spatialParams = new URLSearchParams({
    geometry: providerQuery.geometry,
    geometryType: 'esriGeometryPoint',
    spatialRel: 'esriSpatialRelIntersects',
    distance: String(params.radiusMeters),
    units: 'esriSRUnit_Meter',
    inSR: '4326'
  });
  const url = `${providerQuery.endpoint}?where=${encodeURIComponent(where)}&outFields=${encodeURIComponent(source.fields.join(','))}&returnGeometry=true&outSR=4326&f=json&resultRecordCount=2000&${spatialParams}`;
  const fetched = await fetchJson(url, fetchFn);
  if (!fetched.ok) {
    return {
      status: classifyHttpStatus(fetched.status, fetched.data?.error?.code),
      provider: PLACE_PROVIDERS.OSM_NA_AMENITIES,
      places: [],
      retrievedAt,
      providerQuery,
      message: fetched.error || 'OSM amenities query failed.'
    };
  }

  const rawFeatures = fetched.data?.features || [];
  const origin = { latitude: params.point.latitude, longitude: params.point.longitude };
  const places = [];
  for (const feature of rawFeatures) {
    const normalized = normalizeOsmPlace(feature, params.poi, origin, source, retrievedAt);
    if (!normalized) continue;
    if (Number.isFinite(normalized.distanceMeters) && normalized.distanceMeters > params.radiusMeters) {
      continue;
    }
    places.push(normalized);
  }
  places.sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0));
  const limit = Number(params.limit);
  const sliced = Number.isFinite(limit) && limit > 0 ? places.slice(0, limit) : places;

  return {
    status: sliced.length ? DYNAMIC_PLACE_STATUS.PASS : DYNAMIC_PLACE_STATUS.NO_VERIFIED_RESULTS,
    provider: PLACE_PROVIDERS.OSM_NA_AMENITIES,
    places: sliced,
    retrievedAt,
    providerQuery,
    message: sliced.length
      ? `OSM amenities returned ${sliced.length} verified result(s).`
      : 'OSM amenities returned no verified results.'
  };
}

function shouldTryPlaces(options = {}) {
  if (options.skipArcGisPlaces) return false;
  if (!isArcGisPlacesEnabled()) return false;
  // Unit tests inject fetchFn for OSM; do not hit live Places unless explicitly allowed.
  if (options.fetchFn && !options.allowArcGisPlaces && !options.placesFetchFn && !options.accessToken) {
    return false;
  }
  return true;
}

function isFallbackStatus(status) {
  return status === DYNAMIC_PLACE_STATUS.AUTH_REQUIRED
    || status === DYNAMIC_PLACE_STATUS.PROVIDER_UNAVAILABLE
    || status === DYNAMIC_PLACE_STATUS.RATE_LIMITED;
}

/**
 * @param {{ query: string, point: { latitude: number, longitude: number }, radiusMeters: number, categories?: string[], limit?: number, poi?: object }} params
 * @param {object} [options]
 */
export async function searchPlaces(params = {}, options = {}) {
  const point = params.point || {};
  const coordCheck = validateGeographicCoordinates(point.longitude, point.latitude, 'place-search');
  if (!coordCheck.ok) {
    return {
      status: DYNAMIC_PLACE_STATUS.ANCHOR_NOT_RESOLVED,
      provider: null,
      places: [],
      retrievedAt: new Date().toISOString(),
      providerQuery: null,
      message: coordCheck.message
    };
  }

  const query = String(params.query || params.poi?.searchText || params.poi?.namePattern || params.poi?.label || '').trim();
  const request = {
    query,
    point: { latitude: point.latitude, longitude: point.longitude },
    radiusMeters: Number(params.radiusMeters) || 1000,
    categories: params.categories || params.poi?.placeCategories || null,
    limit: params.limit,
    poi: params.poi || { namePattern: query, label: query }
  };

  if (shouldTryPlaces(options)) {
    const placesResult = await searchArcGisPlacesNearPoint(request, options);
    if (!isFallbackStatus(placesResult.status)) {
      return placesResult;
    }
    const osm = await searchOsmAmenities(request, options);
    return {
      ...osm,
      fallbackFrom: placesResult.provider,
      fallbackReason: placesResult.status,
      placesAttempt: placesResult.status
    };
  }

  return searchOsmAmenities(request, options);
}

export { buildOsmWhere };
