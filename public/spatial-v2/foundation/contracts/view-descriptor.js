/**
 * View lifecycle contract. Focus is shared. Camera handoff is adapter-declared.
 */

import { SCHEMA_IDS, isCanonicalV1Schema } from './schema-ids.js';
import { VIEW_ID, VIEW_LIFECYCLE } from './world-state.js';
import {
  failClosed,
  optionalString,
  rejectUnknownKeys,
  requireArray,
  requirePlainObject,
  requireString
} from './validate.js';

export const VIEW_AVAILABILITY = Object.freeze({
  REGISTERED: 'REGISTERED',
  UNMIGRATED: 'UNMIGRATED',
  UNAVAILABLE: 'UNAVAILABLE'
});

const KEYS = [
  'schemaId',
  'schemaVersion',
  'viewId',
  'title',
  'lifecycle',
  'availability',
  'requiresFocus',
  'retainsCamera',
  'retainsSelection',
  'consumesTime',
  'compatibleLayerFamilies',
  'adapterId',
  'unavailableReason',
  'migrationState'
];

export function createViewDescriptor(input = {}) {
  requirePlainObject(input, 'ViewDescriptor');
  rejectUnknownKeys(input, 'ViewDescriptor', KEYS);
  if (!isCanonicalV1Schema(input.schemaId, input.schemaVersion, SCHEMA_IDS.VIEW)) {
    failClosed('UNSUPPORTED_SCHEMA', 'View descriptor schema is unsupported.', {
      schemaId: input.schemaId,
      schemaVersion: input.schemaVersion
    });
  }
  const viewId = requireString(input.viewId, 'viewId');
  if (!Object.values(VIEW_ID).includes(viewId)) {
    failClosed('UNKNOWN_VIEW', 'View id is not a frozen Spatial V2 view.', { viewId });
  }
  const lifecycle = requireString(input.lifecycle, 'lifecycle');
  if (!Object.values(VIEW_LIFECYCLE).includes(lifecycle)) {
    failClosed('UNKNOWN_ENUM', 'View lifecycle is unknown.', { lifecycle });
  }
  const availability = requireString(input.availability || VIEW_AVAILABILITY.UNMIGRATED, 'availability');
  if (!Object.values(VIEW_AVAILABILITY).includes(availability)) {
    failClosed('UNKNOWN_ENUM', 'View availability is unknown.', { availability });
  }
  return Object.freeze({
    schemaId: SCHEMA_IDS.VIEW,
    schemaVersion: '1.0.0',
    viewId,
    title: requireString(input.title || viewId, 'title'),
    lifecycle,
    availability,
    requiresFocus: input.requiresFocus === true,
    retainsCamera: input.retainsCamera !== false,
    retainsSelection: input.retainsSelection !== false,
    consumesTime: input.consumesTime === true,
    compatibleLayerFamilies: Object.freeze(requireArray(input.compatibleLayerFamilies ?? [], 'compatibleLayerFamilies').map((id, i) => requireString(id, `compatibleLayerFamilies[${i}]`))),
    adapterId: optionalString(input.adapterId, 'adapterId'),
    unavailableReason: optionalString(input.unavailableReason, 'unavailableReason'),
    migrationState: requireString(input.migrationState || availability, 'migrationState')
  });
}

export function validateViewDescriptor(value) {
  return createViewDescriptor(value);
}
