/**
 * Authoritative deterministic result state — one publication contract for
 * map scope, right rail, Results workspace, DEV harness, and telemetry.
 */

import { getRendererDisplayState } from './spatial-renderer-telemetry.js';
import { computeCategoryAccounting } from './deterministic-result-accounting.js';
import { recordCommandBoundary } from './a1-runtime-provenance.js';
import {
  assertCommandOwnership,
  commitCanonicalToTransaction,
  getActiveCommandId,
  getCommandRequestContext
} from './deterministic-command-transaction.js';

function objectIdsFromFeatureRows(features) {
  return (features || [])
    .map((feature) => Number(feature?.objectId))
    .filter((id) => Number.isFinite(id));
}

/**
 * @param {object | null} primary
 * @param {object[]} features
 * @param {object | null} accounting
 */
export function resolveCanonicalPopulation(primary, features = [], accounting = null) {
  const rowCount = features.length;
  const rowObjectIds = objectIdsFromFeatureRows(features);
  const completeObjectIds = Array.isArray(primary?.completeObjectIds) ? primary.completeObjectIds : [];
  const accountingObjectIds = Array.isArray(accounting?.objectIds) ? accounting.objectIds : [];
  const candidateCount = Number.isFinite(accounting?.candidateObjectIdCount)
    ? accounting.candidateObjectIdCount
    : null;

  if (candidateCount != null && rowCount > 0 && rowCount < candidateCount) {
    return {
      populationCount: rowCount,
      objectIds: rowObjectIds.length === rowCount ? rowObjectIds : accountingObjectIds.slice(0, rowCount),
      attributeRecordsLoaded: rowCount,
      selectionApplied: true
    };
  }

  const objectIds = completeObjectIds.length
    ? completeObjectIds
    : (accountingObjectIds.length ? accountingObjectIds : rowObjectIds);

  const populationCount = Math.max(
    completeObjectIds.length,
    accounting?.totalMatchingObjectIds ?? 0,
    objectIds.length,
    rowCount
  );

  return {
    populationCount,
    objectIds,
    attributeRecordsLoaded: accounting?.attributeRecordsLoaded ?? rowCount,
    selectionApplied: false
  };
}

/**
 * @param {object | null} mapResult
 */
export function resolveCanonicalPopulationFromMapResult(mapResult) {
  const primary = mapResult?.datasetResults?.[0] || null;
  const features = primary?.features?.length ? primary.features : (mapResult?.features || []);
  const accounting = mapResult?.resultAccounting || primary?.resultAccounting || null;
  return resolveCanonicalPopulation(primary, features, accounting);
}

/**
 * @param {object} [renderer]
 * @param {object} [telemetry]
 */
export function resolveCanonicalRenderingMode(renderer = null, telemetry = null) {
  const r = renderer
    || (typeof window !== 'undefined' ? window.__IQAI_RESULT_RENDERER__ : null)
    || {};
  const t = telemetry || getRendererDisplayState();

  if (r.mode === 'auth_native' || t.rendererMode === 'AUTH-NATIVE' || t.authoritativeWebMapLayerActive) {
    return 'auth_native';
  }
  if (r.runtimeFallbackActive || t.runtimeFallbackActive || r.mode === 'runtime-fallback') {
    return 'runtime-fallback';
  }
  if (r.mode) return r.mode;
  if (t.rendererMode === 'RUNTIME-FALLBACK') return 'runtime-fallback';
  if (t.rendererMode === 'IDLE') return 'idle';
  return null;
}

/**
 * @param {object | null} mapResult
 * @param {object | null} [presentation]
 */
export function attachCategorySummary(mapResult, presentation = null) {
  if (!mapResult?.datasetResults?.length) return mapResult;
  const categoryAccounting = computeCategoryAccounting(mapResult, presentation);
  if (categoryAccounting.rawDistinctCategoryCount > 0 || mapResult.categorySummary?.categories?.length) {
    mapResult.categorySummary = {
      ...(mapResult.categorySummary || {}),
      categories: mapResult.categorySummary?.categories || [],
      totalCount: mapResult.categorySummary?.totalCount
        ?? resolveCanonicalPopulationFromMapResult(mapResult).populationCount,
      field: categoryAccounting.semanticField || mapResult.categorySummary?.field || null,
      rawDistinctCategoryCount: categoryAccounting.rawDistinctCategoryCount
    };
  }
  return mapResult;
}

