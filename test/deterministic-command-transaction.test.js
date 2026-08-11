import test from 'node:test';
import assert from 'node:assert/strict';
import {
  beginDeterministicCommand,
  assertCommandOwnership,
  awaitDeterministicCommandSettled,
  buildEmptyCanonicalResult,
  commitCanonicalToTransaction,
  getActiveCommandId,
  getCommittedCanonicalResult,
  settleDeterministicCommand,
  setCommandRequestContext
} from '../public/spatial/deterministic-command-transaction.js';
import {
  commitCanonicalDeterministicResult,
  publishCanonicalDeterministicResult
} from '../public/spatial/canonical-result-state.js';
import { buildDeterministicAccounting } from '../public/spatial/deterministic-result-accounting.js';
import { captureAcceptanceSnapshot } from '../public/spatial/spatial-deterministic-acceptance.js';
import { resetDeterministicExecutionState } from '../public/spatial/deterministic-result-state.js';

function buildMapResult(overrides = {}) {
  const objectIds = overrides.objectIds || [1, 2, 3];
  const accounting = buildDeterministicAccounting({
    objectIds,
    attributeRecordsLoaded: objectIds.length,
    objectIdQueryUsed: true,
    ...overrides.accounting
  });
  return {
    supported: true,
    action: overrides.action || 'MAP',
    request: { action: overrides.operation || overrides.action || 'WITHIN' },
    summary: {
      action: overrides.operation || 'WITHIN',
      dataset: overrides.dataset || 'Fire Stations',
      matchedFeatures: objectIds.length,
      resultComplete: true
    },
    datasetResults: [{
      displayName: overrides.dataset || 'Fire Stations',
      features: objectIds.map((id) => ({ objectId: id })),
      completeObjectIds: objectIds,
      resultAccounting: accounting
    }],
    resultAccounting: accounting
  };
}

test('stale async publication rejected after new command begins', async () => {
  const first = beginDeterministicCommand({ command: 'nearest', operation: 'NEAREST' });
  const second = beginDeterministicCommand({ command: 'amenities', operation: 'WITHIN' });
  assert.equal(getActiveCommandId(), second.commandId);
  assert.equal(assertCommandOwnership(first.commandId, 'canonical_commit'), false);
  const stale = commitCanonicalDeterministicResult(first.commandId, buildMapResult({ objectIds: [1, 2, 3] }));
  assert.equal(stale, null);
  const fresh = commitCanonicalDeterministicResult(second.commandId, buildMapResult({
    objectIds: Array.from({ length: 10 }, (_, index) => index + 1),
    dataset: 'Amenities'
  }));
  assert.equal(fresh?.canonicalCount, 10);
});

test('command metadata atomically replaced across sequential commands', () => {
  const police = beginDeterministicCommand({ command: 'police', dataset: 'Police Stations', operation: 'WITHIN' });
  commitCanonicalDeterministicResult(police.commandId, buildMapResult({ dataset: 'Police Stations' }));
  settleDeterministicCommand(police.commandId);

  const schools = beginDeterministicCommand({ command: 'schools', dataset: 'Schools', operation: 'WITHIN' });
  const canonical = commitCanonicalDeterministicResult(schools.commandId, buildMapResult({
    dataset: 'Schools',
    operation: 'WITHIN'
  }));
  assert.equal(canonical.dataset, 'Schools');
  assert.equal(canonical.operation, 'WITHIN');
  assert.notEqual(canonical.dataset, 'Police Stations');
});

test('Police to Schools cannot retain Police dataset', () => {
  const police = beginDeterministicCommand({ dataset: 'Police Stations' });
  commitCanonicalDeterministicResult(police.commandId, buildMapResult({ dataset: 'Police Stations' }));
  const schools = beginDeterministicCommand({ dataset: 'Schools' });
  const canonical = commitCanonicalDeterministicResult(schools.commandId, buildMapResult({ dataset: 'Schools' }));
  const snapshot = captureAcceptanceSnapshot({ lastMapResult: buildMapResult({ dataset: 'Schools' }) }, schools.commandId);
  assert.match(String(snapshot.dataset || '').toLowerCase(), /school/);
  assert.equal(canonical.commandId, schools.commandId);
});

test('Hospitals to Transit cannot retain Hospitals dataset', () => {
  beginDeterministicCommand({ dataset: 'Hospitals' });
  const transit = beginDeterministicCommand({ dataset: 'Transit' });
  const canonical = commitCanonicalDeterministicResult(transit.commandId, buildMapResult({ dataset: 'Transit' }));
  assert.match(String(canonical.dataset || '').toLowerCase(), /transit/);
});

test('WITHIN to LOCATE prefers request.action for operation', () => {
  beginDeterministicCommand({ operation: 'WITHIN' });
  const locate = beginDeterministicCommand({ operation: 'LOCATE' });
  setCommandRequestContext(locate.commandId, { requestedOperation: 'LOCATE' });
  const canonical = commitCanonicalDeterministicResult(locate.commandId, buildMapResult({
    operation: 'WITHIN',
    action: 'LOCATE'
  }));
  assert.equal(canonical.operation, 'LOCATE');
});

