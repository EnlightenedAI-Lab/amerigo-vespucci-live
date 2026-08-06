import test from 'node:test';
import assert from 'node:assert/strict';
import {
  geometryLooksLikeWgs84InWebMercatorLayer,
  looksLikeWgs84Degrees,
  validateWebMercatorGeometry,
  webMercatorPointFromWgs84,
  webMercatorPolylineFromWgs84Points,
  wgs84ToWebMercator
} from '../src/arcgis-geometry.js';
import { geometryNeedsWebMercatorRepair } from '../src/geometry-sr-repair.js';

const QUEBEC = { lon: -65.806084, lat: 49.384148 };
const PONTA = { lon: -25.664444, lat: 37.734722 };

test('wgs84ToWebMercator projects Québec vessel position to Layer 0 coordinates', () => {
  const { x, y } = wgs84ToWebMercator(QUEBEC.lon, QUEBEC.lat);
  assert.ok(Math.abs(x - (-7325499.761979387)) < 1);
  assert.ok(Math.abs(y - 6340296.433247873) < 1);
});

test('wgs84ToWebMercator projects Ponta Delgada destination', () => {
  const { x, y } = wgs84ToWebMercator(PONTA.lon, PONTA.lat);
  assert.ok(Math.abs(x - (-2856952.894711542)) < 1);
  assert.ok(Math.abs(y - 4542018.502594676) < 1);
});

test('looksLikeWgs84Degrees identifies raw degree coordinates', () => {
  assert.equal(looksLikeWgs84Degrees(PONTA.lon, PONTA.lat), true);
  assert.equal(looksLikeWgs84Degrees(-7325499.76, 6340296.43), false);
});

test('geometryLooksLikeWgs84InWebMercatorLayer detects broken stored geometries', () => {
  assert.equal(
    geometryLooksLikeWgs84InWebMercatorLayer({ x: PONTA.lon, y: PONTA.lat }, 'esriGeometryPoint'),
    true
  );
  assert.equal(
    geometryLooksLikeWgs84InWebMercatorLayer(
      { paths: [[[QUEBEC.lon, QUEBEC.lat], [PONTA.lon, PONTA.lat]]] },
      'esriGeometryPolyline'
    ),
    true
  );
  const fixed = webMercatorPointFromWgs84(PONTA.lon, PONTA.lat);
  assert.equal(geometryLooksLikeWgs84InWebMercatorLayer(fixed, 'esriGeometryPoint'), false);
});

test('validateWebMercatorGeometry rejects raw degree geometries', () => {
  assert.throws(
    () => validateWebMercatorGeometry({ x: PONTA.lon, y: PONTA.lat }, 'destination layer'),
    /raw WGS84 degrees/
  );
  assert.doesNotThrow(() => validateWebMercatorGeometry(webMercatorPointFromWgs84(PONTA.lon, PONTA.lat), 'destination layer'));
});

test('webMercatorPolylineFromWgs84Points builds two projected vertices', () => {
  const geometry = webMercatorPolylineFromWgs84Points([
    { longitude: QUEBEC.lon, latitude: QUEBEC.lat },
    { longitude: PONTA.lon, latitude: PONTA.lat }
  ]);
  assert.equal(geometry.paths[0].length, 2);
  assert.ok(Math.abs(geometry.paths[0][0][0] - (-7325499.761979387)) < 1);
  assert.ok(Math.abs(geometry.paths[0][1][0] - (-2856952.894711542)) < 1);
  validateWebMercatorGeometry(geometry, 'estimated route layer');
});

test('geometryNeedsWebMercatorRepair matches repair detector', () => {
  assert.equal(geometryNeedsWebMercatorRepair({ x: PONTA.lon, y: PONTA.lat }, 'esriGeometryPoint'), true);
  assert.equal(geometryNeedsWebMercatorRepair(webMercatorPointFromWgs84(PONTA.lon, PONTA.lat), 'esriGeometryPoint'), false);
});
