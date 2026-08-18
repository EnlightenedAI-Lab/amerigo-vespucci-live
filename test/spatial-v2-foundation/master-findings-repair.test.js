import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_SOURCE,
  AXIS_ORDER,
  EFFECT_CLASS,
  GEOMETRY_KIND,
  SCENARIO_KIND,
  SCHEMA_IDS,
  TEMPORAL_LENS,
  TEMPORAL_MATCH,
  TEMPORAL_PRECISION,
  TRUTH_CLASS,
  createDropPinFocusRef,
  createGeometryRef,
  createScenario,
  createSecuritySnapshot,
  createSpatialReferenceSpec,
  createTemporalContext,
  createWorldState,
  createWgs84GeodeticSpec
} from '../../public/spatial-v2/foundation/contracts/index.js';
import { ContractError } from '../../public/spatial-v2/foundation/contracts/validate.js';
import { createStateStore } from '../../public/spatial-v2/state/index.js';

function clock() {
  let n = 0;
  return () => new Date(Date.parse('2026-08-18T14:00:00.000Z') + n++ * 1000).toISOString();
}

function ids(prefix = 'id') {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

function pin(lon, lat, prefix) {
  return createDropPinFocusRef({ longitude: lon, latitude: lat }, {
    idFactory: ids(prefix),
    now: () => '2026-08-18T14:00:01.000Z'
  });
}

test('JSON restore remains a monotonic StateStore mutation', () => {
  const imported = createStateStore({ now: clock(), idFactory: ids('imp') });
  assert.equal(imported.getRevision(), 1);
  const json = imported.serialize();
  assert.match(json, /"revision":1/);

  const live = createStateStore({ now: clock(), idFactory: ids('live') });
  const liveFocus = pin(-73.5, 45.5, 'live-focus');
  const first = live.applyPatch({
    baseRevision: 1,
    actorRef: 'operator:1',
    source: ACTION_SOURCE.OPERATOR,
    effectClass: EFFECT_CLASS.SESSION_MUTATION,
    fields: { activeFocus: liveFocus }
  });
  assert.equal(first.ok, true);
  assert.equal(live.getRevision(), 2);

  const restored = live.restoreFromJson(json);
  assert.equal(restored.ok, true);
  assert.equal(restored.snapshot.revision, 3);
  assert.equal(restored.activityEvent.beforeRevision, 2);
  assert.equal(restored.activityEvent.afterRevision, 3);
  assert.equal(live.getRevision(), 3);
  assert.notEqual(live.getRevision(), 1);

  const stale = live.applyPatch({
    baseRevision: 2,
    actorRef: 'operator:1',
    source: ACTION_SOURCE.OPERATOR,
    effectClass: EFFECT_CLASS.SESSION_MUTATION,
    fields: { activeFocus: pin(-73.6, 45.6, 'stale-focus') }
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.code, 'STALE_REVISION');
  assert.equal(stale.receipt.overwritten, false);
  assert.equal(live.getRevision(), 3);
  assert.equal(live.getRejectedReceipts().length, 1);
});

test('security snapshot cannot claim Policy authority or inject grants', () => {
  assert.throws(
    () => createSecuritySnapshot({
      effectiveRightsSnapshot: { snapshotOnly: false }
    }),
    (error) => error instanceof ContractError && error.code === 'POLICY_AUTHORITY_INJECTION'
  );
  assert.throws(
    () => createWorldState({
      security: { effectiveRightsSnapshot: { unknownIsDeny: false } }
    }),
    (error) => error.code === 'POLICY_FAIL_OPEN'
  );
  assert.throws(
    () => createWorldState({
      security: { effectiveRightsSnapshot: { authority: 'Brain' } }
    }),
    (error) => error.code === 'POLICY_AUTHORITY_INJECTION'
  );
  assert.throws(
    () => createWorldState({
      security: { effectiveRightsSnapshot: { grants: ['admin'] } }
    }),
    (error) => error.code === 'POLICY_GRANT_INJECTION'
  );

  const state = createStateStore({ now: clock(), idFactory: ids('sec') });
  assert.throws(
    () => state.applyPatch({
      baseRevision: 1,
      actorRef: 'operator:1',
      source: ACTION_SOURCE.OPERATOR,
      effectClass: EFFECT_CLASS.SESSION_MUTATION,
      fields: {
        security: {
          effectiveRightsSnapshot: {
            snapshotOnly: false,
            unknownIsDeny: false,
            authority: 'Ask IQAI',
            grants: ['*']
          }
        }
      }
    }),
    (error) => error.code === 'POLICY_AUTHORITY_INJECTION'
  );
  assert.equal(state.getRevision(), 1);
  const snapshot = state.getSnapshot().security.effectiveRightsSnapshot;
  assert.equal(snapshot.snapshotOnly, true);
  assert.equal(snapshot.authority, 'PolicyService');
  assert.equal(snapshot.unknownIsDeny, true);
  assert.deepEqual(snapshot.grants, []);
});

test('subscriber reentrancy cannot reorder activity ahead of outer settlement', () => {
  const state = createStateStore({ now: clock(), idFactory: ids('re') });
  const outerFocus = pin(-73.5, 45.5, 'outer');
  const nestedFocus = pin(-73.6, 45.6, 'nested');
  let nestedOnce = false;
  state.subscribe((snapshot) => {
    if (snapshot.revision !== 2 || nestedOnce) return;
    nestedOnce = true;
    const nested = state.applyPatch({
      baseRevision: snapshot.revision,
      actorRef: 'operator:nested',
      source: ACTION_SOURCE.OPERATOR,
      effectClass: EFFECT_CLASS.SESSION_MUTATION,
      fields: { activeFocus: nestedFocus }
    });
    assert.equal(nested.ok, true);
    const log = state.getActivityLog();
    assert.deepEqual(log.map((event) => [event.beforeRevision, event.afterRevision]), [[1, 2], [2, 3]]);
  });

  const outer = state.applyPatch({
    baseRevision: 1,
    actorRef: 'operator:1',
    source: ACTION_SOURCE.OPERATOR,
    effectClass: EFFECT_CLASS.SESSION_MUTATION,
    fields: { activeFocus: outerFocus }
  });
  assert.equal(outer.ok, true);
  assert.equal(outer.activityEvent.beforeRevision, 1);
  assert.equal(outer.activityEvent.afterRevision, 2);
  assert.equal(state.getRevision(), 3);
  assert.deepEqual(
    state.getActivityLog().map((event) => [event.beforeRevision, event.afterRevision]),
    [[1, 2], [2, 3]]
  );
  assert.equal(state.getFocus().focusId, nestedFocus.focusId);
});

test('nested non-finite geometry is rejected and never enters World State', () => {
  assert.throws(
    () => createGeometryRef({
      kind: GEOMETRY_KIND.POINT,
      coordinates: [-73.5, Number.NaN]
    }),
    (error) => error.code === 'INVALID_GEOMETRY'
  );
  assert.throws(
    () => createGeometryRef({
      kind: GEOMETRY_KIND.LINE,
      coordinates: [[-73.5, 45.5], [Number.POSITIVE_INFINITY, 45.6]]
    }),
    (error) => error.code === 'INVALID_GEOMETRY'
  );
  assert.throws(
    () => createGeometryRef({
      kind: GEOMETRY_KIND.POLYGON,
      coordinates: [[[-73.5, 45.5], [-73.5, 45.6], [Number.NEGATIVE_INFINITY, 45.6], [-73.5, 45.5]]]
    }),
    (error) => error.code === 'INVALID_GEOMETRY'
  );

  const valid = createGeometryRef({
    kind: GEOMETRY_KIND.POLYGON,
    coordinates: [[[-73.5, 45.5], [-73.5, 45.6], [-73.4, 45.6], [-73.5, 45.5]]]
  });
  assert.equal(valid.kind, 'POLYGON');

  const state = createStateStore({ now: clock(), idFactory: ids('geom') });
  assert.throws(
    () => state.applyPatch({
      baseRevision: 1,
      actorRef: 'operator:1',
      source: ACTION_SOURCE.OPERATOR,
      effectClass: EFFECT_CLASS.SESSION_MUTATION,
      fields: {
        aoi: {
          kind: GEOMETRY_KIND.POLYGON,
          coordinates: [[[-73.5, 45.5], [-73.5, 45.6], [Number.NaN, 45.6], [-73.5, 45.5]]]
        }
      }
    }),
    (error) => error.code === 'INVALID_GEOMETRY'
  );
  assert.equal(state.getRevision(), 1);
  assert.equal(state.getSnapshot().aoi, null);
});

test('World State V1 fails closed on unsupported schema identity and version', () => {
  const canonical = createWorldState({
    schemaId: SCHEMA_IDS.WORLD_STATE,
    schemaVersion: '1.0.0'
  }, { now: () => '2026-08-18T14:00:00.000Z', idFactory: ids('ok') });
  assert.equal(canonical.schemaId, SCHEMA_IDS.WORLD_STATE);
  assert.equal(canonical.schemaVersion, '1.0.0');

  assert.throws(
    () => createWorldState({ schemaVersion: '2.0.0' }),
    (error) => error instanceof ContractError && error.code === 'UNSUPPORTED_SCHEMA_VERSION'
  );
  assert.throws(
    () => createWorldState({ schemaVersion: '1.1.0' }),
    (error) => error.code === 'UNSUPPORTED_SCHEMA_VERSION'
  );
  assert.throws(
    () => createWorldState({ schemaId: 'iqai.spatial.world-state/2.0.0' }),
    (error) => error.code === 'UNSUPPORTED_SCHEMA'
  );
  assert.throws(
    () => createWorldState({
      schemaId: SCHEMA_IDS.WORLD_STATE,
      schemaVersion: '2.0.0'
    }),
    (error) => error.code === 'UNSUPPORTED_SCHEMA_VERSION'
  );
});

test('deterministic and generative scenarios keep frozen truth classes', () => {
  const simulated = createScenario({
    scenarioId: 'sc-det',
    name: 'WORLD A',
    kind: SCENARIO_KIND.DETERMINISTIC,
    baseline: { worldId: 'world-1', revision: 1 },
    truthClass: TRUTH_CLASS.SIMULATED
  });
  assert.equal(simulated.truthClass, 'SIMULATED');

  const generated = createScenario({
    scenarioId: 'sc-gen',
    name: 'WORLD B',
    kind: SCENARIO_KIND.GENERATIVE,
    baseline: { worldId: 'world-1', revision: 1 },
    truthClass: TRUTH_CLASS.AI_GENERATED
  });
  assert.equal(generated.truthClass, 'AI-GENERATED');

  for (const truthClass of [
    TRUTH_CLASS.OBSERVED,
    TRUTH_CLASS.DOCUMENTED,
    TRUTH_CLASS.DERIVED,
    TRUTH_CLASS.CALCULATED,
    TRUTH_CLASS.INFERRED,
    TRUTH_CLASS.AI_GENERATED
  ]) {
    assert.throws(
      () => createScenario({
        scenarioId: `sc-bad-${truthClass}`,
        name: 'BAD DET',
        kind: SCENARIO_KIND.DETERMINISTIC,
        baseline: { worldId: 'world-1', revision: 1 },
        truthClass
      }),
      (error) => error.code === 'TRUTH_CLASS_FORBIDDEN'
    );
  }

  assert.throws(
    () => createScenario({
      scenarioId: 'sc-gen-sim',
      name: 'BAD GEN',
      kind: SCENARIO_KIND.GENERATIVE,
      baseline: { worldId: 'world-1', revision: 1 },
      truthClass: TRUTH_CLASS.SIMULATED
    }),
    (error) => error.code === 'TRUTH_CLASS_FORBIDDEN'
  );
  assert.throws(
    () => createScenario({
      scenarioId: 'sc-gen-obs',
      name: 'BAD GEN OBS',
      kind: SCENARIO_KIND.GENERATIVE,
      baseline: { worldId: 'world-1', revision: 1 },
      truthClass: TRUTH_CLASS.OBSERVED
    }),
    (error) => error.code === 'TRUTH_CLASS_FORBIDDEN'
  );
});

test('CRS axisOrder rejects unknown values and keeps the frozen enum', () => {
  const ok = createSpatialReferenceSpec({
    horizontalCrsId: 'EPSG:4326',
    authority: 'EPSG',
    axisOrder: AXIS_ORDER.LON_LAT,
    horizontalUnits: 'degree'
  });
  assert.equal(ok.axisOrder, 'LON_LAT');
  assert.equal(createWgs84GeodeticSpec().axisOrder, 'LON_LAT');

  for (const axisOrder of ['XY', 'ENU', 'unknown', 'lat/lon']) {
    assert.throws(
      () => createSpatialReferenceSpec({
        horizontalCrsId: 'EPSG:4326',
        authority: 'EPSG',
        axisOrder,
        horizontalUnits: 'degree'
      }),
      (error) => error instanceof ContractError && error.code === 'UNKNOWN_ENUM'
    );
  }
});

test('temporal precision rejects arbitrary values and keeps distinct clocks', () => {
  const ok = createTemporalContext({
    lens: TEMPORAL_LENS.HISTORY,
    requested: { instantOrInterval: '2021-05', precision: TEMPORAL_PRECISION.MONTH },
    match: TEMPORAL_MATCH.NONE
  });
  assert.equal(ok.requested.precision, 'MONTH');
  assert.equal(ok.acquisition, null);
  assert.equal(ok.release, null);

  assert.throws(
    () => createTemporalContext({
      lens: TEMPORAL_LENS.HISTORY,
      requested: { instantOrInterval: '2021-W18', precision: 'WEEK' },
      match: TEMPORAL_MATCH.NONE
    }),
    (error) => error.code === 'UNKNOWN_ENUM'
  );
  assert.throws(
    () => createTemporalContext({
      lens: TEMPORAL_LENS.EARTH_OBSERVATION,
      acquisition: {
        start: '2021-11-03',
        end: '2021-11-03',
        precision: 'MILLISECOND',
        sourceRef: 'sensor-1'
      },
      match: TEMPORAL_MATCH.EXACT
    }),
    (error) => error.code === 'UNKNOWN_ENUM'
  );
  assert.throws(
    () => createTemporalContext({
      lens: TEMPORAL_LENS.HISTORY,
      release: { at: '2021-11-03', precision: 'HOUR', sourceRef: 'wayback' },
      match: TEMPORAL_MATCH.NONE
    }),
    (error) => error.code === 'UNKNOWN_ENUM'
  );
  assert.throws(
    () => createTemporalContext({
      lens: TEMPORAL_LENS.HISTORY,
      match: TEMPORAL_MATCH.NEAREST,
      acquisition: {
        start: '2021-11-03',
        end: '2021-11-03',
        precision: TEMPORAL_PRECISION.DAY,
        sourceRef: 'wayback-release'
      },
      release: {
        at: '2021-11-03',
        precision: TEMPORAL_PRECISION.DAY,
        sourceRef: 'wayback-release'
      }
    }),
    (error) => error.code === 'RELEASE_IS_NOT_ACQUISITION'
  );
});
