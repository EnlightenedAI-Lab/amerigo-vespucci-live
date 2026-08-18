import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_SOURCE,
  EFFECT_CLASS,
  UNDO_POLICY,
  VIEW_ID,
  createDropPinFocusRef,
  createObjectRef,
  createSelectionSet,
  createEmptySelectionSet
} from '../../public/spatial-v2/foundation/contracts/index.js';
import { createStateStore } from '../../public/spatial-v2/state/index.js';

function clock(start = '2026-08-18T14:00:00.000Z') {
  let n = 0;
  return () => new Date(Date.parse(start) + n++ * 1000).toISOString();
}

function ids(prefix = 'id') {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

function store() {
  return createStateStore({ now: clock(), idFactory: ids('ws') });
}

function feature(id) {
  return createObjectRef({
    namespace: 'iqai.catalog',
    kind: 'feature',
    id,
    datasetRef: 'layer-a',
    datasetVersion: 'v1',
    sourceRef: 'select'
  });
}

test('StateStore snapshots are immutable and isolated from callers', () => {
  const state = store();
  const first = state.getSnapshot();
  assert.equal(first.revision, 1);
  assert.throws(() => {
    first.revision = 99;
  }, TypeError);
  assert.throws(() => {
    first.views.activeViewIds.push('HACK');
  }, TypeError);
  assert.deepEqual(state.getSnapshot().views.activeViewIds, ['MAP']);
  assert.equal(state.getRevision(), 1);
});

test('subscribe receives the current snapshot and later patches', () => {
  const state = store();
  const seen = [];
  const unsubscribe = state.subscribe((snapshot) => seen.push(snapshot.revision));
  const focus = createDropPinFocusRef({ longitude: -73.56, latitude: 45.5 }, {
    idFactory: ids('focus'),
    now: () => '2026-08-18T14:00:01.000Z'
  });
  const result = state.applyPatch({
    baseRevision: 1,
    actorRef: 'operator:1',
    source: ACTION_SOURCE.OPERATOR,
    effectClass: EFFECT_CLASS.SESSION_MUTATION,
    undoPolicy: UNDO_POLICY.UNDOABLE,
    fields: { activeFocus: focus }
  });
  assert.equal(result.ok, true);
  assert.deepEqual(seen, [1, 2]);
  unsubscribe();
  state.applyPatch({
    baseRevision: 2,
    actorRef: 'operator:1',
    source: ACTION_SOURCE.OPERATOR,
    effectClass: EFFECT_CLASS.SESSION_MUTATION,
    fields: { aoi: null }
  });
  assert.deepEqual(seen, [1, 2]);
});

test('patches increment revision and keep FocusRef distinct from SelectionSet', () => {
  const state = store();
  const focus = createDropPinFocusRef({ longitude: -73.56726, latitude: 45.50173 }, {
    idFactory: ids('focus'),
    now: () => '2026-08-18T14:00:01.000Z'
  });
  const applied = state.applyPatch({
    baseRevision: 1,
    actorRef: 'operator:1',
    source: ACTION_SOURCE.OPERATOR,
    effectClass: EFFECT_CLASS.SESSION_MUTATION,
    fields: { activeFocus: focus }
  });
  assert.equal(applied.ok, true);
  assert.equal(applied.snapshot.revision, 2);
  assert.equal(applied.snapshot.activeFocus.sourceAction, 'DROP_PIN');
  assert.equal(applied.snapshot.selection.objectRefs.length, 0);

  const selection = createSelectionSet({
    objectRefs: [feature('hydrant-1')],
    sourceView: 'MAP',
    sourceAction: 'OPERATOR',
    selectedAt: '2026-08-18T14:00:02.000Z'
  }, { idFactory: ids('sel') });
  const second = state.applyPatch({
    baseRevision: 2,
    actorRef: 'operator:1',
    source: ACTION_SOURCE.OPERATOR,
    effectClass: EFFECT_CLASS.SESSION_MUTATION,
    fields: { selection }
  });
  assert.equal(second.snapshot.activeFocus.focusId, applied.snapshot.activeFocus.focusId);
  assert.equal(second.snapshot.selection.objectRefs[0].id, 'hydrant-1');
  assert.notEqual(second.snapshot.activeFocus.focusId, second.snapshot.selection.objectRefs[0].id);
});

test('stale patches fail closed, are archived, and never overwrite current state', () => {
  const state = store();
  const focusA = createDropPinFocusRef({ longitude: -73.5, latitude: 45.5 }, {
    idFactory: ids('a'),
    now: () => '2026-08-18T14:00:01.000Z'
  });
  const focusB = createDropPinFocusRef({ longitude: -73.6, latitude: 45.6 }, {
    idFactory: ids('b'),
    now: () => '2026-08-18T14:00:02.000Z'
  });
  const first = state.applyPatch({
    patchId: 'p1',
    baseRevision: 1,
    actorRef: 'operator:1',
    source: ACTION_SOURCE.OPERATOR,
    effectClass: EFFECT_CLASS.SESSION_MUTATION,
    fields: { activeFocus: focusA }
  });
  const stale = state.applyPatch({
    patchId: 'p0',
    baseRevision: 1,
    actorRef: 'operator:1',
    source: ACTION_SOURCE.OPERATOR,
    effectClass: EFFECT_CLASS.SESSION_MUTATION,
    fields: { activeFocus: focusB }
  });
  assert.equal(first.ok, true);
  assert.equal(stale.ok, false);
  assert.equal(stale.code, 'STALE_REVISION');
  assert.equal(stale.receipt.overwritten, false);
  assert.equal(stale.receipt.kind, 'STALE_REVISION');
  assert.equal(state.getFocus().focusId, first.snapshot.activeFocus.focusId);
  assert.equal(state.getRevision(), 2);
  assert.equal(state.getRejectedReceipts().length, 1);
});

test('camera retention is independent of focus', () => {
  const state = store();
  const cameras = {
    byViewId: {
      [VIEW_ID.MAP]: {
        viewId: VIEW_ID.MAP,
        retained: true,
        spatialReferenceRef: 'EPSG:4326',
        center: { x: -73.56, y: 45.5, z: null },
        scale: 18000,
        heading: 0,
        tilt: 0
      }
    }
  };
  const result = state.applyPatch({
    baseRevision: 1,
    actorRef: 'operator:1',
    source: ACTION_SOURCE.OPERATOR,
    effectClass: EFFECT_CLASS.SESSION_MUTATION,
    fields: { cameras }
  });
  assert.equal(result.snapshot.activeFocus, null);
  assert.equal(result.snapshot.cameras.byViewId.MAP.scale, 18000);
  assert.equal(result.snapshot.views.primaryViewId, 'MAP');
});

test('empty selection remains valid and security snapshot is not policy authority', () => {
  const state = store();
  const result = state.applyPatch({
    baseRevision: 1,
    actorRef: 'operator:1',
    source: ACTION_SOURCE.OPERATOR,
    effectClass: EFFECT_CLASS.SESSION_MUTATION,
    fields: { selection: createEmptySelectionSet({ now: () => '2026-08-18T14:00:01.000Z', idFactory: ids('sel') }) }
  });
  assert.equal(result.snapshot.selection.objectRefs.length, 0);
  assert.equal(result.snapshot.security.effectiveRightsSnapshot.snapshotOnly, true);
  assert.equal(result.snapshot.security.effectiveRightsSnapshot.authority, 'PolicyService');
  assert.equal(result.snapshot.security.effectiveRightsSnapshot.unknownIsDeny, true);
});

test('unknown patch fields fail closed', () => {
  const state = store();
  assert.throws(
    () => state.applyPatch({
      baseRevision: 1,
      actorRef: 'operator:1',
      source: ACTION_SOURCE.OPERATOR,
      effectClass: EFFECT_CLASS.SESSION_MUTATION,
      fields: { portalItem: 'x' }
    }),
    (error) => error.code === 'UNKNOWN_WORLD_STATE_FIELD'
  );
  assert.equal(state.getRevision(), 1);
});
