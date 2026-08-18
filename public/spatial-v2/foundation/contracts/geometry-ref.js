/**
 * Serializable geometry / AOI references. Coordinates are JSON only.
 * Runtime provider geometry objects are prohibited in World State.
 */

import {
  createId,
  failClosed,
  isPlainObject,
  optionalString,
  rejectUnknownKeys,
  requirePlainObject,
  requireString
} from './validate.js';
import { WGS84_GEODETIC_REF } from './spatial-reference.js';

export const GEOMETRY_KIND = Object.freeze({
  POINT: 'POINT',
  LINE: 'LINE',
  POLYGON: 'POLYGON',
  MULTIPOINT: 'MULTIPOINT',
  MULTILINE: 'MULTILINE',
  MULTIPOLYGON: 'MULTIPOLYGON',
  ENVELOPE: 'ENVELOPE',
  AOI: 'AOI'
});

const KEYS = [
  'geometryRefId',
  'kind',
  'coordinates',
  'spatialReferenceRef',
  'bbox',
  'accuracy'
];

const ACCURACY_KEYS = ['horizontal', 'vertical', 'units'];

function assertFiniteCoordinate(value, path) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    failClosed('INVALID_GEOMETRY', `Coordinate at ${path} must be a finite number.`, { path, value });
  }
  return value;
}

function validateCoordinateTree(value, path) {
  if (typeof value === 'number') {
    return assertFiniteCoordinate(value, path);
  }
  if (!Array.isArray(value) || value.length === 0) {
    failClosed('INVALID_GEOMETRY', `${path} must be a non-empty nested array of finite numbers.`, { path });
  }
  return value.map((item, index) => validateCoordinateTree(item, `${path}[${index}]`));
}

function validateCoordinates(kind, coordinates) {
  if (coordinates == null) {
    failClosed('MISSING_GEOMETRY', 'GeometryRef coordinates are required.', { kind });
  }
  if (kind === GEOMETRY_KIND.POINT) {
    if (!Array.isArray(coordinates) || coordinates.length < 2 || coordinates.length > 3) {
      failClosed('INVALID_GEOMETRY', 'POINT coordinates must be [x, y] or [x, y, z].', { coordinates });
    }
    const [x, y, z] = coordinates;
    assertFiniteCoordinate(x, 'coordinates[0]');
    assertFiniteCoordinate(y, 'coordinates[1]');
    if (z === undefined) return [x, y];
    if (z === null) {
      failClosed('INVALID_GEOMETRY', 'POINT z must be finite or omitted.', { coordinates });
    }
    assertFiniteCoordinate(z, 'coordinates[2]');
    return [x, y, z];
  }
  if (kind === GEOMETRY_KIND.ENVELOPE) {
    if (!Array.isArray(coordinates) || coordinates.length !== 4) {
      failClosed('INVALID_GEOMETRY', 'ENVELOPE coordinates must be [minX, minY, maxX, maxY].', { coordinates });
    }
    return coordinates.map((n, index) => assertFiniteCoordinate(n, `coordinates[${index}]`));
  }
  return validateCoordinateTree(coordinates, 'coordinates');
}

function validateAccuracy(accuracy) {
  if (accuracy == null) return null;
  requirePlainObject(accuracy, 'accuracy');
  rejectUnknownKeys(accuracy, 'accuracy', ACCURACY_KEYS);
  const horizontal = accuracy.horizontal;
  const vertical = accuracy.vertical;
  if (horizontal != null && (typeof horizontal !== 'number' || !Number.isFinite(horizontal))) {
    failClosed('INVALID_NUMBER', 'accuracy.horizontal must be finite or null.');
  }
  if (vertical != null && (typeof vertical !== 'number' || !Number.isFinite(vertical))) {
    failClosed('INVALID_NUMBER', 'accuracy.vertical must be finite or null.');
  }
  return {
    horizontal: horizontal ?? null,
    vertical: vertical ?? null,
    units: optionalString(accuracy.units, 'accuracy.units')
  };
}

function validateBbox(bbox) {
  if (bbox == null) return null;
  if (!Array.isArray(bbox) || bbox.length !== 4 || bbox.some((n) => !Number.isFinite(n))) {
    failClosed('INVALID_GEOMETRY', 'bbox must be [minX, minY, maxX, maxY] or null.');
  }
  return [...bbox];
}

export function createGeometryRef(input = {}, options = {}) {
  requirePlainObject(input, 'GeometryRef');
  rejectUnknownKeys(input, 'GeometryRef', KEYS);
  const kind = requireString(input.kind, 'kind');
  if (!Object.values(GEOMETRY_KIND).includes(kind)) {
    failClosed('UNKNOWN_ENUM', 'Geometry kind is unknown.', { kind });
  }
  return {
    geometryRefId: input.geometryRefId
      ? requireString(input.geometryRefId, 'geometryRefId')
      : createId('geom', options.idFactory),
    kind,
    coordinates: validateCoordinates(kind, input.coordinates),
    spatialReferenceRef: requireString(input.spatialReferenceRef || WGS84_GEODETIC_REF, 'spatialReferenceRef'),
    bbox: validateBbox(input.bbox),
    accuracy: validateAccuracy(input.accuracy)
  };
}

export function createPointGeometryRef({ longitude, latitude, z = null, spatialReferenceRef, accuracy, geometryRefId } = {}, options = {}) {
  const lon = Number(longitude);
  const lat = Number(latitude);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    failClosed('INVALID_GEOMETRY', 'Point longitude/latitude must be finite.');
  }
  const coordinates = z == null ? [lon, lat] : [lon, lat, Number(z)];
  return createGeometryRef({
    geometryRefId,
    kind: GEOMETRY_KIND.POINT,
    coordinates,
    spatialReferenceRef: spatialReferenceRef || WGS84_GEODETIC_REF,
    accuracy
  }, options);
}

export function validateGeometryRef(value) {
  return createGeometryRef(value);
}

export function isGeometryRef(value) {
  return isPlainObject(value) && typeof value.geometryRefId === 'string' && typeof value.kind === 'string';
}
