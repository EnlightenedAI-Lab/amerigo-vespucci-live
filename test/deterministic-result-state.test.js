import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPrimaryDatasetResultState,
  resetDeterministicExecutionState
} from '../public/spatial/deterministic-result-state.js';
import { extractFeatureObjectId } from '../public/spatial/webmap-layer-query.js';
import { buildDeterministicAccounting } from '../public/spatial/deterministic-result-accounting.js';
import { evaluateAcceptanceStep } from '../public/spatial/spatial-deterministic-acceptance.js';

test('extractFeatureObjectId uses layer objectIdField', () => {
  assert.equal(extractFeatureObjectId({ FID: 42 }, 'FID'), 42);
  assert.equal(extractFeatureObjectId({ OBJECTID: 7 }, 'FID'), 7);
});

test('applyPrimaryDatasetResultState uses final feature rows not candidate objectIds', () => {
  const mapResult = {
    features: [{ objectId: 1 }, { objectId: 2 }, { objectId: 3 }],
    datasetResults: [{
      displayName: 'Fire Stations',
      features: [{ objectId: 1 }, { objectId: 2 }, { objectId: 3 }],
      completeObjectIds: Array.from({ length: 158 }, (_, index) => index + 1),
      resultAccounting: buildDeterministicAccounting({
        objectIds: [1, 2, 3],
        attributeRecordsLoaded: 3,
        objectIdQueryUsed: true,
        candidateObjectIdCount: 158
      })
    }],
    summary: { matchedFeatures: 158, dataset: 'Fire Stations' },
    resultAccounting: buildDeterministicAccounting({
      objectIds: Array.from({ length: 158 }, (_, index) => index + 1),
      attributeRecordsLoaded: 158,
      objectIdQueryUsed: true
    })
  };

  applyPrimaryDatasetResultState(mapResult);

  assert.equal(mapResult.summary.matchedFeatures, 3);
  assert.equal(mapResult.resultAccounting.totalMatchingObjectIds, 3);
  assert.equal(mapResult.resultAccounting.candidateObjectIdCount, 158);
  assert.equal(mapResult.datasetResults[0].completeObjectIds.length, 3);
});

test('applyPrimaryDatasetResultState cannot inherit prior dataset accounting', () => {
  const mapResult = {
    features: new Array(19).fill(0).map((_, index) => ({ objectId: index + 1 })),
    datasetResults: [{
      displayName: 'Schools',
      features: new Array(19).fill(0).map((_, index) => ({ objectId: index + 1 })),
      resultAccounting: buildDeterministicAccounting({
        objectIds: Array.from({ length: 19 }, (_, index) => index + 1),
        attributeRecordsLoaded: 19,
        objectIdQueryUsed: true
      })
    }],
    summary: { matchedFeatures: 19, dataset: 'Schools' },
    resultAccounting: buildDeterministicAccounting({
      objectIds: [1, 2, 3, 4, 5, 6],
      attributeRecordsLoaded: 6,
      objectIdQueryUsed: true
    })
  };

  applyPrimaryDatasetResultState(mapResult);

  assert.equal(mapResult.summary.matchedFeatures, 19);
  assert.equal(mapResult.resultAccounting.totalMatchingObjectIds, 19);
  assert.notEqual(mapResult.resultAccounting.totalMatchingObjectIds, 6);
});

test('complete amenities accounting cannot be labelled truncated when objectIds match rows', () => {
  const accounting = buildDeterministicAccounting({
    objectIds: Array.from({ length: 2500 }, (_, index) => index + 1),
    attributeRecordsLoaded: 2500,
    objectIdQueryUsed: true,
    truncated: false
  });
  const snapshot = {
    canonicalCount: 2500,
    accountingCount: 2500,
    activeObjectIdCount: 2500,
    dataset: 'Amenities',
    rendererMode: 'auth_native',
    resultComplete: true,
    resultTruncated: false,
    objectIdQueryUsed: true,
    feedback: '2,500 amenities found within 3 km.'
  };
  const result = evaluateAcceptanceStep(snapshot, {
    minCount: 2001,
    complete: true,
    notTruncated: true,
    objectIdQueryUsed: true,
    feedbackExcludes: 'incomplete'
  });
  assert.equal(result.pass, true);
});

test('acceptance harness evaluation flags stale transit accounting', () => {
  const result = evaluateAcceptanceStep({
    canonicalCount: 610,
    accountingCount: 6,
    activeObjectIdCount: null,
    dataset: 'Transit',
    rendererMode: 'runtime-fallback',
    resultComplete: true,
    resultTruncated: false,
    sourceMismatch: false
  }, {
    minCount: 1,
    countsConsistent: true,
    renderingModeIn: ['auth_native']
  });
  assert.equal(result.pass, false);
});

test('resetDeterministicExecutionState clears published window diagnostics', () => {
  global.window = {
    __IQAI_DETERMINISTIC_RESULT_ACCOUNTING__: { totalMatchingObjectIds: 6 },
    __IQAI_DETERMINISTIC_EXECUTION_RECEIPT__: { result: { totalCount: 6 } },
    __IQAI_CANONICAL_DETERMINISTIC_RESULT__: { canonicalCount: 6 },
    __IQAI_AUTH_NATIVE_DIAGNOSTIC__: { shortCode: 'SOURCE_MISMATCH' },
    __IQAI_SCOPED_LAYER_ATTEMPT__: { attempted: true },
    __IQAI_OBJECTID_PROVENANCE__: { sampleObjectIds: [1] }
  };
  resetDeterministicExecutionState();
  assert.equal(window.__IQAI_DETERMINISTIC_RESULT_ACCOUNTING__, null);
  assert.equal(window.__IQAI_CANONICAL_DETERMINISTIC_RESULT__, null);
  assert.equal(window.__IQAI_AUTH_NATIVE_DIAGNOSTIC__, null);
  delete global.window;
});

test('transit cannot inherit prior fire-station accounting count', () => {
  const mapResult = {
    features: new Array(610).fill(0).map((_, index) => ({ objectId: index + 100 })),
    datasetResults: [{
      displayName: 'Transit',
      features: new Array(610).fill(0).map((_, index) => ({ objectId: index + 100 })),
      resultAccounting: buildDeterministicAccounting({
        objectIds: Array.from({ length: 610 }, (_, index) => index + 100),
        attributeRecordsLoaded: 610,
        objectIdQueryUsed: true
      })
    }],
    summary: { matchedFeatures: 610, dataset: 'Transit' },
    resultAccounting: buildDeterministicAccounting({
      objectIds: [1, 2, 3, 4, 5, 6],
      attributeRecordsLoaded: 6,
      objectIdQueryUsed: true
    })
  };

  applyPrimaryDatasetResultState(mapResult);

  assert.equal(mapResult.summary.matchedFeatures, 610);
  assert.equal(mapResult.resultAccounting.totalMatchingObjectIds, 610);
  assert.notEqual(mapResult.resultAccounting.totalMatchingObjectIds, 6);
});
