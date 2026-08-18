/**
 * ActionEnvelope type only. CapabilityRuntime is a later mission.
 * Operator and Brain will share this envelope when capabilities exist.
 */

import { SCHEMA_IDS } from './schema-ids.js';
import {
  failClosed,
  isoNow,
  rejectUnknownKeys,
  requireInteger,
  requirePlainObject,
  requireString
} from './validate.js';

export const ACTION_SOURCE = Object.freeze({
  OPERATOR: 'OPERATOR',
  BRAIN: 'BRAIN',
  SYSTEM: 'SYSTEM'
});

const KEYS = [
  'schemaId',
  'actionId',
  'source',
  'actorRef',
  'capabilityId',
  'input',
  'worldId',
  'baseWorldRevision',
  'traceId',
  'requestedAt'
];

export function createActionEnvelope(input = {}, options = {}) {
  requirePlainObject(input, 'ActionEnvelope');
  rejectUnknownKeys(input, 'ActionEnvelope', KEYS);
  const source = requireString(input.source, 'source');
  if (!Object.values(ACTION_SOURCE).includes(source)) {
    failClosed('UNKNOWN_ENUM', 'Action source is unknown.', { source });
  }
  const rawInput = input.input;
  if (rawInput != null && (typeof rawInput !== 'object' || Array.isArray(rawInput))) {
    failClosed('INVALID_OBJECT', 'ActionEnvelope.input must be a plain object or null.');
  }
  return {
    schemaId: SCHEMA_IDS.ACTION,
    actionId: requireString(input.actionId, 'actionId'),
    source,
    actorRef: requireString(input.actorRef, 'actorRef'),
    capabilityId: requireString(input.capabilityId, 'capabilityId'),
    input: rawInput ? { ...rawInput } : {},
    worldId: requireString(input.worldId, 'worldId'),
    baseWorldRevision: requireInteger(input.baseWorldRevision, 'baseWorldRevision', { min: 0 }),
    traceId: requireString(input.traceId, 'traceId'),
    requestedAt: requireString(input.requestedAt || isoNow(options.now), 'requestedAt')
  };
}

export function validateActionEnvelope(value) {
  return createActionEnvelope(value);
}
