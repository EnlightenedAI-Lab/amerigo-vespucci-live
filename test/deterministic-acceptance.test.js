import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAcceptanceMatrix,
  captureAcceptanceSnapshot,
  evaluateAcceptanceStep,
  runDeterministicAcceptance,
  resolveAcceptanceOverlayState,
  acceptanceOverlayMayShowFinalCopy
} from '../public/spatial/spatial-deterministic-acceptance.js';
import { applyPrimaryDatasetResultState } from '../public/spatial/deterministic-result-state.js';
import { buildDeterministicAccounting } from '../public/spatial/deterministic-result-accounting.js';
import { beginDeterministicCommand, settleDeterministicCommand } from '../public/spatial/deterministic-command-transaction.js';
import { publishCanonicalDeterministicResult } from '../public/spatial/canonical-result-state.js';

test('buildAcceptanceMatrix includes representative dataset and operation coverage', () => {
  const matrix = buildAcceptanceMatrix();
  const ids = matrix.map((step) => step.id);
  assert.ok(ids.includes('fire-within-3km'));
  assert.ok(ids.includes('amenities-within-3km'));
  assert.ok(ids.includes('clear-result'));
  assert.ok(ids.includes('reset-map'));
  assert.ok(ids.includes('locate-address'));
  assert.ok(ids.includes('nearest-fire'));
  assert.ok(ids.includes('count-amenities-3km'));
  assert.ok(matrix.length >= 10);
});

test('evaluateAcceptanceStep detects count disagreement', () => {
  const result = evaluateAcceptanceStep({
    canonicalCount: 6,
    accountingCount: 0,
    activeObjectIdCount: 6,
    dataset: 'Fire Stations',
    rendererMode: 'auth_native',
    activeFilterLabel: 'Fire Stations',
    resultComplete: true,
    resultTruncated: false,
    sourceMismatch: false
  }, {
    exactCount: 6,
    countsConsistent: true,
    noStaleAmenitiesFilter: true
  });
  assert.equal(result.pass, false);
  assert.match(result.failures.join(' '), /disagree/i);
});

test('evaluateAcceptanceStep detects stale ALL AMENITIES filter', () => {
  const result = evaluateAcceptanceStep({
    canonicalCount: 6,
    accountingCount: 6,
    activeObjectIdCount: 6,
    dataset: 'Fire Stations',
    rendererMode: 'auth_native',
    activeFilterLabel: 'All amenities',
    resultComplete: true,
    resultTruncated: false,
    sourceMismatch: false
  }, {
    exactCount: 6,
    noStaleAmenitiesFilter: true
  });
  assert.equal(result.pass, false);
  assert.match(result.failures.join(' '), /stale/i);
});

test('evaluateAcceptanceStep passes coherent fire station snapshot', () => {
  const result = evaluateAcceptanceStep({
    canonicalCount: 6,
    accountingCount: 6,
    activeObjectIdCount: 6,
    dataset: 'Fire Stations',
    rendererMode: 'auth_native',
    activeFilterLabel: 'Fire Stations',
    resultComplete: true,
    resultTruncated: false,
    sourceMismatch: false
  }, {
    exactCount: 6,
    datasetMatch: 'fire',
    renderingMode: 'auth_native',
    countsConsistent: true,
    noStaleAmenitiesFilter: true,
    noSourceMismatch: true
  });
  assert.equal(result.pass, true);
});

test('evaluateAcceptanceStep flags amenities truncation at 2000', () => {
  const result = evaluateAcceptanceStep({
    canonicalCount: 2000,
    accountingCount: 2000,
    activeObjectIdCount: 2000,
    dataset: 'Amenities',
    rendererMode: 'auth_native',
    activeFilterLabel: 'All amenities',
    resultComplete: false,
    resultTruncated: true,
    sourceMismatch: false,
    objectIdQueryUsed: false,
    feedback: 'Results may be incomplete — source service limit encountered.'
  }, {
    minCount: 2001,
    complete: true,
    notTruncated: true,
    feedbackExcludes: 'incomplete'
  });
  assert.equal(result.pass, false);
  assert.ok(result.failures.length >= 2);
});

test('captureAcceptanceSnapshot reads app shell state', () => {
  const snapshot = captureAcceptanceSnapshot({
    lastMapResult: {
      supported: true,
      summary: { matchedFeatures: 211, dataset: 'Amenities', resultTruncated: false },
      datasetResults: [{ displayName: 'Amenities' }]
    },
    detailPanel: { _activeCategoryFilter: { label: 'All amenities', count: 211 } }
  });
  assert.equal(snapshot.canonicalCount, 211);
  assert.equal(snapshot.dataset, 'Amenities');
  assert.equal(snapshot.activeFilterLabel, 'All amenities');
});

