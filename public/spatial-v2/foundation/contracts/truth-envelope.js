/**
 * Truth envelope: class, provenance, method, limits, and rights.
 * Truth class is not authority, confidence, verification, or display state.
 */

import { SCHEMA_IDS } from './schema-ids.js';
import {
  failClosed,
  optionalString,
  rejectUnknownKeys,
  requireArray,
  requirePlainObject,
  requireString
} from './validate.js';

export const TRUTH_CLASS = Object.freeze({
  OBSERVED: 'OBSERVED',
  DOCUMENTED: 'DOCUMENTED',
  DERIVED: 'DERIVED',
  CALCULATED: 'CALCULATED',
  INFERRED: 'INFERRED',
  SIMULATED: 'SIMULATED',
  AI_GENERATED: 'AI-GENERATED'
});

const KEYS = [
  'schemaId',
  'truthRef',
  'truthClass',
  'sourceRefs',
  'inputRefs',
  'method',
  'engine',
  'engineVersion',
  'generatedAt',
  'retrievedAt',
  'spatialScopeRef',
  'temporalScopeRef',
  'uncertainty',
  'confidence',
  'limitations',
  'rights'
];

const RIGHTS_KEYS = ['display', 'analysis', 'aiUse', 'export', 'share'];

function validateRights(rights) {
  if (rights == null) {
    return {
      display: null,
      analysis: null,
      aiUse: null,
      export: null,
      share: null
    };
  }
  requirePlainObject(rights, 'rights');
  rejectUnknownKeys(rights, 'rights', RIGHTS_KEYS);
  const next = {};
  for (const key of RIGHTS_KEYS) {
    next[key] = optionalString(rights[key], `rights.${key}`);
  }
  return next;
}

export function createTruthEnvelope(input = {}) {
  requirePlainObject(input, 'TruthEnvelope');
  rejectUnknownKeys(input, 'TruthEnvelope', KEYS);
  const truthClass = requireString(input.truthClass, 'truthClass');
  if (!Object.values(TRUTH_CLASS).includes(truthClass)) {
    failClosed('UNKNOWN_ENUM', 'Truth class is unknown.', { truthClass });
  }
  return {
    schemaId: SCHEMA_IDS.TRUTH_ENVELOPE,
    truthRef: requireString(input.truthRef, 'truthRef'),
    truthClass,
    sourceRefs: requireArray(input.sourceRefs ?? [], 'sourceRefs').map((ref, i) => requireString(ref, `sourceRefs[${i}]`)),
    inputRefs: requireArray(input.inputRefs ?? [], 'inputRefs').map((ref, i) => requireString(ref, `inputRefs[${i}]`)),
    method: optionalString(input.method, 'method'),
    engine: optionalString(input.engine, 'engine'),
    engineVersion: optionalString(input.engineVersion, 'engineVersion'),
    generatedAt: optionalString(input.generatedAt, 'generatedAt'),
    retrievedAt: optionalString(input.retrievedAt, 'retrievedAt'),
    spatialScopeRef: optionalString(input.spatialScopeRef, 'spatialScopeRef'),
    temporalScopeRef: optionalString(input.temporalScopeRef, 'temporalScopeRef'),
    uncertainty: optionalString(input.uncertainty, 'uncertainty'),
    confidence: optionalString(input.confidence, 'confidence'),
    limitations: requireArray(input.limitations ?? [], 'limitations').map((item, i) => requireString(item, `limitations[${i}]`)),
    rights: validateRights(input.rights)
  };
}

export function validateTruthEnvelope(value) {
  return createTruthEnvelope(value);
}
