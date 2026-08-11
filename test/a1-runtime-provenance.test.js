import test from 'node:test';
import assert from 'node:assert/strict';
import {
  A1_HARNESS_VERSION,
  A1_RESULT_STATE_VERSION,
  A1_ACCOUNTING_VERSION,
  resolveAcceptanceOverlayState,
  acceptanceOverlayMayShowFinalCopy,
  formatA1ProvenanceOverlayLines,
  initA1RuntimeProvenance
} from '../public/spatial/a1-runtime-provenance.js';
import {
  resetDeterministicExecutionState,
  applyPrimaryDatasetResultState
} from '../public/spatial/deterministic-result-state.js';
import { queryCompleteObjectIds, buildDeterministicAccounting } from '../public/spatial/deterministic-result-accounting.js';
import { computeA1ModuleHashes } from '../src/spatial/spatial-runtime-info.js';

test('runtime provenance identifiers are exposed', () => {
  global.window = {};
  const root = initA1RuntimeProvenance();
  assert.equal(root.harnessVersion, A1_HARNESS_VERSION);
  assert.equal(root.resultStateVersion, A1_RESULT_STATE_VERSION);
  assert.equal(root.accountingVersion, A1_ACCOUNTING_VERSION);
  const lines = formatA1ProvenanceOverlayLines();
  assert.ok(lines.some((line) => line.includes(A1_HARNESS_VERSION)));
  assert.ok(lines.some((line) => line.includes(A1_RESULT_STATE_VERSION)));
  delete global.window;
});

test('server exposes A1 module content hashes for served file verification', () => {
  const hashes = computeA1ModuleHashes();
  assert.ok(hashes['canonical-result-state.js']);
  assert.ok(hashes['deterministic-result-state.js']);
  assert.ok(hashes['spatial-deterministic-acceptance.js']);
  assert.ok(hashes['webmap-layer-query.js']);
  assert.ok(hashes['shell/AppShell.js']);
  assert.ok(hashes['deterministic-command-transaction.js']);
  assert.ok(hashes['deterministic-result-accounting.js']);
});

test('overlay cannot contain RUNNING and Full report copied together', () => {
  const runningFinalized = {
    state: 'RUNNING',
    finalized: true,
    failed: 1,
    passed: 0
  };
  assert.equal(resolveAcceptanceOverlayState(runningFinalized), 'BLOCKED');
  assert.equal(acceptanceOverlayMayShowFinalCopy(runningFinalized), true);
  assert.notEqual(resolveAcceptanceOverlayState(runningFinalized), 'RUNNING');

  const runningInProgress = {
    state: 'RUNNING',
    finalized: false,
    failed: 0,
    passed: 0
  };
  assert.equal(resolveAcceptanceOverlayState(runningInProgress), 'RUNNING');
  assert.equal(acceptanceOverlayMayShowFinalCopy(runningInProgress), false);
});

test('resetDeterministicExecutionState records command boundary with prior accounting', () => {
  global.window = {
    __IQAI_DETERMINISTIC_RESULT_ACCOUNTING__: { totalMatchingObjectIds: 6 },
    __IQAI_RESULT_RENDERER__: { mode: 'auth_native' }
  };
  initA1RuntimeProvenance();
  resetDeterministicExecutionState('map schools within 3km');
  const trail = window.__IQAI_A1_RUNTIME_PROVENANCE__.commandTrail;
  const resetEvent = trail.find((entry) => entry.event === 'resetDeterministicExecutionState');
  assert.equal(resetEvent.priorAccounting, 6);
  assert.equal(resetEvent.commandLabel, 'map schools within 3km');
  delete global.window;
});

test('production NEAREST path publishes selected top-N through applyPrimaryDatasetResultState', () => {
  const mapResult = applyPrimaryDatasetResultState({
    features: [{ objectId: 11 }, { objectId: 12 }, { objectId: 13 }],
    datasetResults: [{
      displayName: 'Fire Stations',
      features: [{ objectId: 11 }, { objectId: 12 }, { objectId: 13 }],
      completeObjectIds: Array.from({ length: 158 }, (_, index) => index + 1),
      resultAccounting: buildDeterministicAccounting({
        objectIds: [11, 12, 13],
        attributeRecordsLoaded: 3,
        objectIdQueryUsed: true,
        candidateObjectIdCount: 158
      })
    }],
    summary: { matchedFeatures: 158, dataset: 'Fire Stations' }
  });
  assert.equal(mapResult.summary.matchedFeatures, 3);
  assert.equal(mapResult.resultAccounting.totalMatchingObjectIds, 3);
});

test('queryObjectIds array return propagates to accounting objectIdQueryUsed', async () => {
  global.window = {};
  initA1RuntimeProvenance();
  const layer = {
    title: 'Amenities',
    url: 'https://example.com/FeatureServer/0',
    queryObjectIds: async () => Array.from({ length: 2501 }, (_, index) => index + 1)
  };
  const result = await queryCompleteObjectIds(layer, {});
  assert.equal(result.objectIdQueryUsed, true);
  assert.equal(result.objectIds.length, 2501);
  const trail = window.__IQAI_A1_RUNTIME_PROVENANCE__.queryObjectIdsTrail;
  assert.equal(trail.at(-1).returnType, 'Array');
  assert.equal(trail.at(-1).parsedObjectIdCount, 2501);
  delete global.window;
});