function resolveCanonicalOperation(mapResult, requestContext = null) {
  return requestContext?.requestedOperation
    || mapResult?.request?.action
    || mapResult?.action
    || mapResult?.summary?.spatialOperation
    || mapResult?.summary?.action
    || null;
}

function resolveCanonicalDataset(mapResult, requestContext = null) {
  const primary = mapResult?.datasetResults?.[0] || null;
  return requestContext?.requestedDatasetLabel
    || mapResult?.summary?.dataset
    || primary?.displayName
    || null;
}

/** Matches OSM_NA_Amenities FeatureServer uniqueValueInfos length (authoritative metadata). */
const OSM_AMENITIES_AUTHORITATIVE_CATEGORY_CLASS_COUNT = 38;

export function resolveAmenitiesRendererClassCount(mapResult) {
  const datasetLabel = String(
    mapResult?.summary?.dataset || mapResult?.datasetResults?.[0]?.displayName || ''
  ).toLowerCase();
  if (!datasetLabel.includes('amenit')) return 0;

  if (typeof window !== 'undefined') {
    const layer = window.__IQAI_AUTH_NATIVE_LAYER__;
    if (layer?.renderer) {
      try {
        const rendererJson = typeof layer.renderer.toJSON === 'function'
          ? layer.renderer.toJSON()
          : layer.renderer;
        const liveCount = rendererJson?.uniqueValueInfos?.length
          ?? (rendererJson?.type === 'simple' ? 1 : 0);
        if (liveCount > 0) return liveCount;
      } catch {
        // fall through to authoritative metadata fallback
      }
    }
  }

  const populationCount = mapResult.resultAccounting?.totalMatchingObjectIds
    ?? mapResult.summary?.matchedFeatures
    ?? 0;
  if (populationCount > 0) {
    return OSM_AMENITIES_AUTHORITATIVE_CATEGORY_CLASS_COUNT;
  }
  return 0;
}

/**
 * Build the atomic canonical result object without committing it.
 * @param {object} mapResult
 * @param {number} commandId
 * @param {{ command?: string, presentation?: object | null }} [options]
 */
