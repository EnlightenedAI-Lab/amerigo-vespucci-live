/**
 * SensorPose — real-world analytical sensor position.
 * Not WorldState.cameras (retained view-camera state).
 * Not PLACE CAMERA UI. Not Google 3D visual camera.
 */

import { SCHEMA_IDS } from './schema-ids.js';
import {
  createId,
  failClosed,
  isoNow,
  optionalFiniteNumber,
  optionalString,
  rejectUnknownKeys,
  requirePlainObject,
  requireString
} from './validate.js';

export const SENSOR_POSE_SOURCE = Object.freeze({
  SCENE_CAMERA_SAMPLE: 'SCENE_CAMERA_SAMPLE',
  ANALYTICAL_HIT: 'ANALYTICAL_HIT'
});

const KEYS = [
  'schemaId',
  'schemaVersion',
  'poseId',
  'x',
  'y',
  'z',
  'longitude',
  'latitude',
  'heading',
  'pitch',
  'roll',
  'crs',
  'source',
  'provenance',
  'createdAt'
];

const CRS_KEYS = ['horizontalCrsId', 'verticalDatumId', 'verticalUnits'];

function createCrs(input) {
  requirePlainObject(input || {}, 'SensorPose.crs');
  rejectUnknownKeys(input || {}, 'SensorPose.crs', CRS_KEYS);
  return {
    horizontalCrsId: requireString(input?.horizontalCrsId || 'EPSG:4326', 'crs.horizontalCrsId'),
    verticalDatumId: optionalString(input?.verticalDatumId, 'crs.verticalDatumId'),
    verticalUnits: optionalString(input?.verticalUnits, 'crs.verticalUnits')
  };
}

export function createSensorPose(input = {}, options = {}) {
  requirePlainObject(input, 'SensorPose');
  rejectUnknownKeys(input, 'SensorPose', KEYS);
  if (input.schemaId != null && input.schemaId !== SCHEMA_IDS.SENSOR_POSE) {
    failClosed('UNSUPPORTED_SCHEMA', 'SensorPose schema is unsupported.', { schemaId: input.schemaId });
  }
  const source = requireString(input.source, 'source');
  if (!Object.values(SENSOR_POSE_SOURCE).includes(source)) {
    failClosed('UNKNOWN_ENUM', 'SensorPose source is unknown.', { source });
  }
  const x = optionalFiniteNumber(input.x, 'x');
  const y = optionalFiniteNumber(input.y, 'y');
  const longitude = optionalFiniteNumber(input.longitude, 'longitude');
  const latitude = optionalFiniteNumber(input.latitude, 'latitude');
  if ((x == null || y == null) && (longitude == null || latitude == null)) {
    failClosed('INVALID_NUMBER', 'SensorPose requires X/Y or longitude/latitude.');
  }
  return {
    schemaId: SCHEMA_IDS.SENSOR_POSE,
    schemaVersion: '1.0.0',
    poseId: input.poseId ? requireString(input.poseId, 'poseId') : createId('sensor-pose', options.idFactory),
    x,
    y,
    z: optionalFiniteNumber(input.z, 'z'),
    longitude,
    latitude,
    heading: optionalFiniteNumber(input.heading, 'heading'),
    pitch: optionalFiniteNumber(input.pitch, 'pitch'),
    roll: optionalFiniteNumber(input.roll, 'roll'),
    crs: createCrs(input.crs),
    source,
    provenance: requireString(input.provenance, 'provenance'),
    createdAt: requireString(input.createdAt || isoNow(options.now), 'createdAt')
  };
}

export function validateSensorPose(value) {
  return createSensorPose(value);
}