test('runDeterministicAcceptance finalizes BLOCKED when a step fails', async () => {
  global.window = { __IQAI_RESULT_RENDERER__: { mode: 'auth_native', activeObjectIdCount: 6 } };
  const app = {
    mapOperational: true,
    runMapCommand: async (command) => {
      const { commandId } = beginDeterministicCommand({ command });
      if (command.includes('schools')) {
        app.lastMapResult = {
          supported: true,
          summary: { matchedFeatures: 19, dataset: 'Schools', action: 'WITHIN' },
          resultAccounting: buildDeterministicAccounting({
            objectIds: Array.from({ length: 19 }, (_, index) => index + 1),
            attributeRecordsLoaded: 19,
            objectIdQueryUsed: true
          }),
          datasetResults: [{ displayName: 'Schools', completeObjectIds: Array.from({ length: 19 }, (_, index) => index + 1) }]
        };
        window.__IQAI_RESULT_RENDERER__ = { mode: 'runtime-fallback', activeObjectIdCount: 19, commandId };
      } else {
        app.lastMapResult = {
          supported: true,
          summary: { matchedFeatures: 6, dataset: 'Fire Stations', action: 'WITHIN' },
          resultAccounting: buildDeterministicAccounting({
            objectIds: [1, 2, 3, 4, 5, 6],
            attributeRecordsLoaded: 6,
            objectIdQueryUsed: true
          }),
          datasetResults: [{ displayName: 'Fire Stations', completeObjectIds: [1, 2, 3, 4, 5, 6] }]
        };
        window.__IQAI_RESULT_RENDERER__ = { mode: 'auth_native', activeObjectIdCount: 6, commandId };
      }
      publishCanonicalDeterministicResult(app.lastMapResult, { commandId });
      settleDeterministicCommand(commandId);
      return { commandId };
    },
    detailPanel: {}
  };

  const report = await runDeterministicAcceptance(app, {
    skipWarmup: true,
    steps: [
      {
        id: 'fire',
        label: 'Fire',
        command: 'map fire stations within 3km of test',
        settleMs: 0,
        timeoutMs: 1000,
        expect: { exactCount: 6, countsConsistent: true, renderingMode: 'auth_native' }
      },
      {
        id: 'schools',
        label: 'Schools',
        command: 'map schools within 3km of test',
        settleMs: 0,
        timeoutMs: 1000,
        expect: { minCount: 1, countsConsistent: true, renderingModeIn: ['auth_native'] }
      }
    ]
  });

  assert.equal(report.finalized, true);
  assert.equal(report.state, 'BLOCKED');
  assert.equal(report.steps.length, 2);
  assert.equal(report.failed >= 1, true);
  delete global.window;
});

test('sequential amenities radii replace canonical objectId population', () => {
  const threeKm = applyPrimaryDatasetResultState({
    features: new Array(2500).fill(0).map((_, index) => ({ objectId: index + 1 })),
    datasetResults: [{
      displayName: 'Amenities',
      features: new Array(2500).fill(0).map((_, index) => ({ objectId: index + 1 })),
      completeObjectIds: Array.from({ length: 2500 }, (_, index) => index + 1),
      resultAccounting: buildDeterministicAccounting({
        objectIds: Array.from({ length: 2500 }, (_, index) => index + 1),
        attributeRecordsLoaded: 2500,
        objectIdQueryUsed: true,
        truncated: false
      })
    }],
    summary: { matchedFeatures: 2500, dataset: 'Amenities' }
  });

  const fiveHundredM = applyPrimaryDatasetResultState({
    features: new Array(211).fill(0).map((_, index) => ({ objectId: index + 10001 })),
    datasetResults: [{
      displayName: 'Amenities',
      features: new Array(211).fill(0).map((_, index) => ({ objectId: index + 10001 })),
      completeObjectIds: Array.from({ length: 211 }, (_, index) => index + 10001),
      resultAccounting: buildDeterministicAccounting({
        objectIds: Array.from({ length: 211 }, (_, index) => index + 10001),
        attributeRecordsLoaded: 211,
        objectIdQueryUsed: true,
        truncated: false
      })
    }],
    summary: { matchedFeatures: 211, dataset: 'Amenities' }
  });

  assert.equal(threeKm.resultAccounting.totalMatchingObjectIds, 2500);
  assert.equal(fiveHundredM.resultAccounting.totalMatchingObjectIds, 211);
  assert.notDeepEqual(
    fiveHundredM.resultAccounting.objectIds.slice(0, 3),
    threeKm.resultAccounting.objectIds.slice(0, 3)
  );
});

test('acceptance overlay render contract forbids RUNNING with final copy text', () => {
  const report = {
    state: 'RUNNING',
    finalized: true,
    failed: 2,
    passed: 1,
    total: 12,
    steps: [{ pass: true, label: 'A', failures: [] }]
  };
  assert.notEqual(resolveAcceptanceOverlayState(report), 'RUNNING');
  assert.equal(acceptanceOverlayMayShowFinalCopy(report), true);
  const inProgress = { ...report, finalized: false };
  assert.equal(resolveAcceptanceOverlayState(inProgress), 'RUNNING');
  assert.equal(acceptanceOverlayMayShowFinalCopy(inProgress), false);
});
