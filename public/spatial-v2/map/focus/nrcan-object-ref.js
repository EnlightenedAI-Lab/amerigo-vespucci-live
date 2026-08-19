/**
 * Map NRCan building features onto production ObjectRef.
 * Hover/candidate never calls this. Acquired lock is the only writer.
 */

import { createObjectRef, objectRefKey } from '../../foundation/contracts/index.js';

export const NRCAN_DATASET_UUID = '7a5cda52-c7df-427f-9ced-26f19a8a64d6';
export const NRCAN_DATASET_VERSION = 'auto_building_opti_2';
export const NRCAN_SOURCE_REF = 'nrcan:automatically-extracted-buildings';
export const NRCAN_EXPECTED_FOOTPRINTS = 571;

export function sourceIdOf(feature) {
  return feature?.properties?.feature_id || null;
}

export function objectRefFromNrcanFeature(feature, { label = null } = {}) {
  const id = sourceIdOf(feature);
  if (!id) return null;
  return createObjectRef({
    namespace: 'nrcan',
    kind: 'building',
    id: String(id),
    datasetRef: feature?.properties?.sourceUuid || NRCAN_DATASET_UUID,
    datasetVersion: NRCAN_DATASET_VERSION,
    sourceRef: NRCAN_SOURCE_REF,
    identityStability: 'DATASET_VERSIONED',
    label: label || feature?.properties?.name || 'Building',
    geometryRef: `nrcan:building:${id}`
  });
}

export function objectRefId(ref) {
  return ref ? objectRefKey(ref) : null;
}
