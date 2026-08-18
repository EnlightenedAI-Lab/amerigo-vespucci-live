/**
 * Queued compute lifecycle. PROGRESS is a RUNNING update, not a terminal state.
 */

import { SCHEMA_IDS, isCanonicalV1Schema } from './schema-ids.js';
import {
  failClosed,
  isoNow,
  optionalString,
  rejectUnknownKeys,
  requireInteger,
  requirePlainObject,
  requireString
} from './validate.js';

export const JOB_STATUS = Object.freeze({
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  COMPLETE: 'COMPLETE',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED'
});

export const JOB_TARGET = Object.freeze({
  LOCAL_CPU: 'LOCAL_CPU',
  LOCAL_GPU: 'LOCAL_GPU',
  CLOUD: 'CLOUD',
  CV: 'CV',
  RASTER_EO: 'RASTER_EO',
  SIMULATION: 'SIMULATION',
  BATCH: 'BATCH',
  WORLD_MODEL: 'WORLD_MODEL'
});

export const TERMINAL_JOB_STATUSES = Object.freeze([
  JOB_STATUS.COMPLETE,
  JOB_STATUS.FAILED,
  JOB_STATUS.CANCELLED
]);

const KEYS = [
  'schemaId',
  'schemaVersion',
  'jobId',
  'capabilityId',
  'actorRef',
  'worldId',
  'baseWorldRevision',
  'target',
  'status',
  'progress',
  'attempt',
  'cancellable',
  'cancelRequested',
  'backendAckedCancel',
  'backendRef',
  'inputRef',
  'resultRef',
  'error',
  'receipts',
  'createdAt',
  'updatedAt'
];

const PROGRESS_KEYS = ['current', 'total', 'unit', 'percent', 'message', 'updatedAt'];

export function createJobProgress(input = {}, options = {}) {
  if (input == null) {
    return Object.freeze({
      current: 0,
      total: null,
      unit: null,
      percent: null,
      message: null,
      updatedAt: isoNow(options.now)
    });
  }
  requirePlainObject(input, 'job.progress');
  rejectUnknownKeys(input, 'job.progress', PROGRESS_KEYS);
  const percent = input.percent;
  if (percent != null && (typeof percent !== 'number' || percent < 0 || percent > 100)) {
    failClosed('INVALID_NUMBER', 'Job progress percent must be 0-100 or null.');
  }
  return Object.freeze({
    current: requireInteger(input.current ?? 0, 'progress.current', { min: 0 }),
    total: input.total == null ? null : requireInteger(input.total, 'progress.total', { min: 0 }),
    unit: optionalString(input.unit, 'progress.unit'),
    percent: percent ?? null,
    message: optionalString(input.message, 'progress.message'),
    updatedAt: requireString(input.updatedAt || isoNow(options.now), 'progress.updatedAt')
  });
}

export function createJob(input = {}, options = {}) {
  requirePlainObject(input, 'Job');
  rejectUnknownKeys(input, 'Job', KEYS);
  if (input.schemaId != null && !isCanonicalV1Schema(input.schemaId, input.schemaVersion, SCHEMA_IDS.JOB)) {
    failClosed('UNSUPPORTED_SCHEMA', 'Job schema is unsupported.', { schemaId: input.schemaId });
  }
  const status = requireString(input.status || JOB_STATUS.QUEUED, 'status');
  if (!Object.values(JOB_STATUS).includes(status)) {
    failClosed('UNKNOWN_ENUM', 'Job status is unknown.', { status });
  }
  if (status === 'PROGRESS') {
    failClosed('UNKNOWN_ENUM', 'PROGRESS is not a job status. It is a RUNNING update.');
  }
  const target = requireString(input.target, 'target');
  if (!Object.values(JOB_TARGET).includes(target)) {
    failClosed('UNKNOWN_ENUM', 'Job target is unknown.', { target });
  }
  return Object.freeze({
    schemaId: SCHEMA_IDS.JOB,
    schemaVersion: '1.0.0',
    jobId: requireString(input.jobId, 'jobId'),
    capabilityId: requireString(input.capabilityId, 'capabilityId'),
    actorRef: requireString(input.actorRef, 'actorRef'),
    worldId: requireString(input.worldId, 'worldId'),
    baseWorldRevision: requireInteger(input.baseWorldRevision, 'baseWorldRevision', { min: 0 }),
    target,
    status,
    progress: createJobProgress(input.progress, options),
    attempt: requireInteger(input.attempt ?? 1, 'attempt', { min: 1 }),
    cancellable: input.cancellable !== false,
    cancelRequested: input.cancelRequested === true,
    backendAckedCancel: input.backendAckedCancel === true,
    backendRef: optionalString(input.backendRef, 'backendRef'),
    inputRef: optionalString(input.inputRef, 'inputRef'),
    resultRef: optionalString(input.resultRef, 'resultRef'),
    error: optionalString(input.error, 'error'),
    receipts: Object.freeze([...(input.receipts || [])]),
    createdAt: requireString(input.createdAt || isoNow(options.now), 'createdAt'),
    updatedAt: requireString(input.updatedAt || isoNow(options.now), 'updatedAt')
  });
}

export function validateJob(value) {
  return createJob(value);
}
