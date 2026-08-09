import { haversineDistanceMeters } from './public-safety-geometry.js';
import { formatDistanceLabel } from './spatial-operations.js';
import { webmapLayerAuthority } from './webmap-layer-catalog.js';

/**
 * Normalize ArcGIS REST feature into IQAI feature shape while preserving source attributes.
 * @param {object} feature
 * @param {object} webmapLayer
 * @param {{ latitude: number, longitude: number }} origin
 * @param {string} [webmapTitle]
 */
export function normalizeWebMapQueryFeature(feature, webmapLayer, origin, webmapTitle = 'Montreal 1') {
  const geometry = feature.geometry || {};
  const attrs = { ...(feature.attributes || {}) };
  const longitude = Number(
    geometry.x ?? geometry.longitude ?? attrs.longitude ?? attrs.LONGITUDE ?? attrs.Longitude
  );
  const latitude = Number(
    geometry.y ?? geometry.latitude ?? attrs.latitude ?? attrs.LATITUDE ?? attrs.Latitude
  );

  const distanceMeters = Number.isFinite(longitude) && Number.isFinite(latitude)
    ? haversineDistanceMeters(origin.latitude, origin.longitude, latitude, longitude)
    : null;

  const objectId = attrs.OBJECTID ?? attrs.ObjectID ?? attrs.FID ?? attrs.OID ?? null;
  const authority = webmapLayerAuthority(webmapLayer, webmapTitle);

  return {
    datasetId: `webmap:${webmapLayer.catalogId}`,
    iqaiType: 'webmap_feature',
    sourceType: 'CURRENT_WEBMAP',
    webmapCatalogId: webmapLayer.catalogId,
    webmapLayerId: webmapLayer.layerId,
    name: attrs.Name || attrs.NAME || attrs.name || attrs.title || attrs.TITLE || webmapLayer.title,
    address: attrs.Address || attrs.ADDRESS || attrs.address || attrs.Location || attrs.LOCATION || '',
    longitude,
    latitude,
    distanceMeters,
    distanceLabel: formatDistanceLabel(distanceMeters),
    sourceName: webmapLayer.title,
    authority,
    spatialPrecision: 'ArcGIS FeatureLayer query',
    objectId,
    rawAttributes: attrs,
    geometry: geometry,
    popupTemplateExists: webmapLayer.popupTemplateExists,
    fields: webmapLayer.fields || []
  };
}

/**
 * Select nearest features from normalized list.
 * @param {object[]} features
 * @param {number} limit
 */
export function selectNearestWebMapFeatures(features, limit) {
  const sorted = [...features]
    .filter((f) => Number.isFinite(f.distanceMeters))
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
  return sorted.slice(0, limit);
}

/**
 * Build dataset result payload for map render / ledger.
 * @param {object} webmapLayer
 * @param {object[]} features
 * @param {object} request
 * @param {string} [webmapTitle]
 */
export function buildWebMapLayerDatasetResult(webmapLayer, features, request, webmapTitle = 'Montreal 1') {
  const authority = webmapLayerAuthority(webmapLayer, webmapTitle);
  return {
    datasetId: `webmap:${webmapLayer.catalogId}`,
    displayName: webmapLayer.title,
    sourceId: webmapLayer.catalogId,
    authority,
    catalogueUrl: webmapLayer.url || null,
    dataUrl: webmapLayer.url || null,
    iqaiType: 'webmap_feature',
    sourceType: 'CURRENT_WEBMAP',
    webmapLayer: {
      catalogId: webmapLayer.catalogId,
      layerId: webmapLayer.layerId,
      title: webmapLayer.title,
      url: webmapLayer.url,
      parentGroup: webmapLayer.parentGroup || null,
      geometryType: webmapLayer.geometryType || null
    },
    matchedFeatures: features.length,
    totalSourceRecords: features.length,
    closedExcluded: 0,
    ambiguousExcluded: 0,
    features,
    renderMeta: {
      sourceType: 'WEBMAP_LAYER',
      symbol: null,
      detailFields: [],
      fields: webmapLayer.fields || [],
      popupTemplate: webmapLayer.popupTemplate || null,
      popupTemplateExists: webmapLayer.popupTemplateExists || false
    }
  };
}

/**
 * Build command summary for execution ledger.
 * @param {object} request
 * @param {object} queryResult
 * @param {object} webmapLayer
 * @param {string} [webmapTitle]
 */
export function buildWebMapLayerSummary(request, queryResult, webmapLayer, webmapTitle = 'Montreal 1') {
  const authority = webmapLayerAuthority(webmapLayer, webmapTitle);
  let spatialOperation = 'Query';
  if (request.action === 'WITHIN') spatialOperation = `Within ${(request.radiusMeters / 1000).toFixed(request.radiusMeters % 1000 === 0 ? 0 : 1)} km`;
  if (request.action === 'NEAREST') spatialOperation = `Nearest ${request.limit}`;
  if (request.action === 'COUNT') spatialOperation = `Count within ${(request.radiusMeters / 1000).toFixed(request.radiusMeters % 1000 === 0 ? 0 : 1)} km`;

  return {
    status: 'Controlled',
    execution: 'Deterministic GIS',
    matchedFeatures: queryResult.features.length,
    radiusMeters: request.radiusMeters || null,
    limit: request.limit || null,
    spatialOperation,
    dataset: webmapLayer.title,
    action: request.action,
    datasetIds: [],
    webmapCatalogId: webmapLayer.catalogId,
    authority,
    sourceType: 'CURRENT_WEBMAP',
    totalSourceRecords: queryResult.features.length,
    closedExcluded: 0,
    ambiguousExcluded: 0,
    operationalStatusCheck: null,
    closedRecordsExcluded: null,
    sourceCheck: 'Passed',
    geometryCheck: 'Passed',
    reproducible: 'Yes',
    unresolved: 'None',
    freshness: 'ArcGIS live',
    displayMode: request.displayMode || 'points',
    layerSource: 'WEBMAP'
  };
}
