/**
 * Deterministic GIS result accounting — complete OBJECTID sets, receipts, dev diagnostics.
 * Presentation / data completeness only; does not alter AUTH-NATIVE rendering architecture.
 */

import { formatAmenityCategory } from './iqai-osm-presentation.js';
import { buildRendererClassIndex, resolveRendererClass, normalizeRendererClassValue } from './result-legend-model.js';
import {
  A1_ACCOUNTING_VERSION,
  recordQueryObjectIdsProvenance
} from './a1-runtime-provenance.js';

export function resolveQueryChunkSize(layer) {
  const cap = layer?.capabilities?.query?.maxRecordCount
    ?? layer?.maxRecordCount
    ?? 1000;
  return Math.min(Math.max(1, Number(cap) || 1000), 1000);
}

/**
 * @param {import('@arcgis/core/layers/FeatureLayer').default} layer
 * @param {import('@arcgis/core/rest/support/Query').default} spatialQuery
 */
export async function queryCompleteObjectIds(layer, spatialQuery) {
  let queryObjectIdsCalled = false;
  let returnType = 'none';
  let returnCount = 0;
  let parsedCount = 0;
  let fallbackQueryFeaturesUsed = false;

  if (typeof layer?.queryObjectIds === 'function') {
    queryObjectIdsCalled = true;
    try {
      const oidResult = await layer.queryObjectIds(spatialQuery);
      returnType = Array.isArray(oidResult) ? 'Array' : (oidResult?.objectIds ? 'object' : typeof oidResult);
      const rawIds = Array.isArray(oidResult)
        ? oidResult
        : (oidResult?.objectIds || []);
      returnCount = rawIds.length;
      const objectIds = rawIds
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id));
      parsedCount = objectIds.length;
      if (objectIds.length) {
        recordQueryObjectIdsProvenance({
          version: A1_ACCOUNTING_VERSION,
          queryObjectIdsCalled,
          returnType,
          returnCount,
          parsedObjectIdCount: parsedCount,
          fallbackQueryFeaturesUsed: false,
          layerTitle: layer?.title || null,
          layerUrl: layer?.url || layer?.parsedUrl?.path || null
        });
        return { objectIds, objectIdQueryUsed: true };
      }
    } catch (error) {
      returnType = 'error';
      recordQueryObjectIdsProvenance({
        version: A1_ACCOUNTING_VERSION,
        queryObjectIdsCalled,
        returnType,
        returnCount: 0,
        parsedObjectIdCount: 0,
        fallbackQueryFeaturesUsed: false,
        error: error?.message || String(error)
      });
      // fall through to returnIdsOnly queryFeatures path
    }
  }

  if (typeof layer?.queryFeatures === 'function') {
    fallbackQueryFeaturesUsed = true;
    try {
      const idQuery = typeof spatialQuery?.clone === 'function'
        ? spatialQuery.clone()
        : layer.createQuery();
      if (typeof spatialQuery?.clone !== 'function') {
        idQuery.geometry = spatialQuery.geometry;
        idQuery.spatialRelationship = spatialQuery.spatialRelationship;
        idQuery.where = spatialQuery.where || '1=1';
        idQuery.distance = spatialQuery.distance;
        idQuery.units = spatialQuery.units;
      }
      idQuery.returnGeometry = false;
      idQuery.outFields = [];
      idQuery.returnIdsOnly = true;
      const result = await layer.queryFeatures(idQuery);
      returnType = Array.isArray(result) ? 'Array' : 'object';
      const rawIds = result?.objectIds || [];
      returnCount = rawIds.length;
      const objectIds = rawIds
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id));
      parsedCount = objectIds.length;
      if (objectIds.length) {
        recordQueryObjectIdsProvenance({
          version: A1_ACCOUNTING_VERSION,
          queryObjectIdsCalled,
          returnType,
          returnCount,
          parsedObjectIdCount: parsedCount,
          fallbackQueryFeaturesUsed,
          layerTitle: layer?.title || null,
          layerUrl: layer?.url || layer?.parsedUrl?.path || null
        });
        return { objectIds, objectIdQueryUsed: true };
      }
    } catch (error) {
      recordQueryObjectIdsProvenance({
        version: A1_ACCOUNTING_VERSION,
        queryObjectIdsCalled,
        returnType: 'error',
        returnCount: 0,
        parsedObjectIdCount: 0,
        fallbackQueryFeaturesUsed,
        error: error?.message || String(error)
      });
      // fall through
    }
  }

  recordQueryObjectIdsProvenance({
    version: A1_ACCOUNTING_VERSION,
    queryObjectIdsCalled,
    returnType,
    returnCount,
    parsedObjectIdCount: parsedCount,
    fallbackQueryFeaturesUsed,
    layerTitle: layer?.title || null,
    layerUrl: layer?.url || layer?.parsedUrl?.path || null
  });
  return { objectIds: [], objectIdQueryUsed: false };
}

