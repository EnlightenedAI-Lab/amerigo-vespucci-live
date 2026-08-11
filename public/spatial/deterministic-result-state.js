/**
 * Canonical deterministic result state — reset contract between commands.
 */

import {
  A1_RESULT_STATE_VERSION,
  recordCommandBoundary,
  recordPrimaryResultPublication
} from './a1-runtime-provenance.js';
import {
  clearCanonicalDeterministicResult,
  resolveCanonicalPopulation
} from './canonical-result-state.js';
import { getActiveCommandId } from './deterministic-command-transaction.js';

/**
 * Clear published client diagnostics so command N cannot read command N-1 state.
 * Canonical state is cleared here; it is republished after the command completes.
 */
export function resetDeterministicExecutionState(commandLabel = null) {
  if (typeof window === 'undefined') return;
  const priorAccounting = window.__IQAI_DETERMINISTIC_RESULT_ACCOUNTING__?.totalMatchingObjectIds ?? null;
  const priorRendererMode = window.__IQAI_RESULT_RENDERER__?.mode ?? null;
  const priorCanonical = window.__IQAI_CANONICAL_DETERMINISTIC_RESULT__?.canonicalCount ?? null;
  window.__IQAI_DETERMINISTIC_RESULT_ACCOUNTING__ = null;
  window.__IQAI_DETERMINISTIC_EXECUTION_RECEIPT__ = null;
  window.__IQAI_AUTH_NATIVE_DIAGNOSTIC__ = null;
  window.__IQAI_SCOPED_LAYER_ATTEMPT__ = null;
  window.__IQAI_OBJECTID_PROVENANCE__ = null;
  window.__IQAI_RESULT_RENDERER__ = null;
  clearCanonicalDeterministicResult();
  recordCommandBoundary('resetDeterministicExecutionState', {
    version: A1_RESULT_STATE_VERSION,
    commandLabel,
    activeCommandId: getActiveCommandId(),
    priorAccounting,
    priorRendererMode,
    priorCanonical
  });
}

function objectIdsFromFeatureRows(features) {
  return features
    .map((feature) => Number(feature?.objectId))
    .filter((id) => Number.isFinite(id));
}

/**
 * @param {object} mapResult
 */
export function applyPrimaryDatasetResultState(mapResult) {
  if (!mapResult) return mapResult;

  const datasetResults = mapResult.datasetResults || [];
  if (datasetResults.length !== 1) {
    mapResult.features = datasetResults.flatMap((dr) => dr.features || []);
    const last = datasetResults[datasetResults.length - 1];
    if (last?.resultAccounting) {
      mapResult.resultAccounting = { ...last.resultAccounting };
    }
    return mapResult;
  }

  const primary = datasetResults[0];
  const features = primary?.features?.length
    ? primary.features
    : (mapResult.features || []);
  const accounting = primary?.resultAccounting
    ? { ...primary.resultAccounting }
    : (mapResult.resultAccounting ? { ...mapResult.resultAccounting } : null);
  const population = resolveCanonicalPopulation(primary, features, accounting);

  if (primary) {
    primary.features = features;
    primary.matchedFeatures = population.populationCount;
    primary.totalSourceRecords = population.populationCount;
    primary.completeObjectIds = population.objectIds;
    if (accounting) {
      accounting.objectIds = population.objectIds;
      accounting.totalMatchingObjectIds = population.populationCount;
      accounting.attributeRecordsLoaded = population.attributeRecordsLoaded;
      accounting.complete = accounting.truncated !== true && population.populationCount > 0;
      primary.resultAccounting = accounting;
    }
  }

  mapResult.features = features;
  mapResult.datasetResults = [primary];
  mapResult.resultAccounting = accounting;

  if (mapResult.summary) {
    mapResult.summary = {
      ...mapResult.summary,
      matchedFeatures: population.populationCount,
      totalSourceRecords: population.populationCount,
      resultComplete: accounting ? accounting.complete !== false : mapResult.summary.resultComplete,
      resultTruncated: accounting ? Boolean(accounting.truncated) : Boolean(mapResult.summary.resultTruncated)
    };
  }

  recordPrimaryResultPublication({
    version: A1_RESULT_STATE_VERSION,
    dataset: primary?.displayName || mapResult.summary?.dataset || null,
    inputFeatureRows: features.length,
    inputCandidateObjectIds: accounting?.candidateObjectIdCount
      ?? primary?.completeObjectIds?.length
      ?? null,
    publishedCanonicalCount: population.populationCount,
    publishedObjectIdCount: population.objectIds.length,
    publishedObjectIdsSample: population.objectIds.slice(0, 5)
  });

  return mapResult;
}
