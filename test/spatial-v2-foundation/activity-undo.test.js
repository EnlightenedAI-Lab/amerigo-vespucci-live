import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_SOURCE,
  EFFECT_CLASS,
  UNDO_POLICY,
  createDropPinFocusRef
} from '../../public/spatial-v2/foundation/contracts/index.js';
import { createStateStore } from '../../public/spatial-v2/state/index.js';

function clock() {
  let n = 0;
  return () => new Date(Date.parse('2026-08-18T14:00:00.000Z') + n++ * 1000).toISOString();
}

function ids(prefix = 'id') {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

test('session mutation records an activity event with undo token', () => {
  const state = createStateStore({ now: clock(), idFactory: ids('act') });
  const focus = createDropPinFocusRef({ longitude: -73.5, latitude: 45.5 }, {
    idFactory: ids('focus'),
    now: () => '2026-08-18T14:00:01.000Z'
  });
  const result = state.applyPatch({
    baseRevision: 1,
    actorRef: 'operator:1',
    source: ACTION_SOURCE.OPERATOR,
    capabilityId: 'focus.set',
    effectClass: EFFECT_CLASS.SESSION_MUTATION,
    undoPolicy: UNDO_POLICY.UNDOABLE,
    fields: { activeFocus: focus }
  });
  assert.equal(result.activityEvent.beforeRevision, 1);
  assert.equal(result.activityEvent.afterRevision, 2);
  assert.equal(result.activityEvent.effectClass, 'SESSION_MUTATION');
  assert.equal(typeof result.activityEvent.undoToken, 'string');
  assert.equal(state.getSnapshot().context.activityCursor, result.activityEvent.eventId);
});

test('undo restores previous session focus', () => {
  const state = createStateStore({ now: clock(), idFactory: ids('undo') });
  const focusA = createDropPinFocusRef({ longitude: -73.5, latitude: 45.5 }, {
    idFactory: ids('a'),
    now: () => '2026-08-18T14:00:01.000Z'
  });
  const focusB = createDropPinFocusRef({ longitude: -73.6, latitude: 45.6 }, {
    idFactory: ids('b'),
    now: () => '2026-08-18T14:00:02.000Z'
  });
  const first = state.applyPatch({
    baseRevision: 1,
    actorRef: 'operator:1',
    source: ACTION_SOURCE.OPERATOR,
    effectClass: EFFECT_CLASS.SESSION_MUTATION,
    undoPolicy: UNDO_POLICY.UNDOABLE,
    fields: { activeFocus: focusA }
  });
  const second = state.applyPatch({
    baseRevision: 2,
    actorRef: 'operator:1',
    source: ACTION_SOURCE.OPERATOR,
    effectClass: EFFECT_CLASS.SESSION_MUTATION,
    undoPolicy: UNDO_POLICY.UNDOABLE,
    fields: { activeFocus: focusB }
  });
  const undone = state.undo(second.activityEvent.undoToken);
  assert.equal(undone.ok, true);
  assert.equal(state.getFocus().focusId, first.snapshot.activeFocus.focusId);
  assert.ok(state.getRevision() > 3);
});

test('external writes cannot be state-rewound', () => {
  const state = createStateStore({ now: clock(), idFactory: ids('ext') });
  assert.throws(
    () => state.applyPatch({
      baseRevision: 1,
      actorRef: 'operator:1',
      source: ACTION_SOURCE.OPERATOR,
      effectClass: EFFECT_CLASS.EXTERNAL_WRITE,
      undoPolicy: UNDO_POLICY.UNDOABLE,
      fields: { aoi: null }
    }),
    (error) => error.code === 'UNDO_FORBIDDEN'
  );
  const result = state.applyPatch({
    baseRevision: 1,
    actorRef: 'operator:1',
    source: ACTION_SOURCE.OPERATOR,
    effectClass: EFFECT_CLASS.EXTERNAL_WRITE,
    undoPolicy: UNDO_POLICY.COMPENSATING,
    fields: { aoi: null }
  });
  assert.equal(result.ok, true);
  assert.throws(
    () => state.undo(result.activityEvent.undoToken),
    (error) => error.code === 'REQUIRES_COMPENSATING_CAPABILITY'
  );
  assert.equal(state.getRevision(), 2);
});

test('stale undo fails closed', () => {
  const state = createStateStore({ now: clock(), idFactory: ids('stale') });
  const focusA = createDropPinFocusRef({ longitude: -73.5, latitude: 45.5 }, {
    idFactory: ids('a'),
    now: () => '2026-08-18T14:00:01.000Z'
  });
  const focusB = createDropPinFocusRef({ longitude: -73.6, latitude: 45.6 }, {
    idFactory: ids('b'),
    now: () => '2026-08-18T14:00:02.000Z'
  });
  const first = state.applyPatch({
    baseRevision: 1,
    actorRef: 'operator:1',
    source: ACTION_SOURCE.OPERATOR,
    effectClass: EFFECT_CLASS.SESSION_MUTATION,
    undoPolicy: UNDO_POLICY.UNDOABLE,
    fields: { activeFocus: focusA }
  });
  state.applyPatch({
    baseRevision: 2,
    actorRef: 'operator:1',
    source: ACTION_SOURCE.OPERATOR,
    effectClass: EFFECT_CLASS.SESSION_MUTATION,
    undoPolicy: UNDO_POLICY.UNDOABLE,
    fields: { activeFocus: focusB }
  });
  assert.throws(
    () => state.undo(first.activityEvent.undoToken),
    (error) => error.code === 'UNDO_STALE'
  );
});
