import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_SOURCE,
  EFFECT_CLASS,
  createDropPinFocusRef,
  createObjectRef,
  createSelectionSet
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

test('named save/restore restores focus and selection without secrets', () => {
  const state = createStateStore({ now: clock(), idFactory: ids('save') });
  const focus = createDropPinFocusRef({ longitude: -73.56726, latitude: 45.50173 }, {
    idFactory: ids('focus'),
    now: () => '2026-08-18T14:00:01.000Z'
  });
  const selection = createSelectionSet({
    objectRefs: [createObjectRef({
      namespace: 'iqai.catalog',
      kind: 'feature',
      id: 'tree-1',
      datasetRef: 'trees',
      datasetVersion: 'v1',
      sourceRef: 'select'
    })],
    sourceView: 'MAP',
    sourceAction: 'OPERATOR',
    selectedAt: '2026-08-18T14:00:02.000Z'
  }, { idFactory: ids('sel') });

  state.applyPatch({
    baseRevision: 1,
    actorRef: 'operator:1',
    source: ACTION_SOURCE.OPERATOR,
    effectClass: EFFECT_CLASS.SESSION_MUTATION,
    fields: { activeFocus: focus, selection }
  });
  const saved = state.getSnapshot();
  state.recordNamedSnapshot('checkpoint');

  const otherFocus = createDropPinFocusRef({ longitude: -73.6, latitude: 45.6 }, {
    idFactory: ids('other'),
    now: () => '2026-08-18T14:00:03.000Z'
  });
  state.applyPatch({
    baseRevision: saved.revision,
    actorRef: 'operator:1',
    source: ACTION_SOURCE.OPERATOR,
    effectClass: EFFECT_CLASS.SESSION_MUTATION,
    fields: { activeFocus: otherFocus }
  });
  assert.notEqual(state.getFocus().focusId, saved.activeFocus.focusId);

  const restored = state.restoreNamedSnapshot('checkpoint');
  assert.equal(restored.ok, true);
  assert.equal(restored.snapshot.activeFocus.focusId, saved.activeFocus.focusId);
  assert.equal(restored.snapshot.selection.objectRefs[0].id, 'tree-1');
  assert.ok(restored.snapshot.revision > saved.revision);
  assert.equal(JSON.stringify(restored.snapshot).includes('apiKey'), false);
});

test('serialized checkpoint excludes runtime handles', () => {
  const state = createStateStore({ now: clock(), idFactory: ids('json') });
  const json = state.serialize();
  assert.equal(json.includes('MapView'), false);
  assert.equal(json.includes('apiKey'), false);
  assert.match(json, /iqai\.spatial\.world-state\/1\.0\.0/);
});
