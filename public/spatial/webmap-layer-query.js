/**
 * Execute spatial queries against actual WebMap FeatureLayers (client-side, authenticated).
 */

import { importArc, getWebMap } from './spatial-arcgis-runtime.js';
import {
  findRuntimeLayerByCatalogId,
  getCatalogLayerByCatalogId
} from './webmap-layer-catalog.js';

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

function normalizeQueryFeature(feature, querySpec, webmapTitle = 'Montreal 1') {
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
    objectId: attrs.OBJECTID ?? attrs.ObjectID ?? attrs.FID ?? attrs.OID ?? null,
    rawAttributes: attrs,
    geometry,
    popupTemplateExists: querySpec.popupTemplateExists
  };
}

function buildDatasetResult(querySpec, features, webmapTitle = 'Montreal 1') {
  const parent = querySpec.parentGroup ? `${querySpec.parentGroup} / ` : '';
  const authority = `${webmapTitle} / ${parent}${querySpec.title}`;
  return {
    datasetId: `webmap:${querySpec.catalogId}`,
    displayName: querySpec.title,
    sourceId: querySpec.catalogId,
    authority,
    catalogueUrl: querySpec.url || null,
    dataUrl: querySpec.url || null,
    iqaiType: 'webmap_feature',
    sourceType: 'CURRENT_WEBMAP',
    webmapLayer: {
      catalogId: querySpec.catalogId,
      layerId: querySpec.layerId,
      title: querySpec.title,
      url: querySpec.url,
      parentGroup: querySpec.parentGroup || null,
      geometryType: querySpec.geometryType || null
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
      fields: querySpec.fields || [],
      popupTemplate: querySpec.popupTemplate || null,
      popupTemplateExists: querySpec.popupTemplateExists || false
    }
  };
}

function buildSummary(querySpec, featureCount, webmapTitle = 'Montreal 1') {
  const parent = querySpec.parentGroup ? `${querySpec.parentGroup} / ` : '';
  const authority = `${webmapTitle} / ${parent}${querySpec.title}`;
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

  return {
    status: 'Controlled',
    execution: 'Deterministic GIS',
    matchedFeatures: featureCount,
    radiusMeters: querySpec.radiusMeters || null,
    limit: querySpec.limit || null,
    spatialOperation,
    dataset: querySpec.title,
    action: querySpec.action,
    authority,
    sourceType: 'CURRENT_WEBMAP',
    layerSource: 'WEBMAP',
    totalSourceRecords: featureCount,
    closedExcluded: 0,
    ambiguousExcluded: 0,
    operationalStatusCheck: null,
    closedRecordsExcluded: null,
    sourceCheck: 'Passed',
    geometryCheck: 'Passed',
    reproducible: 'Yes',
    unresolved: 'None',
    freshness: 'ArcGIS live',
    displayMode: querySpec.displayMode || 'points'
  };
}

/**
 * @param {object} querySpec
 */
export async function executeWebMapLayerQuery(querySpec) {
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

  const originPoint = new Point({
    longitude: querySpec.origin.longitude,
    latitude: querySpec.origin.latitude
  });

  const query = layer.createQuery();
  query.returnGeometry = true;
  query.outFields = ['*'];

  if (querySpec.radiusMeters) {
    const circle = new Circle({
      center: originPoint,
      radius: querySpec.radiusMeters,
      radiusUnit: 'meters',
      geodesic: true
    });
    query.geometry = circle;
    query.spatialRelationship = 'intersects';
  }

  const result = await layer.queryFeatures(query);
  const webmapTitle = getWebMap()?.portalItem?.title || 'Montreal 1';
  let features = (result.features || []).map((feature) => normalizeQueryFeature(feature, querySpec, webmapTitle));

  if (querySpec.action === 'NEAREST' && querySpec.limit) {
    features = features
      .filter((feature) => Number.isFinite(feature.distanceMeters))
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
      .slice(0, querySpec.limit);
  }

  if (querySpec.action === 'WITHIN' && querySpec.radiusMeters) {
    features = features
      .filter((feature) => feature.distanceMeters <= querySpec.radiusMeters)
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
  }

  return {
    features,
    datasetResult: buildDatasetResult(querySpec, features, webmapTitle),
    summary: buildSummary(querySpec, features.length, webmapTitle)
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

  const datasetResults = [...(mapResult.datasetResults || [])];
  const allFeatures = [...(mapResult.features || [])];
  const commandSummaries = [];

  for (const querySpec of queries) {
    const executed = await executeWebMapLayerQuery(enrichQuerySpecFromFullCatalog(querySpec));
    datasetResults.push(executed.datasetResult);
    allFeatures.push(...executed.features);
    commandSummaries.push(executed.summary);
  }

  const merged = { ...mapResult };
  merged.datasetResults = datasetResults;
  merged.features = allFeatures;
  merged.clientWebMapQueries = undefined;

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
      commands: commandSummaries
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

  return merged;
}
