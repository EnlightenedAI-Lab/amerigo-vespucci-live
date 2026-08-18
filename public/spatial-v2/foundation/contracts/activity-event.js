/**
 * ActivityEvent records actor/source, capability, revisions, effect, receipt, and undo token.
 */

import { SCHEMA_IDS } from './schema-ids.js';
import { ACTION_SOURCE } from './action.js';
import {
  failClosed,
  isoNow,
  optionalString,
  rejectUnknownKeys,
  requireInteger,
  requirePlainObject,
  requireString
} from './validate.js';

export const EFFECT_CLASS = Object.freeze({
  READ_ONLY: 'READ_ONLY',
  SESSION_MUTATION: 'SESSION_MUTATION',
  EXTERNAL_WRITE: 'EXTERNAL_WRITE',
  DESTRUCTIVE: 'DESTRUCTIVE'
});

export const UNDO_POLICY = Object.freeze({
  UNDOABLE: 'UNDOABLE',
  COMPENSATING: 'COMPENSATING',
  NON_UNDOABLE: 'NON_UNDOABLE'
});

const KEYS = [
  'schemaId',
  'eventId',
  'actorRef',
  'source',
  'capabilityId',
  'patchId',
  'beforeRevision',
  'afterRevision',
  'effectClass',
  'undoPolicy',
  'receiptRef',
  'undoToken',
  'recordedAt'
];

export function createActivityEvent(input = {}, options = {}) {
  requirePlainObject(input, 'ActivityEvent');
  rejectUnknownKeys(input, 'ActivityEvent', KEYS);
  const source = requireString(input.source, 'source');
  if (!Object.values(ACTION_SOURCE).includes(source)) {
    failClosed('UNKNOWN_ENUM', 'Activity source is unknown.', { source });
  }
  const effectClass = requireString(input.effectClass, 'effectClass');
  if (!Object.values(EFFECT_CLASS).includes(effectClass)) {
    failClosed('UNKNOWN_ENUM', 'effectClass is unknown.', { effectClass });
  }
  const undoPolicy = requireString(input.undoPolicy || deriveUndoPolicy(effectClass), 'undoPolicy');
  if (!Object.values(UNDO_POLICY).includes(undoPolicy)) {
    failClosed('UNKNOWN_ENUM', 'undoPolicy is unknown.', { undoPolicy });
  }
  if (
    (effectClass === EFFECT_CLASS.EXTERNAL_WRITE || effectClass === EFFECT_CLASS.DESTRUCTIVE)
    && undoPolicy === UNDO_POLICY.UNDOABLE
  ) {
    failClosed('UNDO_FORBIDDEN', 'External or destructive effects cannot use state-rewind undo.');
  }
  return {
    schemaId: SCHEMA_IDS.ACTIVITY_EVENT,
    eventId: requireString(input.eventId, 'eventId'),
    actorRef: requireString(input.actorRef, 'actorRef'),
    source,
    capabilityId: optionalString(input.capabilityId, 'capabilityId'),
    patchId: optionalString(input.patchId, 'patchId'),
    beforeRevision: requireInteger(input.beforeRevision, 'beforeRevision', { min: 0 }),
    afterRevision: requireInteger(input.afterRevision, 'afterRevision', { min: 0 }),
    effectClass,
    undoPolicy,
    receiptRef: optionalString(input.receiptRef, 'receiptRef'),
    undoToken: optionalString(input.undoToken, 'undoToken'),
    recordedAt: requireString(input.recordedAt || isoNow(options.now), 'recordedAt')
  };
}

export function deriveUndoPolicy(effectClass) {
  if (effectClass === EFFECT_CLASS.SESSION_MUTATION) return UNDO_POLICY.UNDOABLE;
  if (effectClass === EFFECT_CLASS.READ_ONLY) return UNDO_POLICY.NON_UNDOABLE;
  return UNDO_POLICY.COMPENSATING;
}

export function validateActivityEvent(value) {
  return createActivityEvent(value);
}
