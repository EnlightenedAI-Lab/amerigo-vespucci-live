/**
 * CapabilityDescriptor V1. Aliases belong to Intent/Planner, not identity.
 * Omitted migrationState is UNMIGRATED. CHASSIS requires the trusted registrar.
 */

import { SCHEMA_IDS, isCanonicalV1Schema } from './schema-ids.js';
import { EFFECT_CLASS, UNDO_POLICY } from './activity-event.js';
import {
  failClosed,
  optionalString,
  rejectUnknownKeys,
  requireArray,
  requirePlainObject,
  requireString
} from './validate.js';

export const EXECUTION_MODE = Object.freeze({
  SYNC: 'SYNC',
  ASYNC: 'ASYNC',
  JOB: 'JOB'
});

export const MIGRATION_STATE = Object.freeze({
  CHASSIS: 'CHASSIS',
  MIGRATED: 'MIGRATED',
  AVAILABLE: 'AVAILABLE',
  UNMIGRATED: 'UNMIGRATED',
  UNAVAILABLE: 'UNAVAILABLE',
  NOT_CONNECTED: 'NOT CONNECTED'
});

const KEYS = [
  'schemaId',
  'schemaVersion',
  'id',
  'version',
  'owner',
  'title',
  'inputSchema',
  'outputSchema',
  'resultType',
  'preconditionIds',
  'compatibleViews',
  'compatibleLayerFamilies',
  'requiredRights',
  'requiredPolicyAction',
  'execution',
  'effectClass',
  'adapterId',
  'cancellation',
  'idempotency',
  'undoPolicy',
  'truthPolicy',
  'evidencePolicy',
  'provenancePolicy',
  'migrationState',
  'unavailableReason'
];

const EXECUTION_KEYS = ['mode', 'targets'];

function materializeCapabilityDescriptor(input = {}, allowChassis) {
  requirePlainObject(input, 'CapabilityDescriptor');
  rejectUnknownKeys(input, 'CapabilityDescriptor', KEYS);
  if (!isCanonicalV1Schema(input.schemaId, input.schemaVersion, SCHEMA_IDS.CAPABILITY)) {
    failClosed('UNSUPPORTED_SCHEMA', 'Capability descriptor schema is unsupported.', {
      schemaId: input.schemaId,
      schemaVersion: input.schemaVersion
    });
  }
  const effectClass = requireString(input.effectClass, 'effectClass');
  if (!Object.values(EFFECT_CLASS).includes(effectClass)) {
    failClosed('UNKNOWN_ENUM', 'effectClass is unknown.', { effectClass });
  }
  const undoPolicy = requireString(input.undoPolicy || (
    effectClass === EFFECT_CLASS.SESSION_MUTATION ? UNDO_POLICY.UNDOABLE : UNDO_POLICY.NON_UNDOABLE
  ), 'undoPolicy');
  if (!Object.values(UNDO_POLICY).includes(undoPolicy)) {
    failClosed('UNKNOWN_ENUM', 'undoPolicy is unknown.', { undoPolicy });
  }
  const executionInput = requirePlainObject(input.execution || { mode: EXECUTION_MODE.SYNC, targets: [] }, 'execution');
  rejectUnknownKeys(executionInput, 'execution', EXECUTION_KEYS);
  const mode = requireString(executionInput.mode, 'execution.mode');
  if (!Object.values(EXECUTION_MODE).includes(mode)) {
    failClosed('UNKNOWN_ENUM', 'execution.mode is unknown.', { mode });
  }
  const migrationState = requireString(
    input.migrationState == null || input.migrationState === ''
      ? MIGRATION_STATE.UNMIGRATED
      : input.migrationState,
    'migrationState'
  );
  if (!Object.values(MIGRATION_STATE).includes(migrationState)) {
    failClosed('UNKNOWN_ENUM', 'migrationState is unknown.', { migrationState });
  }
  const id = requireString(input.id, 'id');
  const owner = requireString(input.owner, 'owner');
  if (migrationState === MIGRATION_STATE.CHASSIS && allowChassis !== true) {
    failClosed('UNTRUSTED_CHASSIS_REGISTRATION', 'CHASSIS requires the trusted chassis registrar.', {
      id,
      owner
    });
  }
  return Object.freeze({
    schemaId: SCHEMA_IDS.CAPABILITY,
    schemaVersion: '1.0.0',
    id,
    version: requireString(input.version || '1.0.0', 'version'),
    owner,
    title: requireString(input.title, 'title'),
    inputSchema: requireString(input.inputSchema || SCHEMA_IDS.ACTION_INPUT, 'inputSchema'),
    outputSchema: requireString(input.outputSchema || SCHEMA_IDS.RESULT, 'outputSchema'),
    resultType: requireString(input.resultType, 'resultType'),
    preconditionIds: Object.freeze(requireArray(input.preconditionIds ?? [], 'preconditionIds').map((id, i) => requireString(id, `preconditionIds[${i}]`))),
    compatibleViews: Object.freeze(requireArray(input.compatibleViews ?? [], 'compatibleViews').map((id, i) => requireString(id, `compatibleViews[${i}]`))),
    compatibleLayerFamilies: Object.freeze(requireArray(input.compatibleLayerFamilies ?? [], 'compatibleLayerFamilies').map((id, i) => requireString(id, `compatibleLayerFamilies[${i}]`))),
    requiredRights: Object.freeze(requireArray(input.requiredRights ?? [], 'requiredRights').map((id, i) => requireString(id, `requiredRights[${i}]`))),
    requiredPolicyAction: requireString(input.requiredPolicyAction, 'requiredPolicyAction'),
    execution: Object.freeze({
      mode,
      targets: Object.freeze(requireArray(executionInput.targets ?? [], 'execution.targets').map((id, i) => requireString(id, `execution.targets[${i}]`)))
    }),
    effectClass,
    adapterId: optionalString(input.adapterId, 'adapterId'),
    cancellation: input.cancellation === true,
    idempotency: optionalString(input.idempotency, 'idempotency'),
    undoPolicy,
    truthPolicy: optionalString(input.truthPolicy, 'truthPolicy'),
    evidencePolicy: optionalString(input.evidencePolicy, 'evidencePolicy'),
    provenancePolicy: optionalString(input.provenancePolicy, 'provenancePolicy'),
    migrationState,
    unavailableReason: optionalString(input.unavailableReason, 'unavailableReason')
  });
}

export function createCapabilityDescriptor(input = {}) {
  return materializeCapabilityDescriptor(input, false);
}

export function createChassisCapabilityDescriptor(input = {}) {
  if (input?.migrationState !== MIGRATION_STATE.CHASSIS) {
    failClosed('CHASSIS_REGISTRATION_REQUIRED', 'Trusted chassis registrar only registers CHASSIS capabilities.');
  }
  return materializeCapabilityDescriptor(input, true);
}

export function validateCapabilityDescriptor(value) {
  return createCapabilityDescriptor(value);
}

export function isCapabilityExecutable(migrationState) {
  return migrationState === MIGRATION_STATE.CHASSIS
    || migrationState === MIGRATION_STATE.MIGRATED
    || migrationState === MIGRATION_STATE.AVAILABLE;
}

export function isChassisExecutionState(migrationState) {
  return migrationState === MIGRATION_STATE.CHASSIS;
}

export function isMigratedExecutionState(migrationState) {
  return migrationState === MIGRATION_STATE.MIGRATED
    || migrationState === MIGRATION_STATE.AVAILABLE;
}