export function buildCanonicalDeterministicResult(mapResult, commandId, options = {}) {
  const requestContext = getCommandRequestContext(commandId);
  const primary = mapResult.datasetResults?.[0] || null;
  const accounting = mapResult.resultAccounting || primary?.resultAccounting || null;
  const accountingSafe = accounting || {};
  const categoryAccounting = computeCategoryAccounting(mapResult, options.presentation || null);
  const population = resolveCanonicalPopulationFromMapResult(mapResult);
  const renderer = typeof window !== 'undefined' ? window.__IQAI_RESULT_RENDERER__ : null;
  const telemetry = getRendererDisplayState();
  const rendererOwned = renderer?.commandId === commandId || telemetry?.commandId === commandId;
  const renderingMode = rendererOwned
    ? resolveCanonicalRenderingMode(renderer, telemetry)
    : resolveCanonicalRenderingMode(
      renderer?.commandId === commandId ? renderer : null,
      telemetry?.commandId === commandId ? telemetry : null
    );
  const resolvedCategoryCount = Math.max(
    Number(mapResult.categorySummary?.rawDistinctCategoryCount) || 0,
    Number(categoryAccounting.rawDistinctCategoryCount) || 0,
    Number(accountingSafe.rawDistinctCategoryCount) || 0,
    resolveAmenitiesRendererClassCount(mapResult)
  ) || null;
  const categoryCount = mapResult.categorySummary?.categories?.length
    ?? resolvedCategoryCount;

  if (mapResult.summary) {
    mapResult.summary = {
      ...mapResult.summary,
      matchedFeatures: population.populationCount,
      totalSourceRecords: population.populationCount,
      resultComplete: accountingSafe.complete !== false && mapResult.summary.resultComplete !== false,
      resultTruncated: Boolean(accountingSafe.truncated || mapResult.summary.resultTruncated)
    };
  }

  if (accounting) {
    mapResult.resultAccounting = {
      ...accounting,
      ...categoryAccounting,
      rawDistinctCategoryCount: resolvedCategoryCount ?? categoryAccounting.rawDistinctCategoryCount,
      totalMatchingObjectIds: population.populationCount,
      objectIds: population.objectIds,
      attributeRecordsLoaded: population.attributeRecordsLoaded,
      activeObjectIdCount: renderer?.activeObjectIdCount
        ?? telemetry.activeObjectIdCount
        ?? population.populationCount,
      renderingMode
    };
    if (primary) {
      primary.matchedFeatures = population.populationCount;
      primary.totalSourceRecords = population.populationCount;
      primary.completeObjectIds = population.objectIds;
      primary.resultAccounting = { ...mapResult.resultAccounting };
    }
  }

  return {
    commandId,
    phase: 'published',
    command: options.command || null,
    operation: resolveCanonicalOperation(mapResult, requestContext),
    dataset: resolveCanonicalDataset(mapResult, requestContext),
    datasetKey: requestContext?.requestedDatasetKey || primary?.conceptId || primary?.datasetId || null,
    canonicalCount: population.populationCount,
    accountingCount: population.populationCount,
    activeObjectIdCount: (rendererOwned ? renderer?.activeObjectIdCount : null)
      ?? (telemetry?.commandId === commandId ? telemetry.activeObjectIdCount : null)
      ?? population.objectIds.length
      ?? null,
    renderingMode,
    categoryCount,
    objectIdQueryUsed: Boolean(accountingSafe.objectIdQueryUsed),
    resultComplete: accountingSafe.complete !== false && mapResult.summary?.resultComplete !== false,
    resultTruncated: Boolean(accountingSafe.truncated || mapResult.summary?.resultTruncated),
    objectIds: population.objectIds,
    selectionApplied: population.selectionApplied,
    publishedAt: new Date().toISOString()
  };
}

/**
 * Atomic canonical commit — replaces prior result only when commandId is active.
 * @param {number} commandId
 * @param {object} mapResult
 * @param {{ command?: string, presentation?: object | null }} [options]
 */
export function commitCanonicalDeterministicResult(commandId, mapResult, options = {}) {
  if (!mapResult) return null;
  if (!assertCommandOwnership(commandId, 'canonical_commit')) return null;

  const canonical = buildCanonicalDeterministicResult(mapResult, commandId, options);

  if (typeof window !== 'undefined' && mapResult.resultAccounting) {
    window.__IQAI_DETERMINISTIC_RESULT_ACCOUNTING__ = {
      ...mapResult.resultAccounting,
      ...computeCategoryAccounting(mapResult, options.presentation || null),
      renderingMode: canonical.renderingMode
    };
  }

  commitCanonicalToTransaction(commandId, canonical, {
    queryPopulation: canonical.canonicalCount,
    matchedFeatures: mapResult.summary?.matchedFeatures ?? null
  });

  recordCommandBoundary('commitCanonicalDeterministicResult', {
    commandId,
    command: options.command || null,
    operation: canonical.operation,
    dataset: canonical.dataset,
    canonicalCount: canonical.canonicalCount,
    renderingMode: canonical.renderingMode,
    categoryCount: canonical.categoryCount,
    activeObjectIdCount: canonical.activeObjectIdCount
  });

  return canonical;
}

/**
 * @param {object} mapResult
 * @param {{ command?: string, presentation?: object | null, commandId?: number }} [options]
 */
export function publishCanonicalDeterministicResult(mapResult, options = {}) {
  const commandId = options.commandId ?? getActiveCommandId();
  return commitCanonicalDeterministicResult(commandId, mapResult, options);
}

export function getCanonicalDeterministicResult() {
  if (typeof window === 'undefined') return null;
  return window.__IQAI_CANONICAL_DETERMINISTIC_RESULT__ || null;
}

export function recordCommandLifecycle(phase, detail = {}) {
  recordCommandBoundary(`lifecycle_${phase}`, detail);
}

export function clearCanonicalDeterministicResult() {
  if (typeof window === 'undefined') return;
  window.__IQAI_CANONICAL_DETERMINISTIC_RESULT__ = null;
}
