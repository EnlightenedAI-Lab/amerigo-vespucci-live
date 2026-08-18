import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCHEMA_IDS,
  createActionEnvelope,
  createDropPinFocusRef,
  createFocusRef,
  createObjectRef,
  createResult,
  createScenario,
  createSelectionSet,
  createTemporalContext,
  createTruthEnvelope,
  createWorldState,
  createWgs84GeodeticSpec,
  assertComparableVertical,
  TRUTH_CLASS,
  TEMPORAL_LENS,
  TEMPORAL_MATCH,
  SCENARIO_KIND,
  ACTION_SOURCE
} from '../../public/spatial-v2/foundation/contracts/index.js';
import { ContractError } from '../../public/spatial-v2/foundation/contracts/validate.js';

function ids(prefix) {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

test('canonical schema ids are frozen at 1.0.0', () => {
  assert.equal(SCHEMA_IDS.WORLD_STATE, 'iqai.spatial.world-state/1.0.0');
  assert.equal(SCHEMA_IDS.FOCUS_REF, 'iqai.spatial.focus-ref/1.0.0');
  assert.equal(SCHEMA_IDS.OBJECT_REF, 'iqai.spatial.object-ref/1.0.0');
  assert.equal(SCHEMA_IDS.SELECTION_SET, 'iqai.spatial.selection-set/1.0.0');
  assert.equal(SCHEMA_IDS.TEMPORAL_CONTEXT, 'iqai.temporal-context/1.0.0');
  const world = createWorldState({}, { idFactory: ids('schema'), now: () => '2026-08-18T14:00:00.000Z' });
  assert.equal(world.schemaId, SCHEMA_IDS.WORLD_STATE);
  assert.equal(world.schemaVersion, '1.0.0');
  assert.equal(world.revision, 1);
});

test('unknown World State fields fail closed', () => {
  assert.throws(
    () => createWorldState({ mapView: {} }),
    (error) => error instanceof ContractError && error.code === 'UNKNOWN_FIELD'
  );
});

test('temporal requested time does not populate acquisition', () => {
  const temporal = createTemporalContext({
    lens: TEMPORAL_LENS.HISTORY,
    requested: { instantOrInterval: '2021-05', precision: 'MONTH' },
    match: TEMPORAL_MATCH.NONE
  });
  assert.equal(temporal.requested.instantOrInterval, '2021-05');
  assert.equal(temporal.acquisition, null);
  assert.equal(temporal.release, null);
});

test('release cannot be copied onto acquisition', () => {
  assert.throws(
    () => createTemporalContext({
      lens: TEMPORAL_LENS.HISTORY,
      match: TEMPORAL_MATCH.NEAREST,
      acquisition: {
        start: '2021-11-03',
        end: '2021-11-03',
        precision: 'DAY',
        sourceRef: 'wayback-release'
      },
      release: {
        at: '2021-11-03',
        precision: 'DAY',
        sourceRef: 'wayback-release'
      }
    }),
    (error) => error.code === 'RELEASE_IS_NOT_ACQUISITION'
  );
});

test('unknown vertical datums cannot be compared and unknown schema enums fail closed', () => {
  const spec = createWgs84GeodeticSpec();
  assert.equal(spec.verticalDatumId, null);
  assert.throws(() => assertComparableVertical(spec, spec), (error) => error.code === 'VERTICAL_DATUM_UNKNOWN');
  assert.throws(
    () => createTemporalContext({ lens: 'SITUATION' }),
    (error) => error.code === 'UNKNOWN_ENUM'
  );
});

test('action, result, truth, and scenario schemas reject unknown classes', () => {
  const action = createActionEnvelope({
    actionId: 'act-1',
    source: ACTION_SOURCE.OPERATOR,
    actorRef: 'operator:1',
    capabilityId: 'focus.set',
    input: { focusId: 'focus-1' },
    worldId: 'world-1',
    baseWorldRevision: 1,
    traceId: 'trace-1',
    requestedAt: '2026-08-18T14:00:00.000Z'
  });
  assert.equal(action.schemaId, SCHEMA_IDS.ACTION);
  const truth = createTruthEnvelope({
    truthRef: 'truth-1',
    truthClass: TRUTH_CLASS.OBSERVED,
    sourceRefs: ['source-1'],
    limitations: ['Display is not confirmation.']
  });
  assert.equal(truth.truthClass, 'OBSERVED');
  const result = createResult({
    resultId: 'result-1',
    resultType: 'FOCUS',
    truthClass: TRUTH_CLASS.OBSERVED,
    receiptRef: 'receipt-1'
  });
  assert.equal(result.statePatch, null);
  assert.throws(
    () => createResult({ resultId: 'x', resultType: 'y', truthClass: 'CONFIRMED' }),
    (error) => error.code === 'UNKNOWN_ENUM'
  );
  const scenario = createScenario({
    scenarioId: 'sc-1',
    name: 'WORLD A',
    kind: SCENARIO_KIND.DETERMINISTIC,
    baseline: { worldId: 'world-1', revision: 1 },
    status: 'UNAVAILABLE',
    truthClass: TRUTH_CLASS.SIMULATED
  });
  assert.equal(scenario.truthClass, 'SIMULATED');
  assert.throws(
    () => createScenario({
      scenarioId: 'sc-2',
      name: 'GEN',
      kind: SCENARIO_KIND.GENERATIVE,
      baseline: { worldId: 'world-1', revision: 1 },
      truthClass: TRUTH_CLASS.OBSERVED
    }),
    (error) => error.code === 'TRUTH_CLASS_FORBIDDEN'
  );
});

test('DROP PIN focus is valid without an ObjectRef', () => {
  const focus = createDropPinFocusRef({
    longitude: -73.56726,
    latitude: 45.50173,
    address: null
  }, { idFactory: ids('focus'), now: () => '2026-08-18T14:00:00.000Z' });
  assert.equal(focus.schemaId, SCHEMA_IDS.FOCUS_REF);
  assert.equal(focus.sourceAction, 'DROP_PIN');
  assert.equal(focus.address, null);
  assert.equal(focus.geometry.kind, 'POINT');
});

test('map center cannot become FocusRef', () => {
  assert.throws(
    () => createFocusRef({
      geometry: { kind: 'POINT', coordinates: [-73.5, 45.5], spatialReferenceRef: 'EPSG:4326' },
      sourceView: 'MAP',
      sourceAction: 'MAP_CENTER'
    }),
    (error) => error.code === 'MAP_CENTER_IS_NOT_FOCUS'
  );
});

test('canonical ObjectRef requires versioned dataset identity', () => {
  const ref = createObjectRef({
    namespace: 'iqai.session',
    kind: 'feature',
    id: 'hydrant-1',
    datasetRef: 'session-overlay',
    datasetVersion: 'rev-1',
    sourceRef: 'operator-select'
  });
  assert.equal(ref.schemaId, SCHEMA_IDS.OBJECT_REF);
  const set = createSelectionSet({
    objectRefs: [ref],
    sourceView: 'MAP',
    sourceAction: 'OPERATOR',
    selectedAt: '2026-08-18T14:00:00.000Z'
  }, { idFactory: ids('sel') });
  assert.equal(set.objectRefs.length, 1);
  assert.match(set.primaryObjectRefId, /hydrant-1/);
});
