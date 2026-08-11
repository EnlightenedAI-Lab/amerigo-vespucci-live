import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveCanonicalPopulation,
  resolveCanonicalRenderingMode,
  publishCanonicalDeterministicResult,
  getCanonicalDeterministicResult
} from '../public/spatial/canonical-result-state.js';
import { buildDeterministicAccounting } from '../public/spatial/deterministic-result-accounting.js';
import { captureAcceptanceSnapshot } from '../public/spatial/spatial-deterministic-acceptance.js';
import { resetDeterministicExecutionState } from '../public/spatial/deterministic-result-state.js';
import { beginDeterministicCommand } from '../public/spatial/deterministic-command-transaction.js';

test('resolveCanonicalPopulation uses complete objectId population over empty feature rows', () => {
  const population = resolveCanonicalPopulation(
    { completeObjectIds: [1, 2, 3, 4, 5] },
    [],
    buildDeterministicAccounting({
      objectIds: [1, 2, 3, 4, 5],
      attributeRecordsLoaded: 5,
      objectIdQueryUsed: true
    })
  );
  assert.equal(population.populationCount, 5);
});

test('resolveCanonicalPopulation preserves NEAREST top-N selection', () => {
  const population = resolveCanonicalPopulation(
    { completeObjectIds: [1, 2, 3] },
    [{ objectId: 1 }, { objectId: 2 }, { objectId: 3 }],
    buildDeterministicAccounting({
      objectIds: [1, 2, 3],
      attributeRecordsLoaded: 3,
      objectIdQueryUsed: true,
      candidateObjectIdCount: 158
    })
  );
  assert.equal(population.populationCount, 3);
  assert.equal(population.selectionApplied, true);
});

test('publishCanonicalDeterministicResult survives command completion', () => {
  global.window = {
    __IQAI_RESULT_RENDERER__: {
      mode: 'auth_native',
      activeObjectIdCount: 6
    }
  };
  const { commandId } = beginDeterministicCommand({ command: 'map fire stations within 3km' });
  window.__IQAI_RESULT_RENDERER__.commandId = commandId;
  const mapResult = {
    supported: true,
    summary: { matchedFeatures: 0, dataset: 'Fire Stations', resultComplete: true },
    datasetResults: [{
      displayName: 'Fire Stations',
      features: new Array(6).fill(0).map((_, index) => ({ objectId: index + 1 })),
      completeObjectIds: [1, 2, 3, 4, 5, 6],
      resultAccounting: buildDeterministicAccounting({
        objectIds: [1, 2, 3, 4, 5, 6],
        attributeRecordsLoaded: 6,
        objectIdQueryUsed: true
      })
    }],
    resultAccounting: buildDeterministicAccounting({
      objectIds: [1, 2, 3, 4, 5, 6],
      attributeRecordsLoaded: 6,
      objectIdQueryUsed: true
    })
  };
  publishCanonicalDeterministicResult(mapResult, { command: 'map fire stations within 3km', commandId });
  const canonical = getCanonicalDeterministicResult();
  assert.equal(canonical.canonicalCount, 6);
  assert.equal(canonical.renderingMode, 'auth_native');
  const next = beginDeterministicCommand({ command: 'next command' });
  resetDeterministicExecutionState('next command');
  assert.equal(getCanonicalDeterministicResult(), null);
  delete global.window;
});

test('acceptance harness and right rail read same canonical count', () => {
  global.window = {
    __IQAI_RESULT_RENDERER__: { mode: 'auth_native', activeObjectIdCount: 6465 },
    __IQAI_RENDERER_TELEMETRY__: { rendererMode: 'AUTH-NATIVE', activeObjectIdCount: 6465 }
  };
  const { commandId } = beginDeterministicCommand({ command: 'map amenities within 3km' });
  window.__IQAI_RESULT_RENDERER__.commandId = commandId;
  window.__IQAI_RENDERER_TELEMETRY__.commandId = commandId;
  const mapResult = {
    supported: true,
    summary: { matchedFeatures: 6465, dataset: 'Amenities', resultComplete: true, resultTruncated: false },
    categorySummary: { categories: new Array(27).fill({ value: 'bench', count: 1 }), totalCount: 6465 },
    datasetResults: [{ displayName: 'Amenities' }],
    resultAccounting: buildDeterministicAccounting({
      objectIds: Array.from({ length: 6465 }, (_, index) => index + 1),
      attributeRecordsLoaded: 6465,
      objectIdQueryUsed: true,
      truncated: false
    })
  };
  publishCanonicalDeterministicResult(mapResult, { command: 'map amenities within 3km', commandId });
  const snapshot = captureAcceptanceSnapshot({
    lastMapResult: mapResult,
    detailPanel: { _activeCategoryFilter: { label: 'All amenities', count: 6465 } }
  }, commandId);
  assert.equal(snapshot.canonicalCount, 6465);
  assert.equal(snapshot.rendererMode, 'auth_native');
  assert.equal(snapshot.categoryCount, 27);
  delete global.window;
});

test('resolveCanonicalRenderingMode unifies badge telemetry and renderer globals', () => {
  global.window = { __IQAI_RESULT_RENDERER__: { mode: 'auth_native' } };
  assert.equal(resolveCanonicalRenderingMode(), 'auth_native');
  delete global.window;
});
