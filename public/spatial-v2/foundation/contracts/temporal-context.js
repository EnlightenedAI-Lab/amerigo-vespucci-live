/**
 * One TIME instrument with distinct clocks.
 * Requested time is intent, never evidence. Release never fills acquisition.
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

export const TEMPORAL_LENS = Object.freeze({
  CURRENT: 'CURRENT',
  HISTORY: 'HISTORY',
  EARTH_OBSERVATION: 'EARTH_OBSERVATION'
});

export const TEMPORAL_PRECISION = Object.freeze({
  DATETIME: 'DATETIME',
  DAY: 'DAY',
  MONTH: 'MONTH',
  YEAR: 'YEAR',
  UNKNOWN: 'UNKNOWN'
});

export const TEMPORAL_MATCH = Object.freeze({
  EXACT: 'EXACT',
  NEAREST: 'NEAREST',
  MIXED: 'MIXED',
  NONE: 'NONE'
});

const CONTEXT_KEYS = [
  'schemaId',
  'lens',
  'requested',
  'acquisition',
  'release',
  'retrievedAt',
  'generatedAt',
  'match',
  'delta',
  'direction',
  'observationRefs',
  'limitation'
];

const INSTANT_KEYS = ['instantOrInterval', 'precision'];
const INTERVAL_KEYS = ['start', 'end', 'precision', 'sourceRef'];
const RELEASE_KEYS = ['at', 'precision', 'sourceRef'];
const DELTA_KEYS = ['value', 'unit'];

function requireTemporalPrecision(value, label) {
  const precision = requireString(value, label);
  if (!Object.values(TEMPORAL_PRECISION).includes(precision)) {
    failClosed('UNKNOWN_ENUM', `${label} is not a supported temporal precision.`, { precision });
  }
  return precision;
}

function validateInstant(value, label) {
  if (value == null) return null;
  requirePlainObject(value, label);
  rejectUnknownKeys(value, label, INSTANT_KEYS);
  return {
    instantOrInterval: requireString(value.instantOrInterval, `${label}.instantOrInterval`),
    precision: requireTemporalPrecision(value.precision, `${label}.precision`)
  };
}

function validateAcquisition(value) {
  if (value == null) return null;
  requirePlainObject(value, 'acquisition');
  rejectUnknownKeys(value, 'acquisition', INTERVAL_KEYS);
  const precision = requireTemporalPrecision(value.precision, 'acquisition.precision');
  if (precision === TEMPORAL_PRECISION.UNKNOWN) {
    return {
      start: null,
      end: null,
      precision,
      sourceRef: optionalString(value.sourceRef, 'acquisition.sourceRef')
    };
  }
  return {
    start: optionalString(value.start, 'acquisition.start'),
    end: optionalString(value.end, 'acquisition.end'),
    precision,
    sourceRef: optionalString(value.sourceRef, 'acquisition.sourceRef')
  };
}

function validateRelease(value) {
  if (value == null) return null;
  requirePlainObject(value, 'release');
  rejectUnknownKeys(value, 'release', RELEASE_KEYS);
  return {
    at: optionalString(value.at, 'release.at'),
    precision: value.precision == null
      ? TEMPORAL_PRECISION.UNKNOWN
      : requireTemporalPrecision(value.precision, 'release.precision'),
    sourceRef: optionalString(value.sourceRef, 'release.sourceRef')
  };
}

function validateDelta(value) {
  if (value == null) return null;
  requirePlainObject(value, 'delta');
  rejectUnknownKeys(value, 'delta', DELTA_KEYS);
  if (value.value != null && (typeof value.value !== 'number' || !Number.isFinite(value.value))) {
    failClosed('INVALID_NUMBER', 'delta.value must be finite or null.');
  }
  return {
    value: value.value ?? null,
    unit: optionalString(value.unit, 'delta.unit')
  };
}

export function createTemporalContext(input = {}) {
  requirePlainObject(input, 'TemporalContext');
  rejectUnknownKeys(input, 'TemporalContext', CONTEXT_KEYS);
  const lens = requireString(input.lens || TEMPORAL_LENS.CURRENT, 'lens');
  if (!Object.values(TEMPORAL_LENS).includes(lens)) {
    failClosed('UNKNOWN_ENUM', 'Temporal lens is unknown.', { lens });
  }
  const match = requireString(input.match || TEMPORAL_MATCH.NONE, 'match');
  if (!Object.values(TEMPORAL_MATCH).includes(match)) {
    failClosed('UNKNOWN_ENUM', 'Temporal match is unknown.', { match });
  }
  const requested = validateInstant(input.requested, 'requested');
  const acquisition = validateAcquisition(input.acquisition);
  const release = validateRelease(input.release);

  if (requested && !acquisition) {
    // Requested time remains intent. It must not populate acquisition.
  }
  if (release && acquisition && release.at && acquisition.start && release.at === acquisition.start && release.sourceRef && release.sourceRef === acquisition.sourceRef) {
    failClosed(
      'RELEASE_IS_NOT_ACQUISITION',
      'Release/publication cannot populate capture/acquisition.',
      { at: release.at }
    );
  }

  return {
    schemaId: SCHEMA_IDS.TEMPORAL_CONTEXT,
    lens,
    requested,
    acquisition,
    release,
    retrievedAt: optionalString(input.retrievedAt, 'retrievedAt'),
    generatedAt: optionalString(input.generatedAt, 'generatedAt'),
    match,
    delta: validateDelta(input.delta),
    direction: optionalString(input.direction, 'direction'),
    observationRefs: requireArray(input.observationRefs ?? [], 'observationRefs').map((ref, index) => (
      requireString(ref, `observationRefs[${index}]`)
    )),
    limitation: optionalString(input.limitation, 'limitation')
  };
}

export function createDefaultTemporalContext() {
  return createTemporalContext({
    lens: TEMPORAL_LENS.CURRENT,
    requested: null,
    acquisition: null,
    release: null,
    retrievedAt: null,
    generatedAt: null,
    match: TEMPORAL_MATCH.NONE,
    delta: null,
    direction: null,
    observationRefs: [],
    limitation: null
  });
}

export function validateTemporalContext(value) {
  return createTemporalContext(value);
}