/**
 * @param {import('@arcgis/core/layers/FeatureLayer').default} layer
 * @param {number[]} objectIds
 * @param {{ returnGeometry?: boolean, outFields?: string[] }} [options]
 */
export async function queryFeaturesByObjectIdChunks(layer, objectIds, options = {}) {
  const chunkSize = resolveQueryChunkSize(layer);
  const returnGeometry = options.returnGeometry !== false;
  const outFields = options.outFields || ['*'];
  const features = [];

  for (let offset = 0; offset < objectIds.length; offset += chunkSize) {
    const chunk = objectIds.slice(offset, offset + chunkSize);
    const chunkQuery = layer.createQuery();
    chunkQuery.objectIds = chunk;
    chunkQuery.outFields = outFields;
    chunkQuery.returnGeometry = returnGeometry;
    const chunkResult = await layer.queryFeatures(chunkQuery);
    features.push(...(chunkResult.features || []));
  }

  return features;
}

/**
 * @param {object} params
 */
export function buildDeterministicAccounting({
  layer = null,
  objectIds = [],
  attributeRecordsLoaded = 0,
  objectIdQueryUsed = false,
  truncated = false,
  candidateObjectIdCount = null
} = {}) {
  const sourceMaxRecordCount = layer?.maxRecordCount
    ?? layer?.capabilities?.query?.maxRecordCount
    ?? null;
  const totalMatchingObjectIds = objectIds.length;
  const complete = !truncated
    && totalMatchingObjectIds > 0
    && attributeRecordsLoaded >= totalMatchingObjectIds;

  return {
    sourceMaxRecordCount,
    totalMatchingObjectIds,
    attributeRecordsLoaded,
    complete,
    truncated,
    objectIdQueryUsed,
    objectIds: [...objectIds],
    candidateObjectIdCount: Number.isFinite(candidateObjectIdCount)
      ? candidateObjectIdCount
      : null
  };
}

/**
 * @param {object} mapResult
 * @param {object | null} presentation
 */
export function computeCategoryAccounting(mapResult, presentation = null) {
  const datasetResults = mapResult?.datasetResults || [];
  const field = datasetResults[0]?.renderMeta?.semanticField
    || presentation?.semanticField
    || 'amenity';
  const counts = new Map();

  const addFeature = (feature) => {
    const raw = feature.rawAttributes || feature.attributes || feature;
    const rawValue = raw[field] ?? raw.amenity ?? raw.category ?? null;
    if (rawValue == null) return;
    const key = String(rawValue).trim();
    if (!key) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  };

  for (const result of datasetResults) {
    for (const feature of result.features || []) addFeature(feature);
  }
  for (const feature of mapResult?.features || []) addFeature(feature);

  const renderer = presentation?.renderer || null;
  const classIndex = buildRendererClassIndex(renderer);
  let matchedRendererCategoryCount = 0;
  let unmatchedResultCategoryCount = 0;
  let defaultSymbolCategoryCount = 0;
  let defaultSymbolFeatureCount = 0;
  const unmatchedSamples = [];

  for (const [value, count] of counts.entries()) {
    const rendererClass = resolveRendererClass(classIndex, value);
    if (rendererClass) {
      matchedRendererCategoryCount += 1;
    } else {
      unmatchedResultCategoryCount += 1;
      if (unmatchedSamples.length < 12) unmatchedSamples.push(value);
      if (renderer?.defaultSymbol) {
        defaultSymbolCategoryCount += 1;
        defaultSymbolFeatureCount += count;
      }
    }
  }

  const rendererClassCount = renderer?.uniqueValueInfos?.length
    ?? presentation?.uniqueValueInfos?.length
    ?? (renderer?.type === 'simple' ? 1 : 0);
  const inferredCategoryCount = counts.size > 0
    ? counts.size
    : (rendererClassCount > 0 ? rendererClassCount : 0);

  return {
    rawDistinctCategoryCount: inferredCategoryCount,
    rendererClassCount,
    matchedRendererCategoryCount,
    unmatchedResultCategoryCount,
    defaultSymbolCategoryCount,
    defaultSymbolFeatureCount,
    unmatchedCategorySamples: unmatchedSamples.map((value) => ({
      value,
      label: formatAmenityCategory(value)
    })),
    semanticField: field
  };
}

