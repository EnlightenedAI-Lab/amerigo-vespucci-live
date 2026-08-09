import { getApprovedExternalSource, TRUST_TIER_TRUSTED_EXTERNAL } from './approved-external-source-registry.js';
import { getSemanticCategoryById } from './semantic-category-registry.js';
import { formatSemanticDisplayName } from './semantic-vocabulary-matcher.js';
import { DEFAULT_RESULT_SYMBOL } from './result-symbol-registry.js';
import { attachDistanceLabels, formatRadiusKm } from './spatial-operations.js';
import { haversineDistanceMeters } from './public-safety-geometry.js';

export const DIRECT_FETCH_THRESHOLD = 500;
export const HARD_EXECUTION_MAX = 2000;
export const QUERY_TIMEOUT_MS = 30_000;

function escapeSqlLiteral(value) {
  return String(value || '').replace(/'/g, "''");
}

function buildCategoryWhere(filter) {
  if (!filter?.field || !filter?.value) return null;
  const field = String(filter.field).trim();
  const value = escapeSqlLiteral(filter.value);
  if (filter.operator === 'EQ' || !filter.operator) {
    return `${field} = '${value}'`;
  }
  return null;
}

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

async function validateSourceSchema(source, fetchFn) {
  const base = String(source.serviceUrl || '').replace(/\/$/, '');
  const result = await fetchJson(`${base}/${source.layerId}?f=json`, fetchFn);
  if (!result.ok) return { ok: false, message: `External source unavailable: ${source.id}` };
  const layer = result.data;
  const semanticField = source.semanticField || source.categoryField;
  const fieldNames = (layer.fields || []).map((field) => field.name);
  if (!fieldNames.includes(semanticField)) {
    return { ok: false, message: `External source schema changed: missing ${semanticField}` };
  }
  return {
    ok: true,
    dataLastEditDate: layer.editingInfo?.dataLastEditDate || null
  };
}

function resolveCategoryForRequest(request, source) {
  if (request.semanticCategory) return request.semanticCategory;
  if (request.conceptId) {
    const registered = getSemanticCategoryById(request.conceptId);
    if (registered) return registered;
  }
  const filter = request.categoryFilter;
  const semanticValue = request.semanticValue || filter?.value;
  const semanticField = request.semanticField || filter?.field || source.semanticField || source.categoryField;
  if (!semanticValue || !semanticField) return null;

  const displayName = formatSemanticDisplayName(semanticValue);
  return {
    conceptId: request.conceptId || `AMENITY:${semanticValue}`,
    displayName,
    pluralLabel: displayName,
    sourceId: source.id,
    semanticField,
    semanticValue,
    dynamic: true,
    filter: filter || { field: semanticField, operator: 'EQ', value: semanticValue },
    iqaiType: 'osm_amenity',
    symbol: { ...DEFAULT_RESULT_SYMBOL },
    detailFields: [
      { label: 'Name', attribute: 'name' },
      { label: 'Address', attribute: 'addr_street' },
      { label: 'City', attribute: 'addr_city' },
      { label: 'Amenity', attribute: semanticField },
      { label: 'Distance from query', attribute: 'distanceLabel' },
      { label: 'Source', attribute: 'sourceName' },
      { label: 'Spatial precision', attribute: 'spatialPrecision', defaultValue: 'Deterministic GIS' }
    ]
  };
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

/**
 * Validate WGS84 geographic coordinates from an external source response.
 * @param {number} longitude
 * @param {number} latitude
 * @param {string} [sourceId]
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function validateGeographicCoordinates(longitude, latitude, sourceId = 'external') {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    return {
      ok: false,
      message: `External source ${sourceId}: geometry missing finite longitude/latitude`
    };
  }
  if (longitude < -180 || longitude > 180) {
    return {
      ok: false,
      message: `External source ${sourceId}: longitude ${longitude} outside [-180, 180]`
    };
  }
  if (latitude < -90 || latitude > 90) {
    return {
      ok: false,
      message: `External source ${sourceId}: latitude ${latitude} outside [-90, 90]`
    };
  }
  return { ok: true };
}

function normalizeExternalFeature(category, feature, origin, queryTime, sourceId) {
  const geometry = feature?.geometry || {};
  const attrs = feature?.attributes || {};
  const longitude = Number(geometry.x ?? geometry.longitude);
  const latitude = Number(geometry.y ?? geometry.latitude);
  const validation = validateGeographicCoordinates(
    longitude,
    latitude,
    sourceId || category?.sourceId || 'external'
  );
  if (!validation.ok) {
    throw new Error(validation.message);
  }

  const raw = { ...attrs };
  const distanceMeters = haversineDistanceMeters(
    origin.latitude,
    origin.longitude,
    latitude,
    longitude
  );

  return {
    datasetId: `concept:${category.conceptId}`,
    conceptId: category.conceptId,
    iqaiType: category.iqaiType,
    sourceType: TRUST_TIER_TRUSTED_EXTERNAL,
    name: raw.name || raw.name_fr || raw.name_en || null,
    address: raw.addr_street || '',
    longitude,
    latitude,
    distanceMeters,
    objectId: raw.OBJECTID ?? raw.ObjectID ?? null,
    sourceName: category.displayName,
    authority: 'OpenStreetMap Amenities / OSM_NA_Amenities',
    spatialPrecision: 'ArcGIS FeatureServer headless query',
    receivedAt: queryTime,
    rawAttributes: raw
  };
}

/**
 * @param {object} request
 * @param {{ latitude: number, longitude: number }} origin
 * @param {{ fetchFn?: typeof fetch }} [options]
 */
export async function executeExternalFeatureQuery(request, origin, options = {}) {
  const fetchFn = options.fetchFn || globalThis.fetch;
  const source = getApprovedExternalSource(request.sourceId);
  if (!source) {
    return {
      ok: false,
      message: 'Approved external source not registered'
    };
  }
  if (!source.queryable || !source.headless) {
    return { ok: false, message: 'External source is not approved for headless query' };
  }
  if (!request.radiusMeters || request.radiusMeters <= 0) {
    return { ok: false, message: 'External queries require a bounded search radius' };
  }

  const category = resolveCategoryForRequest(request, source);
  if (!category) {
    return { ok: false, message: 'Semantic category not registered' };
  }

  const schema = await validateSourceSchema(source, fetchFn);
  if (!schema.ok) {
    return { ok: false, message: schema.message };
  }

  const where = buildCategoryWhere(request.categoryFilter || category.filter);
  if (!where) {
    return { ok: false, message: 'External category filter is invalid' };
  }

  const spatialParams = buildSpatialQueryParams(origin, request.radiusMeters);
  const countUrl = `${layerQueryUrl(source)}?where=${encodeURIComponent(where)}&returnCountOnly=true&f=json&${spatialParams.toString()}`;
  const countResult = await fetchJson(countUrl, fetchFn);
  if (!countResult.ok) {
    return { ok: false, message: 'External source query failed' };
  }

  const count = Number(countResult.data?.count ?? 0);
  if (!Number.isFinite(count)) {
    return { ok: false, message: 'External source returned malformed count' };
  }
  if (count > HARD_EXECUTION_MAX) {
    return {
      ok: false,
      message: `Result count (${count}) exceeds hard execution maximum (${HARD_EXECUTION_MAX}). Narrow the search area.`
    };
  }
  if (count > DIRECT_FETCH_THRESHOLD && request.action !== 'COUNT') {
    return {
      ok: false,
      message: `Result count (${count}) exceeds safe display limit (${DIRECT_FETCH_THRESHOLD}). Narrow the search area.`,
      countExceeded: true,
      count
    };
  }

  const queryTime = new Date().toISOString();
  let features = [];

  if (count > 0 && request.action !== 'COUNT') {
    const outFields = source.fields.join(',');
    const fetchUrl = `${layerQueryUrl(source)}?where=${encodeURIComponent(where)}&outFields=${encodeURIComponent(outFields)}&returnGeometry=true&outSR=4326&f=json&resultRecordCount=${HARD_EXECUTION_MAX}&${spatialParams.toString()}`;
    const fetchResult = await fetchJson(fetchUrl, fetchFn);
    if (!fetchResult.ok) {
      return { ok: false, message: 'External source feature fetch failed' };
    }
    const rawFeatures = fetchResult.data?.features || [];
    try {
      for (const feature of rawFeatures) {
        const normalized = normalizeExternalFeature(
          category,
          feature,
          origin,
          queryTime,
          source.id
        );
        features.push(normalized);
      }
    } catch (error) {
      return {
        ok: false,
        message: error?.message || 'External source geometry normalization failed'
      };
    }
    if (!Array.isArray(rawFeatures) || (count > 0 && rawFeatures.length === 0)) {
      return { ok: false, message: 'External source returned malformed features' };
    }
  }

  features = attachDistanceLabels(features);

  const freshness = schema.dataLastEditDate
    ? new Date(schema.dataLastEditDate).toISOString()
    : 'Unavailable';

  const provenance = {
    sourceId: source.id,
    sourceTitle: source.title,
    trustTier: source.trustTier,
    provider: source.provider,
    serviceUrl: source.serviceUrl,
    layerId: source.layerId,
    semanticField: category.semanticField || category.filter?.field || source.semanticField || source.categoryField,
    semanticValue: category.semanticValue || category.filter?.value || null,
    categoryFilter: category.filter,
    spatialOperation: request.action,
    radiusMeters: request.radiusMeters,
    radiusLabel: `${formatRadiusKm(request.radiusMeters)} km`,
    locationText: origin.locationText || null,
    matchedAddress: origin.matchedAddress || null,
    resultCount: count,
    queryTime,
    freshness,
    attribution: source.attribution,
    licence: source.licence,
    catalogueUrl: source.provenance?.catalogueUrl || null
  };

  const datasetResult = {
    datasetId: `concept:${category.conceptId}`,
    conceptId: category.conceptId,
    displayName: category.displayName,
    sourceId: source.id,
    authority: 'OpenStreetMap Amenities / OSM_NA_Amenities',
    catalogueUrl: source.provenance?.catalogueUrl || null,
    dataUrl: source.serviceUrl,
    iqaiType: category.iqaiType,
    sourceType: TRUST_TIER_TRUSTED_EXTERNAL,
    matchedFeatures: request.action === 'COUNT' ? count : features.length,
    totalSourceRecords: count,
    closedExcluded: 0,
    ambiguousExcluded: 0,
    features: request.action === 'COUNT' ? [] : features,
    provenance,
    renderMeta: {
      sourceType: TRUST_TIER_TRUSTED_EXTERNAL,
      symbol: category.symbol,
      detailFields: category.detailFields,
      semanticField: category.semanticField || category.filter?.field || null,
      semanticValue: category.semanticValue || category.filter?.value || null,
      fields: source.fields.map((name) => ({ name, alias: name }))
    }
  };

  return {
    ok: true,
    features: request.action === 'COUNT' ? [] : features,
    datasetResults: [datasetResult],
    totalSourceRecords: count,
    closedExcluded: 0,
    ambiguousExcluded: 0,
    provenance
  };
}
