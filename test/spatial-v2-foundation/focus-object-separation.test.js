import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDropPinFocusRef,
  createFocusRef,
  createObjectRef,
  createSelectionSet,
  createEmptySelectionSet,
  isFocusRef,
  isObjectRef,
  retainSelectionDespiteUnsupportedRepresentation,
  validateFocusRef,
  validateObjectRef
} from '../../public/spatial-v2/foundation/contracts/index.js';

function ids(prefix) {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

const now = () => '2026-08-18T14:00:00.000Z';

function featureRef(id = 'asset-1') {
  return createObjectRef({
    namespace: 'iqai.catalog',
    kind: 'feature',
    id,
    datasetRef: 'authored-layer',
    datasetVersion: 'item-rev-1',
    sourceRef: 'map-select',
    label: 'Hydrant'
  });
}

test('FocusRef is WHERE and ObjectRef is WHAT', () => {
  const focus = createDropPinFocusRef({
    longitude: -73.56726,
    latitude: 45.50173
  }, { idFactory: ids('focus'), now });
  const objectRef = featureRef();
  assert.equal(isFocusRef(focus), true);
  assert.equal(isObjectRef(objectRef), true);
  assert.equal(isFocusRef(objectRef), false);
  assert.equal(isObjectRef(focus), false);
  assert.notEqual(focus.focusId, objectRef.id);
  assert.equal('namespace' in focus, false);
  assert.equal('focusId' in objectRef, false);
});

test('DROP PIN can establish focus with an empty SelectionSet', () => {
  const focus = createDropPinFocusRef({
    longitude: -73.56726,
    latitude: 45.50173
  }, { idFactory: ids('pin'), now });
  const selection = createEmptySelectionSet({ now, idFactory: ids('sel') });
  assert.equal(focus.sourceAction, 'DROP_PIN');
  assert.equal(selection.objectRefs.length, 0);
  assert.equal(selection.primaryObjectRefId, null);
});

test('OBJECTID alone is not ObjectRef identity', () => {
  assert.throws(
    () => createObjectRef({
      namespace: 'arcgis',
      kind: 'OBJECTID',
      id: '12345',
      sourceRef: 'layer-view'
    }),
    (error) => error.code === 'INVALID_STRING' || error.code === 'OBJECTID_NOT_IDENTITY'
  );
  assert.throws(
    () => createObjectRef({
      namespace: 'arcgis',
      kind: 'OBJECTID',
      id: '12345',
      datasetRef: 'layer-9',
      datasetVersion: 'rev-1',
      sourceRef: 'layer-view',
      identityStability: 'ADAPTER_LOCAL'
    }),
    (error) => error.code === 'OBJECTID_NOT_IDENTITY'
  );
  const versioned = createObjectRef({
    namespace: 'arcgis',
    kind: 'OBJECTID',
    id: '12345',
    datasetRef: 'layer-9',
    datasetVersion: 'rev-1',
    sourceRef: 'layer-view',
    identityStability: 'DATASET_VERSIONED'
  });
  assert.equal(versioned.id, '12345');
  assert.equal(versioned.datasetVersion, 'rev-1');
});

test('FocusRef and ObjectRef cannot be substituted for each other', () => {
  const focus = createDropPinFocusRef({ longitude: -73.5, latitude: 45.5 }, { idFactory: ids('f'), now });
  const objectRef = featureRef();
  assert.throws(() => validateFocusRef(objectRef), (error) => error.code === 'UNKNOWN_FIELD');
  assert.throws(() => validateObjectRef(focus), (error) => error.code === 'UNKNOWN_FIELD');
});

test('unsupported representation does not clear canonical selection', () => {
  const selection = createSelectionSet({
    objectRefs: [featureRef('a'), featureRef('b')],
    sourceView: 'MAP',
    sourceAction: 'OPERATOR',
    selectedAt: now()
  }, { idFactory: ids('sel') });
  const retained = retainSelectionDespiteUnsupportedRepresentation(selection, 'STREET 360');
  assert.equal(retained.objectRefs.length, 2);
  assert.equal(retained.objectRefs[0].id, 'a');
  assert.equal(retained.objectRefs[1].id, 'b');
});

test('map center source is rejected even with valid point geometry', () => {
  assert.throws(
    () => createFocusRef({
      geometry: { kind: 'POINT', coordinates: [-73.5, 45.5], spatialReferenceRef: 'EPSG:4326' },
      sourceView: 'MAP',
      sourceAction: 'VIEW_CENTER'
    }, { idFactory: ids('bad') }),
    (error) => error.code === 'MAP_CENTER_IS_NOT_FOCUS'
  );
});
