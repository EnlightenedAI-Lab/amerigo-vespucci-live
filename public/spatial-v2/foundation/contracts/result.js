/**
 * Typed result envelope. ResultCommitter is a later mission.
 * A result may carry a state patch, but only StateStore may apply it.
 */

import { SCHEMA_IDS } from './schema-ids.js';
import { TRUTH_CLASS } from './truth-envelope.js';
import {
  failClosed,
  optionalString,
  rejectUnknownKeys,
  requirePlainObject,
  requireString
} from './validate.js';

const KEYS = [
  'schemaId',
  'resultId',
  'resultType',
  'evidenceRef',
  'provenanceRef',
  'receiptRef',
  'statePatch',
  'truthClass'
];

export function createResult(input = {}) {
  requirePlainObject(input, 'Result');
  rejectUnknownKeys(input, 'Result', KEYS);
  const truthClass = requireString(input.truthClass, 'truthClass');
  if (!Object.values(TRUTH_CLASS).includes(truthClass)) {
    failClosed('UNKNOWN_ENUM', 'Result truth class is unknown.', { truthClass });
  }
  if (input.statePatch != null && typeof input.statePatch !== 'object') {
    failClosed('INVALID_OBJECT', 'Result.statePatch must be an object or null.');
  }
  return {
    schemaId: SCHEMA_IDS.RESULT,
    resultId: requireString(input.resultId, 'resultId'),
    resultType: requireString(input.resultType, 'resultType'),
    evidenceRef: optionalString(input.evidenceRef, 'evidenceRef'),
    provenanceRef: optionalString(input.provenanceRef, 'provenanceRef'),
    receiptRef: optionalString(input.receiptRef, 'receiptRef'),
    statePatch: input.statePatch ? { ...input.statePatch } : null,
    truthClass
  };
}

export function validateResult(value) {
  return createResult(value);
}
