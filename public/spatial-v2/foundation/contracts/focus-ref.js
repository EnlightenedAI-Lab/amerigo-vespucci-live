/**
 * FocusRef = WHERE the operator works.
 * A DROP PIN may establish focus with no selected object.
 * Map/view center is never implicit focus.
 */

import { SCHEMA_IDS } from './schema-ids.js';
import { createGeometryRef, createPointGeometryRef, GEOMETRY_KIND } from './geometry-ref.js';
import { createTransformReceipt, WGS84_GEODETIC_REF } from './spatial-reference.js';
import {
  createId,
  failClosed,
  isoNow,
  optionalString,
  rejectUnknownKeys,
  requireInteger,
  requirePlainObject,
  requireString
} from './validate.js';

export const FOCUS_SOURCE_ACTION = Object.freeze({
  DROP_PIN: 'DROP_PIN',
  FOCUS_SET: 'focus.set',
  SYSTEM: 'SYSTEM'
});

const FORBIDDEN_FOCUS_SOURCES = new Set([
  'MAP_CENTER',
  'VIEW_CENTER',
  'CAMERA_CENTER',
  'POINTER',
  'POPUP'
]);

const KEYS = [
  'schemaId',
  'focusId',
  'geometry',
  'spatialReferenceRef',
  'horizontalReference',
  'verticalReference',
  'sourceView',
  'sourceAction',
  'accuracy',
  'address',
  'transformReceipt',
  'revision',
  'establishedAt'
];

function validateAccuracy(accuracy) {
  if (accuracy == null) return null;
  requirePlainObject(accuracy, 'FocusRef.accuracy');
  rejectUnknownKeys(accuracy, 'FocusRef.accuracy', ['horizontal', 'vertical', 'units']);
  return {
    horizontal: accuracy.horizontal ?? null,
    vertical: accuracy.vertical ?? null,
    units: optionalString(accuracy.units, 'FocusRef.accuracy.units')
  };
}

export function createFocusRef(input = {}, options = {}) {
  requirePlainObject(input, 'FocusRef');
  rejectUnknownKeys(input, 'FocusRef', KEYS);
  const sourceAction = requireString(input.sourceAction, 'sourceAction');
  if (FORBIDDEN_FOCUS_SOURCES.has(sourceAction)) {
    failClosed('MAP_CENTER_IS_NOT_FOCUS', 'Map or camera center cannot become FocusRef.', { sourceAction });
  }
  const geometry = createGeometryRef(input.geometry, options);
  if (geometry.kind !== GEOMETRY_KIND.POINT && geometry.kind !== GEOMETRY_KIND.AOI) {
    failClosed('INVALID_FOCUS_GEOMETRY', 'FocusRef geometry must be POINT or AOI.', { kind: geometry.kind });
  }
  return {
    schemaId: SCHEMA_IDS.FOCUS_REF,
    focusId: input.focusId ? requireString(input.focusId, 'focusId') : createId('focus', options.idFactory),
    geometry,
    spatialReferenceRef: requireString(
      input.spatialReferenceRef || geometry.spatialReferenceRef || WGS84_GEODETIC_REF,
      'spatialReferenceRef'
    ),
    horizontalReference: optionalString(input.horizontalReference, 'horizontalReference'),
    verticalReference: optionalString(input.verticalReference, 'verticalReference'),
    sourceView: requireString(input.sourceView, 'sourceView'),
    sourceAction,
    accuracy: validateAccuracy(input.accuracy ?? geometry.accuracy),
    address: optionalString(input.address, 'address'),
    transformReceipt: input.transformReceipt ? createTransformReceipt(input.transformReceipt) : null,
    revision: requireInteger(input.revision ?? 1, 'revision', { min: 1 }),
    establishedAt: requireString(input.establishedAt || isoNow(options.now), 'establishedAt')
  };
}

export function createDropPinFocusRef({
  longitude,
  latitude,
  address = null,
  sourceView = 'MAP',
  accuracy = null,
  focusId,
  establishedAt
} = {}, options = {}) {
  return createFocusRef({
    focusId,
    geometry: createPointGeometryRef({ longitude, latitude, accuracy }, options),
    spatialReferenceRef: WGS84_GEODETIC_REF,
    horizontalReference: WGS84_GEODETIC_REF,
    verticalReference: null,
    sourceView,
    sourceAction: FOCUS_SOURCE_ACTION.DROP_PIN,
    accuracy,
    address,
    transformReceipt: null,
    revision: 1,
    establishedAt
  }, options);
}

export function validateFocusRef(value) {
  if (value == null) return null;
  return createFocusRef(value);
}

export function isFocusRef(value) {
  return Boolean(value) && value.schemaId === SCHEMA_IDS.FOCUS_REF && typeof value.focusId === 'string';
}
