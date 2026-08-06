import test from 'node:test';
import assert from 'node:assert/strict';
import {
  destinationNeedsRepair,
  estimatedRouteNeedsRepair,
  layerDiagToPosition,
  travelledRouteNeedsRepair
} from '../src/vespucci-layer-repair.js';

const config = {
  targetMmsi: 247999000,
  destinationName: 'Ponta Delgada, Portugal',
  destinationPortCode: 'PTPDL',
  destinationLatitude: '37.734722',
  destinationLongitude: '-25.664444'
};

test('destination repair triggers when feature is missing', () => {
  assert.equal(destinationNeedsRepair({ destinationExists: false }, config), true);
});

test('estimated route repair triggers when start differs from Layer 0', () => {
  const est = { estimatedRouteExists: true, routeStart: { latitude: 10, longitude: 10 } };
  const layer0 = { displayAttributes: { Latitude: 49.38, Longitude: -65.8 } };
  assert.equal(estimatedRouteNeedsRepair(est, layer0), true);
});

test('travelled route repair only when two or more history points exist', () => {
  assert.equal(travelledRouteNeedsRepair({ travelledRouteExists: false }, 1), false);
  assert.equal(travelledRouteNeedsRepair({ travelledRouteExists: false }, 2), true);
});

test('layerDiagToPosition uses stored Layer 0 attribute coordinates', () => {
  const pos = layerDiagToPosition({
    currentCoordinates: { latitude: 6340296.43, longitude: -7325499.76 },
    latestTimestamp: '2026-08-05T20:12:00.000Z',
    displayAttributes: {
      MMSI: 247999000,
      VesselName: 'AMERIGO VESPUCCI',
      SpeedKnots: 8,
      Latitude: 49.38,
      Longitude: -65.8
    }
  }, config);
  assert.equal(pos.latitude, 49.38);
  assert.equal(pos.longitude, -65.8);
});
