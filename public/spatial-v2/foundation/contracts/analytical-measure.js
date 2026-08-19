/**
 * Compact two-hit 3D measurement from AnalyticalHit pairs.
 * Direct 3D is local ENU Euclidean. Horizontal is geodesic. Vertical is ΔZ.
 */

import { SCHEMA_IDS } from './schema-ids.js';
import { createAnalyticalHit } from './analytical-hit.js';
import {
  failClosed,
  isoNow,
  optionalFiniteNumber,
  rejectUnknownKeys,
  requirePlainObject,
  requireString
} from './validate.js';

const KEYS = [
  'schemaId',
  'schemaVersion',
  'fromHitId',
  'toHitId',
  'direct3dMeters',
  'horizontalMeters',
  'verticalMeters',
  'method',
  'limitation',
  'createdAt'
];

const EARTH_RADIUS_M = 6371000;

export function geodesicMeters(a, b) {
  const lon1 = Number(a?.longitude);
  const lat1 = Number(a?.latitude);
  const lon2 = Number(b?.longitude);
  const lat2 = Number(b?.latitude);
  if (![lon1, lat1, lon2, lat2].every(Number.isFinite)) return null;
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function enuDeltaMeters(a, b) {
  const lon1 = Number(a?.longitude);
  const lat1 = Number(a?.latitude);
  const lon2 = Number(b?.longitude);
  const lat2 = Number(b?.latitude);
  const z1 = a?.z;
  const z2 = b?.z;
  if (![lon1, lat1, lon2, lat2].every(Number.isFinite)) return null;
  if (!Number.isFinite(z1) || !Number.isFinite(z2)) return null;
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const east = toRad(lon2 - lon1) * Math.cos(toRad(lat1)) * EARTH_RADIUS_M;
  const north = toRad(lat2 - lat1) * EARTH_RADIUS_M;
  const up = z2 - z1;
  return {
    east,
    north,
    up,
    direct: Math.hypot(east, north, up),
    horizontal: Math.hypot(east, north)
  };
}

export function measureAnalyticalHits(fromHit, toHit, options = {}) {
  const from = createAnalyticalHit(fromHit);
  const to = createAnalyticalHit(toHit);
  if (!Number.isFinite(from.z) || !Number.isFinite(to.z)) {
    failClosed('MISSING_Z', '3D measurement requires real Z on both AnalyticalHits.');
  }
  const enu = enuDeltaMeters(from, to);
  const horizontal = geodesicMeters(from, to);
  if (!enu || !Number.isFinite(horizontal)) {
    failClosed('INVALID_MEASUREMENT', 'Cannot measure AnalyticalHits without finite geography.');
  }
  return createAnalyticalMeasure({
    fromHitId: from.hitId,
    toHitId: to.hitId,
    direct3dMeters: enu.direct,
    horizontalMeters: horizontal,
    verticalMeters: to.z - from.z,
    method: 'ENU_EUCLIDEAN_DIRECT + GEODESIC_HORIZONTAL + SCENE_Z_DELTA',
    limitation: 'Downtown SceneLayer Z only. Same-scene Z, not a certified vertical datum. Not NRCan footprint distance.',
    createdAt: isoNow(options.now)
  }, options);
}

export function createAnalyticalMeasure(input = {}, options = {}) {
  requirePlainObject(input, 'AnalyticalMeasure');
  rejectUnknownKeys(input, 'AnalyticalMeasure', KEYS);
  if (input.schemaId != null && input.schemaId !== SCHEMA_IDS.ANALYTICAL_MEASURE) {
    failClosed('UNSUPPORTED_SCHEMA', 'AnalyticalMeasure schema is unsupported.', { schemaId: input.schemaId });
  }
  const direct3dMeters = optionalFiniteNumber(input.direct3dMeters, 'direct3dMeters');
  const horizontalMeters = optionalFiniteNumber(input.horizontalMeters, 'horizontalMeters');
  const verticalMeters = optionalFiniteNumber(input.verticalMeters, 'verticalMeters');
  if (direct3dMeters == null || horizontalMeters == null || verticalMeters == null) {
    failClosed('INVALID_NUMBER', 'AnalyticalMeasure requires finite direct/horizontal/vertical meters.');
  }
  return {
    schemaId: SCHEMA_IDS.ANALYTICAL_MEASURE,
    schemaVersion: '1.0.0',
    fromHitId: requireString(input.fromHitId, 'fromHitId'),
    toHitId: requireString(input.toHitId, 'toHitId'),
    direct3dMeters,
    horizontalMeters,
    verticalMeters,
    method: requireString(input.method, 'method'),
    limitation: requireString(input.limitation, 'limitation'),
    createdAt: requireString(input.createdAt || isoNow(options.now), 'createdAt')
  };
}

export function validateAnalyticalMeasure(value) {
  return createAnalyticalMeasure(value);
}