test('NEAREST 3 to Amenities cannot retain three fire-station IDs', () => {
  const nearest = beginDeterministicCommand({ operation: 'NEAREST' });
  commitCanonicalDeterministicResult(nearest.commandId, buildMapResult({ objectIds: [1, 2, 3] }));
  const amenities = beginDeterministicCommand({ operation: 'WITHIN', dataset: 'Amenities' });
  const canonical = commitCanonicalDeterministicResult(amenities.commandId, buildMapResult({
    objectIds: Array.from({ length: 50 }, (_, index) => index + 100),
    dataset: 'Amenities'
  }));
  assert.equal(canonical.objectIds.length, 50);
  assert.notEqual(canonical.objectIds.length, 3);
});

test('harness waits for matching commandId settlement', async () => {
  const { commandId } = beginDeterministicCommand({ command: 'fire' });
  const pending = awaitDeterministicCommandSettled(commandId, 1000);
  setTimeout(() => {
    commitCanonicalDeterministicResult(commandId, buildMapResult({ objectIds: [1, 2, 3, 4, 5, 6] }));
    settleDeterministicCommand(commandId, getCommittedCanonicalResult(commandId));
  }, 20);
  const settled = await pending;
  assert.equal(settled?.canonicalCount, 6);
});

test('canonical result never snapshots intermediary zero after successful query', () => {
  global.window = { __IQAI_RESULT_RENDERER__: { mode: 'auth_native', activeObjectIdCount: 6, commandId: 1 } };
  const { commandId } = beginDeterministicCommand({ command: 'fire' });
  window.__IQAI_RESULT_RENDERER__.commandId = commandId;
  publishCanonicalDeterministicResult(buildMapResult({ objectIds: [1, 2, 3, 4, 5, 6] }), { commandId });
  const snapshot = captureAcceptanceSnapshot({
    lastMapResult: buildMapResult({ objectIds: [1, 2, 3, 4, 5, 6] })
  }, commandId);
  assert.equal(snapshot.canonicalCount, 6);
  delete global.window;
});

test('CLEAR invalidates previous generation and remains empty', () => {
  const prior = beginDeterministicCommand({ operation: 'WITHIN' });
  commitCanonicalDeterministicResult(prior.commandId, buildMapResult({ objectIds: [1, 2, 3] }));
  const cleared = beginDeterministicCommand({ operation: 'CLEAR' });
  const empty = buildEmptyCanonicalResult(cleared.commandId, { operation: 'CLEAR' });
  commitCanonicalToTransaction(cleared.commandId, empty);
  settleDeterministicCommand(cleared.commandId, empty);
  const snapshot = captureAcceptanceSnapshot({ lastMapResult: null }, cleared.commandId);
  assert.equal(snapshot.canonicalCount, 0);
  assert.equal(snapshot.hasMapResult, false);
});

test('RESET invalidates previous generation and remains empty', () => {
  beginDeterministicCommand({ operation: 'WITHIN' });
  const reset = beginDeterministicCommand({ operation: 'RESET' });
  const empty = buildEmptyCanonicalResult(reset.commandId, { operation: 'RESET' });
  commitCanonicalToTransaction(reset.commandId, empty);
  settleDeterministicCommand(reset.commandId, empty);
  assert.equal(getCommittedCanonicalResult(reset.commandId)?.canonicalCount, 0);
});

test('late async callback cannot resurrect result after CLEAR', () => {
  const prior = beginDeterministicCommand({ operation: 'WITHIN' });
  commitCanonicalDeterministicResult(prior.commandId, buildMapResult({ objectIds: [1, 2, 3, 4, 5, 6] }));
  const cleared = beginDeterministicCommand({ operation: 'CLEAR' });
  const empty = buildEmptyCanonicalResult(cleared.commandId);
  commitCanonicalToTransaction(cleared.commandId, empty);
  const stale = commitCanonicalDeterministicResult(prior.commandId, buildMapResult({ objectIds: [1, 2, 3, 4, 5, 6] }));
  assert.equal(stale, null);
  assert.equal(getCommittedCanonicalResult(cleared.commandId)?.canonicalCount, 0);
});

test('NEAREST remains exactly 3', () => {
  const { commandId } = beginDeterministicCommand({ operation: 'NEAREST' });
  const canonical = commitCanonicalDeterministicResult(commandId, buildMapResult({ objectIds: [1, 2, 3] }));
  assert.equal(canonical.canonicalCount, 3);
  assert.equal(canonical.objectIds.length, 3);
});

test('amenities complete population survives atomic commit', () => {
  global.window = {
    __IQAI_RESULT_RENDERER__: { mode: 'auth_native', activeObjectIdCount: 6465, commandId: 1 }
  };
  const ids = Array.from({ length: 6465 }, (_, index) => index + 1);
  const { commandId } = beginDeterministicCommand({ dataset: 'Amenities' });
  window.__IQAI_RESULT_RENDERER__.commandId = commandId;
  const mapResult = buildMapResult({
    objectIds: ids,
    dataset: 'Amenities',
    accounting: { truncated: false }
  });
  mapResult.categorySummary = { categories: new Array(27).fill({ value: 'bench' }), totalCount: 6465 };
  publishCanonicalDeterministicResult(mapResult, { commandId });
  const snapshot = captureAcceptanceSnapshot({ lastMapResult: mapResult }, commandId);
  assert.equal(snapshot.canonicalCount, 6465);
  delete global.window;
});

test('reset clears canonical between commands', () => {
  global.window = {};
  const first = beginDeterministicCommand({ command: 'fire' });
  publishCanonicalDeterministicResult(buildMapResult(), { commandId: first.commandId });
  const second = beginDeterministicCommand({ command: 'police' });
  resetDeterministicExecutionState('police');
  assert.equal(getCommittedCanonicalResult(second.commandId), null);
  delete global.window;
});
