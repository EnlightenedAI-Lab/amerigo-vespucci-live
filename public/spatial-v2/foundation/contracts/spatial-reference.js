/**
 * Spatial reference, transform, and measurement receipts.
 * Tool Builder owns the contract. Transformation engines remain specialist-owned.
 */

import { SCHEMA_IDS } from './schema-ids.js';
import {
  failClosed,
  optionalFiniteNumber,
  optionalString,
  rejectUnknownKeys,
  requireArray,
  requireEnum,
  requirePlainObject,
  requireString
} from './validate.js';

const SPEC_KEYS = [
  'schemaId',
  'spatialReferenceRef',
  'horizontalCrsId',
  'authority',
  'axisOrder',
  'horizontalUnits',
  'verticalDatumId',
  'verticalReferenceSurface',
  'verticalUnits',
  'coordinateEpoch'
];

const TRANSFORM_KEYS = [
  'schemaId',
  'sourceRef',
  'targetRef',
  'operationId',
  'engine',
  'version',
  'grids',
  'accuracy',
  'warnings',
  'inputGeometryRef',
  'outputGeometryRef',
  'generatedAt'
];

const MEASUREMENT_KEYS = [
  'schemaId',
  'method',
  'geodesicOrPlanar',
  'units',
  'precision',
  'horizontalRef',
  'verticalRef',
  'geometryRefs',
  'generatedAt'
];

export const AXIS_ORDER = Object.freeze({
  LON_LAT: 'LON_LAT',
  LAT_LON: 'LAT_LON',
  EAST_NORTH: 'EAST_NORTH',
  NORTH_EAST: 'NORTH_EAST'
});

export const WGS84_GEODETIC_REF = 'EPSG:4326';

export function createSpatialReferenceSpec(input = {}) {
  requirePlainObject(input, 'SpatialReferenceSpec');
  rejectUnknownKeys(input, 'SpatialReferenceSpec', SPEC_KEYS);
  const spec = {
    schemaId: SCHEMA_IDS.SPATIAL_REFERENCE,
    spatialReferenceRef: requireString(input.spatialReferenceRef || input.horizontalCrsId, 'spatialReferenceRef'),
    horizontalCrsId: requireString(input.horizontalCrsId, 'horizontalCrsId'),
    authority: requireString(input.authority, 'authority'),
    axisOrder: requireEnum(input.axisOrder, 'axisOrder', Object.values(AXIS_ORDER)),
    horizontalUnits: requireString(input.horizontalUnits, 'horizontalUnits'),
    verticalDatumId: optionalString(input.verticalDatumId, 'verticalDatumId'),
    verticalReferenceSurface: optionalString(input.verticalReferenceSurface, 'verticalReferenceSurface'),
    verticalUnits: optionalString(input.verticalUnits, 'verticalUnits'),
    coordinateEpoch: optionalString(input.coordinateEpoch, 'coordinateEpoch')
  };
  return spec;
}

export function createWgs84GeodeticSpec() {
  return createSpatialReferenceSpec({
    spatialReferenceRef: WGS84_GEODETIC_REF,
    horizontalCrsId: WGS84_GEODETIC_REF,
    authority: 'EPSG',
    axisOrder: AXIS_ORDER.LON_LAT,
    horizontalUnits: 'degree',
    verticalDatumId: null,
    verticalReferenceSurface: null,
    verticalUnits: null,
    coordinateEpoch: null
  });
}

export function validateSpatialReferenceSpec(value) {
  return createSpatialReferenceSpec(value);
}

export function createTransformReceipt(input = {}) {
  requirePlainObject(input, 'TransformReceipt');
  rejectUnknownKeys(input, 'TransformReceipt', TRANSFORM_KEYS);
  return {
    schemaId: SCHEMA_IDS.SPATIAL_REFERENCE,
    sourceRef: requireString(input.sourceRef, 'sourceRef'),
    targetRef: requireString(input.targetRef, 'targetRef'),
    operationId: requireString(input.operationId, 'operationId'),
    engine: requireString(input.engine, 'engine'),
    version: requireString(input.version, 'version'),
    grids: requireArray(input.grids ?? [], 'grids').map((grid, index) => requireString(grid, `grids[${index}]`)),
    accuracy: optionalFiniteNumber(input.accuracy, 'accuracy'),
    warnings: requireArray(input.warnings ?? [], 'warnings').map((warning, index) => requireString(warning, `warnings[${index}]`)),
    inputGeometryRef: optionalString(input.inputGeometryRef, 'inputGeometryRef'),
    outputGeometryRef: optionalString(input.outputGeometryRef, 'outputGeometryRef'),
    generatedAt: requireString(input.generatedAt, 'generatedAt')
  };
}

export function createMeasurementReceipt(input = {}) {
  requirePlainObject(input, 'MeasurementReceipt');
  rejectUnknownKeys(input, 'MeasurementReceipt', MEASUREMENT_KEYS);
  const geodesicOrPlanar = requireString(input.geodesicOrPlanar, 'geodesicOrPlanar');
  if (geodesicOrPlanar !== 'GEODESIC' && geodesicOrPlanar !== 'PLANAR') {
    failClosed('UNKNOWN_ENUM', 'geodesicOrPlanar must be GEODESIC or PLANAR.', { geodesicOrPlanar });
  }
  return {
    schemaId: SCHEMA_IDS.SPATIAL_REFERENCE,
    method: requireString(input.method, 'method'),
    geodesicOrPlanar,
    units: requireString(input.units, 'units'),
    precision: optionalString(input.precision, 'precision'),
    horizontalRef: requireString(input.horizontalRef, 'horizontalRef'),
    verticalRef: optionalString(input.verticalRef, 'verticalRef'),
    geometryRefs: requireArray(input.geometryRefs ?? [], 'geometryRefs').map((ref, index) => requireString(ref, `geometryRefs[${index}]`)),
    generatedAt: requireString(input.generatedAt, 'generatedAt')
  };
}

export function assertComparableVertical(left, right) {
  const leftDatum = left?.verticalDatumId ?? null;
  const rightDatum = right?.verticalDatumId ?? null;
  if (!leftDatum || !rightDatum || leftDatum !== rightDatum) {
    failClosed(
      'VERTICAL_DATUM_UNKNOWN',
      'Z values with missing or incompatible vertical datums cannot be compared.',
      { leftDatum, rightDatum }
    );
  }
}
