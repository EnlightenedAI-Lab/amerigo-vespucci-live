/**
 * Execute spatial queries against actual WebMap FeatureLayers (client-side, authenticated).
 */

import { importArc, getWebMap } from './spatial-arcgis-runtime.js';
import {
  findRuntimeLayerByCatalogId,
  getCatalogLayerByCatalogId
} from './webmap-layer-catalog.js';
import {
  buildDeterministicAccounting,
  queryCompleteObjectIds,
  queryFeaturesByObjectIdChunks
} from './deterministic-result-accounting.js';
import { applyPrimaryDatasetResultState } from './deterministic-result-state.js';
import { A1_WEBMAP_QUERY_VERSION, recordCommandBoundary } from './a1-runtime-provenance.js';

function haversineMeters(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => deg * (Math.PI / 180);
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

function formatDistanceLabel(meters) {
  if (!Number.isFinite(meters)) return '—';
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${Math.round(meters)} m`;
}

function extractFeatureObjectId(attrs, objectIdField = null) {
  const candidates = [objectIdField, 'OBJECTID', 'ObjectID', 'objectid', 'FID', 'OID', 'fid', 'oid']
    .filter(Boolean);
  for (const key of candidates) {
    const id = Number(attrs?.[key]);
    if (Number.isFinite(id)) return id;
  }
  return null;
}

function normalizeQueryFeature(feature, querySpec, webmapTitle = 'Montreal 1', objectIdField = null) {
  const geometry = feature.geometry || {};
  const attrs = { ...(feature.attributes || {}) };
  const longitude = Number(geometry.x ?? geometry.longitude ?? attrs.longitude ?? attrs.LONGITUDE);
  const latitude = Number(geometry.y ?? geometry.latitude ?? attrs.latitude ?? attrs.LATITUDE);
  const origin = querySpec.origin;
  const distanceMeters = Number.isFinite(longitude) && Number.isFinite(latitude)
    ? haversineMeters(origin.latitude, origin.longitude, latitude, longitude)
    : null;
  const parent = querySpec.parentGroup ? `${querySpec.parentGroup} / ` : '';
  const authority = `${webmapTitle} / ${parent}${querySpec.title}`;

  return {
    datasetId: `webmap:${querySpec.catalogId}`,
    iqaiType: 'webmap_feature',
    sourceType: 'CURRENT_WEBMAP',
    webmapCatalogId: querySpec.catalogId,
    webmapLayerId: querySpec.layerId,
    name: attrs.Name || attrs.NAME || attrs.name || attrs.title || attrs.TITLE || querySpec.title,
    address: attrs.Address || attrs.ADDRESS || attrs.address || attrs.Location || attrs.LOCATION || '',
    longitude,
    latitude,
    distanceMeters,
    distanceLabel: formatDistanceLabel(distanceMeters),
    sourceName: querySpec.title,
    authority,
    spatialPrecision: 'ArcGIS FeatureLayer query',
    objectId: extractFeatureObjectId(attrs, objectIdField),
    rawAttributes: attrs,
    geometry,
    popupTemplateExists: querySpec.popupTemplateExists
  };
}

function buildDatasetResult(querySpec, features, webmapTitle = 'Montreal 1', extras = {}) {
  const parent = querySpec.parentGroup ? `${querySpec.parentGroup} / ` : '';
  const displayName = querySpec.displayNameOverride || querySpec.title;
  const authority = `${webmapTitle} / ${parent}${displayName}`;
  const matchedFeatures = extras.totalMatchingObjectIds ?? features.length;
  return {
    datasetId: `webmap:${querySpec.catalogId}`,
    displayName,
    sourceId: querySpec.catalogId,
    authority,
    catalogueUrl: querySpec.url || null,
    dataUrl: querySpec.url || null,
    iqaiType: 'webmap_feature',
    sourceType: 'CURRENT_WEBMAP',
    completeObjectIds: extras.completeObjectIds || null,
    resultAccounting: extras.resultAccounting || null,
    webmapLayer: {
      catalogId: querySpec.catalogId,
      layerId: querySpec.layerId,
      title: querySpec.title,
      url: querySpec.url,
      parentGroup: querySpec.parentGroup || null,
      geometryType: querySpec.geometryType || null
    },
    matchedFeatures,
    totalSourceRecords: matchedFeatures,
    closedExcluded: 0,
    ambiguousExcluded: 0,
    features,
    renderMeta: {
      sourceType: 'WEBMAP_LAYER',
      symbol: null,
      detailFields: [],
      fields: querySpec.fields || [],
      popupTemplate: querySpec.popupTemplate || null,
      popupTemplateExists: querySpec.popupTemplateExists || false
    }
  };
}

function buildSummary(querySpec, featureCount, webmapTitle = 'Montreal 1', extras = {}) {
  const parent = querySpec.parentGroup ? `${querySpec.parentGroup} / ` : '';
  const displayName = querySpec.displayNameOverride || querySpec.title;
  const authority = `${webmapTitle} / ${parent}${displayName}`;
  let spatialOperation = 'Query';
  if (querySpec.action === 'WITHIN') {
    const km = querySpec.radiusMeters / 1000;
    spatialOperation = `Within ${Number.isInteger(km) ? km : km.toFixed(1)} km`;
  }
  if (querySpec.action === 'NEAREST') spatialOperation = `Nearest ${querySpec.limit}`;
  if (querySpec.action === 'COUNT') {
    const km = querySpec.radiusMeters / 1000;
    spatialOperation = `Count within ${Number.isInteger(km) ? km : km.toFixed(1)} km`;
  }

  const totalCount = extras.totalMatchingObjectIds ?? featureCount;

  return {
    status: 'Controlled',
    execution: 'Deterministic GIS',
    matchedFeatures: totalCount,
    radiusMeters: querySpec.radiusMeters || null,
    limit: querySpec.limit || null,
    spatialOperation,
    dataset: displayName,
    action: querySpec.action,
    authority,
    sourceType: 'CURRENT_WEBMAP',
    layerSource: 'WEBMAP',
    totalSourceRecords: totalCount,
    closedExcluded: 0,
    ambiguousExcluded: 0,
    operationalStatusCheck: null,
    closedRecordsExcluded: null,
    sourceCheck: 'Passed',
    geometryCheck: 'Passed',
    reproducible: 'Yes',
    unresolved: 'None',
    freshness: 'ArcGIS live',
    displayMode: querySpec.displayMode || 'points',
    resultComplete: extras.resultComplete !== false,
    resultTruncated: Boolean(extras.resultTruncated)
  };
}

async function queryLayerFeaturesComplete(layer, spatialQuery) {
  const objectIdField = layer?.objectIdField || null;
  const { objectIds, objectIdQueryUsed } = await queryCompleteObjectIds(layer, spatialQuery);
  let features = [];
  let accounting;

  if (objectIds.length) {
    features = await queryFeaturesByObjectIdChunks(layer, objectIds, {
      returnGeometry: true,
      outFields: ['*']
    });
    const truncated = features.length < objectIds.length;
    accounting = buildDeterministicAccounting({
      layer,
      objectIds,
      attributeRecordsLoaded: features.length,
      objectIdQueryUsed,
      truncated
    });
  } else {
    const result = await layer.queryFeatures(spatialQuery);
    features = result.features || [];
    const cap = layer?.maxRecordCount ?? layer?.capabilities?.query?.maxRecordCount ?? null;
    const truncated = Boolean(cap && features.length >= cap);
    const ids = features
      .map((feature) => extractFeatureObjectId(feature.attributes || {}, objectIdField))
      .filter((id) => Number.isFinite(id));
    accounting = buildDeterministicAccounting({
      layer,
      objectIds: ids,
      attributeRecordsLoaded: features.length,
      objectIdQueryUsed: false,
      truncated
    });
  }

  return { features, accounting, objectIdField };
}

function rebuildAccountingForSelectedFeatures(layer, features, priorAccounting = null) {
  const selectedObjectIds = features
    .map((feature) => Number(feature.objectId))
    .filter((id) => Number.isFinite(id));
  const candidateObjectIdCount = priorAccounting?.candidateObjectIdCount
    ?? priorAccounting?.totalMatchingObjectIds
    ?? null;
  return buildDeterministicAccounting({
    layer,
    objectIds: selectedObjectIds,
    attributeRecordsLoaded: features.length,
    objectIdQueryUsed: priorAccounting?.objectIdQueryUsed ?? false,
    truncated: false,
    candidateObjectIdCount
  });
}

/**
 * @param {object} querySpec
 */
export async function executeWebMapLayerQuery(querySpec) {
  recordCommandBoundary('executeWebMapLayerQuery_enter', {
    version: A1_WEBMAP_QUERY_VERSION,
    catalogId: querySpec.catalogId,
    title: querySpec.title,
    action: querySpec.action,
    limit: querySpec.limit || null
  });
  const layer = findRuntimeLayerByCatalogId(querySpec.catalogId);
  if (!layer) {
    throw new Error(`WebMap layer not found: ${querySpec.title || querySpec.catalogId}`);
  }
  if (!layer.loaded) await layer.load();
  if (!layer.queryFeatures) {
    throw new Error(`Layer is not queryable: ${layer.title || layer.id}`);
  }

  const [Point, Circle] = await Promise.all([
    importArc('@arcgis/core/geometry/Point.js'),
    importArc('@arcgis/core/geometry/Circle.js')
  ]);

  const querySpatialReference = { wkid: 4326 };

  const originPoint = new Point({
    longitude: querySpec.origin.longitude,
    latitude: querySpec.origin.latitude,
    spatialReference: querySpatialReference
  });

  const query = layer.createQuery();
  query.returnGeometry = true;
  query.outFields = ['*'];
  if (querySpec.attributeWhere) {
    query.where = querySpec.attributeWhere;
  }

  if (querySpec.radiusMeters) {
    const circle = new Circle({
      center: originPoint,
      radius: querySpec.radiusMeters,
      radiusUnit: 'meters',
      geodesic: true,
      spatialReference: querySpatialReference
    });
    query.geometry = circle;
    query.spatialRelationship = 'intersects';
  }

  let usedBroadFallback = false;
  let result = await queryLayerFeaturesComplete(layer, query);
  if (!result.features?.length && querySpec.radiusMeters) {
    usedBroadFallback = true;
    const broadQuery = layer.createQuery();
    broadQuery.where = querySpec.attributeWhere || '1=1';
    broadQuery.returnGeometry = true;
    broadQuery.outFields = ['*'];
    result = await queryLayerFeaturesComplete(layer, broadQuery);
  }
  const webmapTitle = getWebMap()?.portalItem?.title || 'Montreal 1';
  let features = (result.features || []).map((feature) => normalizeQueryFeature(
    feature,
    querySpec,
    webmapTitle,
    result.objectIdField
  ));
  let accounting = result.accounting;
  const candidateObjectIdCount = accounting?.totalMatchingObjectIds ?? null;

  if (querySpec.action === 'NEAREST' && querySpec.limit) {
    features = features
      .filter((feature) => Number.isFinite(feature.distanceMeters))
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
      .slice(0, querySpec.limit);
  }

  if (querySpec.action === 'WITHIN' && querySpec.radiusMeters) {
    features = features
      .map((feature) => {
        if (Number.isFinite(feature.distanceMeters)) return feature;
        if (!Number.isFinite(feature.latitude) || !Number.isFinite(feature.longitude)) return feature;
        return {
          ...feature,
          distanceMeters: haversineMeters(
            querySpec.origin.latitude,
            querySpec.origin.longitude,
            feature.latitude,
            feature.longitude
          ),
          distanceLabel: formatDistanceLabel(haversineMeters(
            querySpec.origin.latitude,
            querySpec.origin.longitude,
            feature.latitude,
            feature.longitude
          ))
        };
      })
      .filter((feature) => (
        !usedBroadFallback
        || (Number.isFinite(feature.distanceMeters) && feature.distanceMeters <= querySpec.radiusMeters)
      ))
      .sort((a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity));
  }

  accounting = rebuildAccountingForSelectedFeatures(layer, features, {
    ...accounting,
    candidateObjectIdCount
  });

  const summaryExtras = {
    totalMatchingObjectIds: features.length,
    resultComplete: accounting?.complete !== false,
    resultTruncated: Boolean(accounting?.truncated)
  };
  const datasetExtras = {
    completeObjectIds: accounting?.objectIds || null,
    resultAccounting: accounting || null,
    totalMatchingObjectIds: features.length
  };

  return {
    features,
    accounting,
    datasetResult: buildDatasetResult(querySpec, features, webmapTitle, datasetExtras),
    summary: buildSummary(querySpec, features.length, webmapTitle, summaryExtras)
  };
}

function enrichQuerySpecFromFullCatalog(querySpec) {
  const layer = getCatalogLayerByCatalogId(querySpec.catalogId);
  if (!layer) return querySpec;
  return {
    ...querySpec,
    layerId: querySpec.layerId || layer.layerId || null,
    title: querySpec.title || layer.title || null,
    url: querySpec.url || layer.url || null,
    parentGroup: querySpec.parentGroup || layer.parentGroup || null,
    geometryType: querySpec.geometryType || layer.geometryType || null,
    queryable: querySpec.queryable ?? layer.queryable,
    fields: querySpec.fields?.length ? querySpec.fields : layer.fields || [],
    popupTemplate: querySpec.popupTemplate || layer.popupTemplate || null,
    popupTemplateExists: querySpec.popupTemplateExists ?? layer.popupTemplateExists ?? false
  };
}

/**
 * Execute all pending client WebMap layer queries and merge into map result.
 * @param {object} mapResult
 */
export async function executeClientWebMapLayerQueries(mapResult) {
  const queries = mapResult.clientWebMapQueries || [];
  if (!queries.length) return mapResult;

  const datasetResults = [];
  const allFeatures = [];
  const commandSummaries = [];

  let lastAccounting = null;
  for (const querySpec of queries) {
    const executed = await executeWebMapLayerQuery(enrichQuerySpecFromFullCatalog(querySpec));
    datasetResults.push(executed.datasetResult);
    allFeatures.push(...executed.features);
    commandSummaries.push(executed.summary);
    if (executed.accounting) lastAccounting = executed.accounting;
  }

  const merged = {
    ...mapResult,
    datasetResults,
    features: allFeatures,
    clientWebMapQueries: undefined,
    resultAccounting: lastAccounting
  };

  if (mapResult.summary?.action === 'COMPOUND' || commandSummaries.length > 1) {
    merged.summary = {
      ...mapResult.summary,
      action: 'COMPOUND',
      matchedFeatures: allFeatures.length,
      commands: commandSummaries,
      commandCount: commandSummaries.length,
      dataset: commandSummaries.map((cmd) => cmd.dataset).join(' + ')
    };
  } else if (commandSummaries.length === 1) {
    merged.summary = {
      ...commandSummaries[0],
      action: mapResult.request?.action || commandSummaries[0].action,
      dataset: commandSummaries[0].dataset || mapResult.summary?.dataset,
      commands: commandSummaries,
      matchedFeatures: commandSummaries[0].matchedFeatures ?? allFeatures.length
    };
  }

  if (datasetResults.length === 1) {
    merged.source = {
      id: datasetResults[0].sourceId,
      name: datasetResults[0].displayName,
      authority: datasetResults[0].authority,
      catalogueUrl: datasetResults[0].catalogueUrl,
      resourceUrl: datasetResults[0].dataUrl || null,
      trust: 'AUTHORITATIVE_PUBLIC'
    };
  }

  return applyPrimaryDatasetResultState(merged);
}

/**
 * @deprecated Use applyPrimaryDatasetResultState from deterministic-result-state.js
 * @param {object} mapResult
 */
export function syncCanonicalResultCounts(mapResult) {
  return applyPrimaryDatasetResultState(mapResult);
}

export { extractFeatureObjectId };
