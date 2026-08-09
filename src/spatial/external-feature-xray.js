import { getApprovedExternalSource, TRUST_TIER_TRUSTED_EXTERNAL, SOURCE_IDS } from './approved-external-source-registry.js';
import { formatRadiusKm } from './spatial-operations.js';
import { QUERY_TIMEOUT_MS } from './external-feature-query.js';

function layerQueryUrl(source) {
  const base = String(source.serviceUrl || '').replace(/\/$/, '');
  return `${base}/${source.layerId}/query`;
}

async function fetchJson(url, fetchFn) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
  try {
    const response = await fetchFn(url, { signal: controller.signal });
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }
    const data = await response.json();
    if (data?.error) {
      return { ok: false, error: data.error.message || 'ArcGIS query error' };
    }
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err?.message || 'Request failed' };
  } finally {
    clearTimeout(timer);
  }
}

function buildSpatialQueryParams(origin, radiusMeters) {
  return new URLSearchParams({
    geometry: `${origin.longitude},${origin.latitude}`,
    geometryType: 'esriGeometryPoint',
    spatialRel: 'esriSpatialRelIntersects',
    distance: String(radiusMeters),
    units: 'esriSRUnit_Meter',
    inSR: '4326'
  });
}

function isValidCategoryValue(value) {
  const text = String(value ?? '').trim();
  if (!text) return false;
  if (text === '*' || text === '(historical)') return false;
  return true;
}

/**
 * @param {object[]} rawFeatures
 * @param {string} semanticField
 */
export function normalizeCategoryCountFeatures(rawFeatures, semanticField) {
  const categories = (rawFeatures || [])
    .map((feature) => {
      const value = feature?.attributes?.[semanticField];
      const count = Number(
        feature?.attributes?.category_count
        ?? feature?.attributes?.COUNT
        ?? feature?.attributes?.count
        ?? 0
      );
      return { value: String(value ?? '').trim(), count };
    })
    .filter((entry) => isValidCategoryValue(entry.value) && Number.isFinite(entry.count) && entry.count > 0)
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

  const totalFeaturesRepresented = categories.reduce((sum, entry) => sum + entry.count, 0);
  return {
    categories,
    totalCategories: categories.length,
    totalFeaturesRepresented
  };
}

/**
 * Server-side grouped category counts within AOI.
 * @param {object} request
 * @param {{ latitude: number, longitude: number, matchedAddress?: string, locationText?: string }} origin
 * @param {{ fetchFn?: typeof fetch }} [options]
 */
export async function executeCategoryCountsWithin(request, origin, options = {}) {
  const fetchFn = options.fetchFn || globalThis.fetch;
  const source = getApprovedExternalSource(request.sourceId || SOURCE_IDS.OSM_NA_AMENITIES);
  if (!source) {
    return { ok: false, message: 'Approved external source not registered' };
  }
  if (!request.radiusMeters || request.radiusMeters <= 0) {
    return { ok: false, message: 'Category counts require a bounded search radius.' };
  }
  if (!Number.isFinite(origin?.latitude) || !Number.isFinite(origin?.longitude)) {
    return { ok: false, message: 'Category counts require a resolved location.' };
  }

  const semanticField = request.semanticField || source.semanticField || source.categoryField;
  if (!semanticField) {
    return { ok: false, message: 'Semantic field is not configured for this source.' };
  }

  const spatialParams = buildSpatialQueryParams(origin, request.radiusMeters);
  const outStatistics = JSON.stringify([{
    statisticType: 'count',
    onStatisticField: 'OBJECTID',
    outStatisticFieldName: 'category_count'
  }]);

  const queryParams = new URLSearchParams({
    where: '1=1',
    groupByFieldsForStatistics: semanticField,
    outStatistics,
    returnGeometry: 'false',
    f: 'json'
  });
  for (const [key, value] of spatialParams.entries()) {
    queryParams.set(key, value);
  }

  const url = `${layerQueryUrl(source)}?${queryParams.toString()}`;
  const result = await fetchJson(url, fetchFn);
  if (!result.ok) {
    return { ok: false, message: 'Category count query failed' };
  }

  const normalized = normalizeCategoryCountFeatures(result.data?.features || [], semanticField);
  const queryTime = new Date().toISOString();
  const radiusKm = request.radiusMeters / 1000;

  const provenance = {
    sourceId: source.id,
    sourceTitle: source.title,
    trustTier: source.trustTier,
    provider: source.provider,
    serviceUrl: source.serviceUrl,
    layerId: source.layerId,
    semanticField,
    spatialOperation: 'CATEGORY_COUNTS_WITHIN',
    radiusMeters: request.radiusMeters,
    radiusLabel: `${formatRadiusKm(request.radiusMeters)} km`,
    radiusKm,
    locationText: origin.locationText || null,
    matchedAddress: origin.matchedAddress || null,
    resultCount: normalized.totalFeaturesRepresented,
    totalCategories: normalized.totalCategories,
    queryTime,
    attribution: source.attribution,
    licence: source.licence,
    catalogueUrl: source.provenance?.catalogueUrl || null
  };

  const xrayResult = {
    operation: 'CATEGORY_COUNTS_WITHIN',
    sourceId: source.id,
    semanticField,
    radiusKm,
    radiusMeters: request.radiusMeters,
    matchedAddress: origin.matchedAddress || null,
    locationText: origin.locationText || null,
    categories: normalized.categories,
    totalCategories: normalized.totalCategories,
    totalFeaturesRepresented: normalized.totalFeaturesRepresented
  };

  return {
    ok: true,
    xrayResult,
    provenance,
    source: {
      id: source.id,
      name: source.title,
      authority: 'OpenStreetMap Amenities / OSM_NA_Amenities',
      catalogueUrl: source.provenance?.catalogueUrl || null,
      resourceUrl: source.serviceUrl,
      trust: TRUST_TIER_TRUSTED_EXTERNAL,
      attribution: source.attribution,
      licence: source.licence
    }
  };
}