/**
 * @param {object} mapResult
 * @param {object} accounting
 * @param {object | null} presentation
 */
export function buildExecutionReceipt(mapResult, accounting = null, presentation = null) {
  const safeAccounting = accounting || {};
  const primary = mapResult?.datasetResults?.[0] || {};
  const webmapLayer = primary.webmapLayer || {};
  const categoryAccounting = computeCategoryAccounting(mapResult, presentation);

  return {
    executionId: mapResult?.executionId || mapResult?.requestId || null,
    operation: mapResult?.summary?.spatialOperation || mapResult?.summary?.action || mapResult?.action,
    datasetId: primary.datasetId || mapResult?.summary?.dataset || null,
    source: {
      layerId: webmapLayer.catalogId || primary.sourceId || null,
      url: webmapLayer.url || primary.dataUrl || primary.catalogueUrl || null,
      layerIndex: webmapLayer.layerId ?? null
    },
    query: {
      spatialOperation: mapResult?.summary?.spatialOperation || null,
      location: mapResult?.origin?.matchedAddress || mapResult?.matchedAddress || null,
      radiusMeters: mapResult?.summary?.radiusMeters ?? null,
      filters: mapResult?.request?.categoryFilter || null
    },
    result: {
      complete: safeAccounting.complete !== false,
      truncated: Boolean(safeAccounting.truncated),
      totalCount: safeAccounting.totalMatchingObjectIds
        ?? mapResult?.summary?.matchedFeatures
        ?? 0,
      objectIdCount: safeAccounting.totalMatchingObjectIds ?? safeAccounting.objectIds?.length ?? 0,
      rawCategoryCount: categoryAccounting.rawDistinctCategoryCount
    },
    rendering: {
      mode: typeof window !== 'undefined' ? window.__IQAI_RESULT_RENDERER__?.mode || null : null,
      activeObjectIdCount: typeof window !== 'undefined'
        ? window.__IQAI_RESULT_RENDERER__?.activeObjectIdCount ?? null
        : null
    },
    executedAt: new Date().toISOString()
  };
}

/**
 * @param {object} mapResult
 * @param {object} accounting
 * @param {object | null} presentation
 */
export function publishDeterministicResultAccounting(mapResult, accounting = null, presentation = null) {
  if (typeof window === 'undefined') return;
  const safeAccounting = accounting || {};
  const categoryAccounting = computeCategoryAccounting(mapResult, presentation);
  const receipt = buildExecutionReceipt(mapResult, safeAccounting, presentation);

  window.__IQAI_DETERMINISTIC_RESULT_ACCOUNTING__ = {
    ...safeAccounting,
    ...categoryAccounting,
    activeObjectIdCount: window.__IQAI_RESULT_RENDERER__?.activeObjectIdCount ?? null,
    renderingMode: window.__IQAI_RESULT_RENDERER__?.mode || null,
    receipt
  };
  window.__IQAI_DETERMINISTIC_EXECUTION_RECEIPT__ = receipt;
}
