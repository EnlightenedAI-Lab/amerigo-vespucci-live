/**
 * ObjectRef = WHAT the operator selected.
 * Never an ArcGIS OBJECTID alone. Adapter-local ids require a versioned dataset.
 */

import { SCHEMA_IDS } from './schema-ids.js';
import {
  failClosed,
  optionalString,
  rejectUnknownKeys,
  requirePlainObject,
  requireString
} from './validate.js';

export const OBJECT_IDENTITY_STABILITY = Object.freeze({
  DATASET_VERSIONED: 'DATASET_VERSIONED',
  ADAPTER_LOCAL: 'ADAPTER_LOCAL'
});

const KEYS = [
  'schemaId',
  'namespace',
  'kind',
  'id',
  'datasetRef',
  'datasetVersion',
  'sourceRef',
  'identityStability',
  'label',
  'geometryRef'
];

const OBJECTID_KIND = /^(objectid|oid|esri-objectid|arcgis-objectid)$/i;

export function objectRefKey(ref) {
  return [
    requireString(ref.namespace, 'namespace'),
    requireString(ref.kind, 'kind'),
    requireString(ref.id, 'id'),
    requireString(ref.datasetRef, 'datasetRef'),
    requireString(ref.datasetVersion, 'datasetVersion')
  ].join('::');
}

export function createObjectRef(input = {}) {
  requirePlainObject(input, 'ObjectRef');
  rejectUnknownKeys(input, 'ObjectRef', KEYS);
  const namespace = requireString(input.namespace, 'namespace');
  const kind = requireString(input.kind, 'kind');
  const id = requireString(input.id, 'id');
  const datasetRef = requireString(input.datasetRef, 'datasetRef');
  const datasetVersion = requireString(input.datasetVersion, 'datasetVersion');
  const identityStability = input.identityStability
    ? requireString(input.identityStability, 'identityStability')
    : OBJECT_IDENTITY_STABILITY.DATASET_VERSIONED;

  if (!Object.values(OBJECT_IDENTITY_STABILITY).includes(identityStability)) {
    failClosed('UNKNOWN_ENUM', 'identityStability is unknown.', { identityStability });
  }

  if (identityStability === OBJECT_IDENTITY_STABILITY.ADAPTER_LOCAL) {
    failClosed(
      'OBJECTID_NOT_IDENTITY',
      'Adapter-local feature ids cannot be canonical ObjectRef identity.',
      { namespace, kind, id }
    );
  }

  if (OBJECTID_KIND.test(kind) && (!datasetRef || !datasetVersion || identityStability !== OBJECT_IDENTITY_STABILITY.DATASET_VERSIONED)) {
    failClosed(
      'OBJECTID_NOT_IDENTITY',
      'Provider-native object ids require a versioned dataset identity that declares stability.',
      { kind, id }
    );
  }

  return {
    schemaId: SCHEMA_IDS.OBJECT_REF,
    namespace,
    kind,
    id,
    datasetRef,
    datasetVersion,
    sourceRef: requireString(input.sourceRef, 'sourceRef'),
    identityStability,
    label: optionalString(input.label, 'label'),
    geometryRef: optionalString(input.geometryRef, 'geometryRef')
  };
}

export function validateObjectRef(value) {
  return createObjectRef(value);
}

export function isObjectRef(value) {
  return Boolean(value) && value.schemaId === SCHEMA_IDS.OBJECT_REF && typeof value.namespace === 'string';
}
