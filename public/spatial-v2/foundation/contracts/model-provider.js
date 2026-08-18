/**
 * Provider-neutral model adapter contract. IQAI identity is not a model name.
 * Wave 2 implements the seam only. No training. No mission knowledge in weights.
 */

import { SCHEMA_IDS, isCanonicalV1Schema } from './schema-ids.js';
import {
  failClosed,
  optionalString,
  rejectUnknownKeys,
  requireArray,
  requirePlainObject,
  requireString
} from './validate.js';

export const MODEL_KIND = Object.freeze({
  LOCAL_REASONING: 'LOCAL_REASONING',
  CLOUD_REASONING: 'CLOUD_REASONING',
  SPECIALIST: 'SPECIALIST'
});

export const MODEL_LOCALITY = Object.freeze({
  LOCAL: 'LOCAL',
  CLOUD: 'CLOUD'
});

export const MODEL_HEALTH = Object.freeze({
  NOT_CONNECTED: 'NOT CONNECTED',
  READY: 'READY',
  ERROR: 'ERROR',
  UNIMPLEMENTED: 'UNIMPLEMENTED'
});

const KEYS = [
  'schemaId',
  'schemaVersion',
  'providerId',
  'kind',
  'locality',
  'modelId',
  'modelVersion',
  'capabilities',
  'acceptedDataClasses',
  'primaryForBrain'
];

export function createModelProviderDescriptor(input = {}) {
  requirePlainObject(input, 'ModelProviderDescriptor');
  rejectUnknownKeys(input, 'ModelProviderDescriptor', KEYS);
  if (!isCanonicalV1Schema(input.schemaId, input.schemaVersion, SCHEMA_IDS.MODEL_PROVIDER)) {
    failClosed('UNSUPPORTED_SCHEMA', 'Model provider schema is unsupported.', {
      schemaId: input.schemaId
    });
  }
  const kind = requireString(input.kind, 'kind');
  if (!Object.values(MODEL_KIND).includes(kind)) {
    failClosed('UNKNOWN_ENUM', 'Model kind is unknown.', { kind });
  }
  const locality = requireString(input.locality, 'locality');
  if (!Object.values(MODEL_LOCALITY).includes(locality)) {
    failClosed('UNKNOWN_ENUM', 'Model locality is unknown.', { locality });
  }
  return Object.freeze({
    schemaId: SCHEMA_IDS.MODEL_PROVIDER,
    schemaVersion: '1.0.0',
    providerId: requireString(input.providerId, 'providerId'),
    kind,
    locality,
    modelId: optionalString(input.modelId, 'modelId'),
    modelVersion: optionalString(input.modelVersion, 'modelVersion'),
    capabilities: Object.freeze(requireArray(input.capabilities ?? [], 'capabilities').map((id, i) => requireString(id, `capabilities[${i}]`))),
    acceptedDataClasses: Object.freeze(requireArray(input.acceptedDataClasses ?? [], 'acceptedDataClasses').map((id, i) => requireString(id, `acceptedDataClasses[${i}]`))),
    primaryForBrain: input.primaryForBrain === true
  });
}

export const MODEL_PROVIDER_ADAPTER_METHODS = Object.freeze(['health', 'invoke', 'cancel']);
