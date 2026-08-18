import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_SOURCE,
  EFFECT_CLASS,
  createDropPinFocusRef
} from '../../public/spatial-v2/foundation/contracts/index.js';
import {
  assertSerializableWorldState,
  createStateStore
} from '../../public/spatial-v2/state/index.js';
import { ContractError } from '../../public/spatial-v2/foundation/contracts/validate.js';

function clock() {
  let n = 0;
  return () => new Date(Date.parse('2026-08-18T14:00:00.000Z') + n++ * 1000).toISOString();
}

function ids(prefix = 'id') {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

test('JSON round-trip preserves canonical World State', () => {
  const state = createStateStore({ now: clock(), idFactory: ids('ser') });
  const focus = createDropPinFocusRef({ longitude: -73.5, latitude: 45.5 }, {
    idFactory: ids('focus'),
    now: () => '2026-08-18T14:00:01.000Z'
  });
  state.applyPatch({
    baseRevision: 1,
    actorRef: 'operator:1',
    source: ACTION_SOURCE.OPERATOR,
    effectClass: EFFECT_CLASS.SESSION_MUTATION,
    fields: { activeFocus: focus }
  });
  const json = state.serialize();
  const restored = createStateStore({ now: clock(), idFactory: ids('other') });
  const result = restored.restoreFromJson(json);
  assert.equal(result.ok, true);
  assert.ok(result.snapshot.revision >= 2);
  const original = state.getSnapshot();
  const imported = restored.getSnapshot();
  for (const key of [
    'schemaId',
    'schemaVersion',
    'activeFocus',
    'selection',
    'aoi',
    'workspace',
    'views',
    'cameras',
    'layers',
    'temporal',
    'sources',
    'results',
    'worlds',
    'assumptions',
    'security'
  ]) {
    assert.deepEqual(imported[key], original[key], key);
  }
  assert.equal(imported.revision, result.activityEvent.afterRevision);
});

test('runtime handles cannot enter serialized World State', () => {
  class MapView {}
  const handle = new MapView();
  assert.throws(
    () => assertSerializableWorldState({ activeFocus: { mapView: handle } }),
    (error) => error instanceof ContractError && error.code === 'RUNTIME_HANDLE_PROHIBITED'
  );
  assert.throws(
    () => assertSerializableWorldState({ __esri: {} }),
    (error) => error.code === 'RUNTIME_HANDLE_PROHIBITED'
  );
});

test('secret-like fields cannot enter serialized World State', () => {
  assert.throws(
    () => assertSerializableWorldState({ apiKey: 'abc' }),
    (error) => error.code === 'SECRET_MATERIAL_PROHIBITED'
  );
  assert.throws(
    () => assertSerializableWorldState({ authorization: 'Bearer x' }),
    (error) => error.code === 'SECRET_MATERIAL_PROHIBITED'
  );
  const state = createStateStore({ now: clock(), idFactory: ids('sec') });
  assert.throws(
    () => state.applyPatch({
      baseRevision: 1,
      actorRef: 'operator:1',
      source: ACTION_SOURCE.OPERATOR,
      effectClass: EFFECT_CLASS.SESSION_MUTATION,
      fields: {
        context: {
          sessionId: 'session-1',
          missionId: null,
          operatorMode: 'NORMAL',
          activityCursor: null,
          apiToken: 'leak'
        }
      }
    }),
    (error) => error.code === 'UNKNOWN_FIELD'
  );
});

test('functions and DOM-like nodes are rejected', () => {
  assert.throws(
    () => assertSerializableWorldState({ fn: () => 1 }),
    (error) => error.code === 'NON_SERIALIZABLE'
  );
  assert.throws(
    () => assertSerializableWorldState({ node: { nodeType: 1, nodeName: 'DIV' } }),
    (error) => error.code === 'DOM_NODE_PROHIBITED'
  );
});

test('read-only diagnostic omits geometry and security grants detail', () => {
  const state = createStateStore({ now: clock(), idFactory: ids('diag') });
  const diagnostic = state.getDiagnostic();
  assert.equal(diagnostic.revision, 1);
  assert.equal(diagnostic.hasFocus, false);
  assert.equal(diagnostic.securitySnapshotOnly, true);
  assert.equal('apiKey' in diagnostic, false);
  assert.equal('activeFocus' in diagnostic, false);
  assert.equal('grants' in diagnostic, false);
});
