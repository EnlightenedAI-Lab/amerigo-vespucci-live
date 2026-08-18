/**
 * SelectionSet = ordered canonical WHAT selection.
 * Unsupported view representation never clears this set.
 */

import { SCHEMA_IDS } from './schema-ids.js';
import { createObjectRef, objectRefKey } from './object-ref.js';
import {
  createId,
  failClosed,
  isoNow,
  rejectUnknownKeys,
  requireArray,
  requireInteger,
  requirePlainObject,
  requireString
} from './validate.js';

const KEYS = [
  'schemaId',
  'selectionSetId',
  'objectRefs',
  'primaryObjectRefId',
  'sourceView',
  'sourceAction',
  'revision',
  'selectedAt'
];

function resolvePrimary(objectRefs, primaryObjectRefId) {
  if (objectRefs.length === 0) {
    if (primaryObjectRefId != null) {
      failClosed('INVALID_SELECTION', 'Empty SelectionSet cannot name a primary object.');
    }
    return null;
  }
  if (primaryObjectRefId == null) {
    return objectRefKey(objectRefs[0]);
  }
  const wanted = requireString(primaryObjectRefId, 'primaryObjectRefId');
  const match = objectRefs.filter((ref) => objectRefKey(ref) === wanted || ref.id === wanted);
  if (match.length !== 1) {
    failClosed('INVALID_SELECTION', 'primaryObjectRefId must uniquely identify one selected ObjectRef.', {
      primaryObjectRefId: wanted
    });
  }
  return objectRefKey(match[0]);
}

export function createSelectionSet(input = {}, options = {}) {
  requirePlainObject(input, 'SelectionSet');
  rejectUnknownKeys(input, 'SelectionSet', KEYS);
  const objectRefs = requireArray(input.objectRefs ?? [], 'objectRefs').map((ref, index) => {
    try {
      return createObjectRef(ref);
    } catch (error) {
      failClosed(error.code || 'INVALID_OBJECT_REF', `objectRefs[${index}]: ${error.message}`, error.details);
    }
  });
  const keys = objectRefs.map(objectRefKey);
  if (new Set(keys).size !== keys.length) {
    failClosed('DUPLICATE_SELECTION', 'SelectionSet objectRefs must be unique.');
  }
  return {
    schemaId: SCHEMA_IDS.SELECTION_SET,
    selectionSetId: input.selectionSetId
      ? requireString(input.selectionSetId, 'selectionSetId')
      : createId('sel', options.idFactory),
    objectRefs,
    primaryObjectRefId: resolvePrimary(objectRefs, input.primaryObjectRefId),
    sourceView: requireString(input.sourceView, 'sourceView'),
    sourceAction: requireString(input.sourceAction, 'sourceAction'),
    revision: requireInteger(input.revision ?? 1, 'revision', { min: 1 }),
    selectedAt: requireString(input.selectedAt || isoNow(options.now), 'selectedAt')
  };
}

export function createEmptySelectionSet(options = {}) {
  return createSelectionSet({
    objectRefs: [],
    primaryObjectRefId: null,
    sourceView: options.sourceView || 'MAP',
    sourceAction: options.sourceAction || 'SYSTEM',
    revision: 1,
    selectedAt: isoNow(options.now)
  }, options);
}

export function retainSelectionDespiteUnsupportedRepresentation(selectionSet) {
  return createSelectionSet(selectionSet);
}

export function validateSelectionSet(value) {
  return createSelectionSet(value);
}
