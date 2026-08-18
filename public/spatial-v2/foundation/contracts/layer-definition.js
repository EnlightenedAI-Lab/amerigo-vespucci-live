/**
 * Immutable LayerDefinition. Mutable instance state lives in World State.
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

export const LAYER_FAMILY = Object.freeze({
  REFERENCE: 'REFERENCE',
  IMAGERY: 'IMAGERY',
  OPERATIONAL: 'OPERATIONAL',
  ENVIRONMENT: 'ENVIRONMENT',
  ANALYSIS: 'ANALYSIS',
  AI_DERIVED: 'AI/DERIVED',
  SESSION_INVESTIGATION: 'SESSION/INVESTIGATION',
  SIMULATION: 'SIMULATION'
});

const KEYS = [
  'schemaId',
  'schemaVersion',
  'layerId',
  'version',
  'title',
  'family',
  'source',
  'authority',
  'availability',
  'defaultVisibility',
  'compatibleViews',
  'selectable',
  'analyzable',
  'temporalSupport',
  'spatialReferenceRef',
  'provenancePolicy',
  'rights',
  'migrationState'
];

const SOURCE_KEYS = ['sourceRef', 'providerId', 'catalogOrigin', 'itemId', 'layerId', 'datasetVersion'];
const RIGHTS_KEYS = ['display', 'analysis', 'aiUse', 'export', 'share', 'cache'];

function createSource(input) {
  if (input == null) {
    return Object.freeze({
      sourceRef: null,
      providerId: null,
      catalogOrigin: null,
      itemId: null,
      layerId: null,
      datasetVersion: null
    });
  }
  requirePlainObject(input, 'layer.source');
  rejectUnknownKeys(input, 'layer.source', SOURCE_KEYS);
  return Object.freeze({
    sourceRef: optionalString(input.sourceRef, 'source.sourceRef'),
    providerId: optionalString(input.providerId, 'source.providerId'),
    catalogOrigin: optionalString(input.catalogOrigin, 'source.catalogOrigin'),
    itemId: optionalString(input.itemId, 'source.itemId'),
    layerId: optionalString(input.layerId, 'source.layerId'),
    datasetVersion: optionalString(input.datasetVersion, 'source.datasetVersion')
  });
}

function createRights(input) {
  if (input == null) {
    return Object.freeze({
      display: null,
      analysis: null,
      aiUse: null,
      export: null,
      share: null,
      cache: null
    });
  }
  requirePlainObject(input, 'layer.rights');
  rejectUnknownKeys(input, 'layer.rights', RIGHTS_KEYS);
  const next = {};
  for (const key of RIGHTS_KEYS) next[key] = optionalString(input[key], `rights.${key}`);
  return Object.freeze(next);
}

export function createLayerDefinition(input = {}) {
  requirePlainObject(input, 'LayerDefinition');
  rejectUnknownKeys(input, 'LayerDefinition', KEYS);
  if (!isCanonicalV1Schema(input.schemaId, input.schemaVersion, SCHEMA_IDS.LAYER)) {
    failClosed('UNSUPPORTED_SCHEMA', 'Layer definition schema is unsupported.', {
      schemaId: input.schemaId,
      schemaVersion: input.schemaVersion
    });
  }
  const family = requireString(input.family, 'family');
  if (!Object.values(LAYER_FAMILY).includes(family)) {
    failClosed('UNKNOWN_ENUM', 'Layer family is unknown.', { family });
  }
  return Object.freeze({
    schemaId: SCHEMA_IDS.LAYER,
    schemaVersion: '1.0.0',
    layerId: requireString(input.layerId, 'layerId'),
    version: requireString(input.version || '1.0.0', 'version'),
    title: requireString(input.title, 'title'),
    family,
    source: createSource(input.source),
    authority: optionalString(input.authority, 'authority'),
    availability: requireString(input.availability || 'UNMIGRATED', 'availability'),
    defaultVisibility: input.defaultVisibility === true,
    compatibleViews: Object.freeze(requireArray(input.compatibleViews ?? [], 'compatibleViews').map((id, i) => requireString(id, `compatibleViews[${i}]`))),
    selectable: input.selectable === true,
    analyzable: input.analyzable === true,
    temporalSupport: optionalString(input.temporalSupport, 'temporalSupport'),
    spatialReferenceRef: optionalString(input.spatialReferenceRef, 'spatialReferenceRef'),
    provenancePolicy: optionalString(input.provenancePolicy, 'provenancePolicy'),
    rights: createRights(input.rights),
    migrationState: requireString(input.migrationState || 'UNMIGRATED', 'migrationState')
  });
}

export function validateLayerDefinition(value) {
  return createLayerDefinition(value);
}
