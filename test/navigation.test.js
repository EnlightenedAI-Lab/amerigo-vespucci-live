import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPolyline, calculateEstimatedETA, createPositionKey, ESTIMATED_ROUTE_BASIS, haversineDistanceNM, parseDestinationConfig } from '../src/navigation.js';
import { ArcGISClient } from '../src/arcgis.js';

const position = { mmsi: 247999000, vesselName: 'AMERIGO VESPUCCI', latitude: 38, longitude: -20, speedKnots: 10, lastAIS: new Date('2026-08-05T12:00:00Z') };
const config = { targetMmsi: 247999000, historyLayerId: 1, travelledRouteLayerId: 2, destinationLayerId: 3, estimatedRouteLayerId: 4, routeMaxHistoryPoints: 5000, etaMinSpeedKnots: 1, destinationName: 'Ponta Delgada, Portugal', destinationPortCode: 'PTPDL', destinationLatitude: '37.734722', destinationLongitude: '-25.664444' };

test('generates stable PositionKey from MMSI, source, and observation timestamp', () => {
  assert.equal(createPositionKey(position, 'aisstream'), '247999000:aisstream:2026-08-05T12:00:00.000Z');
});

test('rejects duplicate history by PositionKey', async () => {
  const client = Object.assign(Object.create(ArcGISClient.prototype), { config, historyPositionExists: async () => true, getLatestHistoryTimestamp: async () => null });
  const result = await client.addHistoryPosition(position, 'aisstream');
  assert.deepEqual(result, { inserted: false, reason: 'duplicate-position-key' });
});

test('rejects history whose LastAIS is not newer than latest stored timestamp', async () => {
  const client = Object.assign(Object.create(ArcGISClient.prototype), { config, historyPositionExists: async () => false, getLatestHistoryTimestamp: async () => new Date('2026-08-05T12:01:00Z') });
  const result = await client.addHistoryPosition(position, 'aisstream');
  assert.equal(result.inserted, false);
  assert.equal(result.reason, 'not-newer-than-latest-history');
});

test('queries history ordered by LastAIS ascending', async () => {
  let url;
  const client = Object.assign(Object.create(ArcGISClient.prototype), { config, layerUrl: (id) => `https://example.test/${id}`, get: async (u) => { url = u; return { features: [] }; } });
  await client.queryHistoryPoints();
  assert.match(url, /orderByFields=LastAIS\+ASC/);
});

test('builds ArcGIS polylines from ordered coordinates', () => {
  assert.deepEqual(buildPolyline([{ latitude: 1, longitude: 2 }, { latitude: 3, longitude: 4 }]).paths, [[[2, 1], [4, 3]]]);
});

test('does not create travelled route with fewer than two points', async () => {
  const client = Object.assign(Object.create(ArcGISClient.prototype), { config, queryHistoryPoints: async () => [position] });
  assert.deepEqual(await client.upsertTravelledRoute(), { updated: false, pointCount: 1 });
});

test('calculates Haversine distance in nautical miles', () => {
  const distance = haversineDistanceNM({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 });
  assert.ok(Math.abs(distance - 60.04) < 0.2);
});

test('calculates ETA from position timestamp, distance, and speed', () => {
  assert.equal(calculateEstimatedETA(new Date('2026-08-05T00:00:00Z'), 20, 10, 1).toISOString(), '2026-08-05T02:00:00.000Z');
});

test('returns null ETA at low or invalid speed', () => {
  assert.equal(calculateEstimatedETA(new Date(), 20, 0.5, 1), null);
  assert.equal(calculateEstimatedETA(new Date(), 20, Number.NaN, 1), null);
});

test('parses destination configuration', () => {
  assert.deepEqual(parseDestinationConfig(config), { name: 'Ponta Delgada, Portugal', portCode: 'PTPDL', latitude: 37.734722, longitude: -25.664444 });
});

test('estimated-route Basis language is explicit and unofficial', () => {
  assert.equal(ESTIMATED_ROUTE_BASIS, 'Straight-line geographic estimate; not an official navigational route.');
});

test('current position flow still uses Layer 0 upsert fields without history-only attributes', () => {
  const client = Object.assign(Object.create(ArcGISClient.prototype), { config: { currentLayerId: 0 }, currentObjectId: 9 });
  const feature = client.toFeature(position, { includeObjectId: true });
  assert.equal(feature.attributes.OBJECTID, 9);
  assert.equal(feature.attributes.MMSI, 247999000);
  assert.equal(feature.attributes.PositionKey, undefined);
  assert.deepEqual(feature.geometry, { x: -20, y: 38, spatialReference: { wkid: 4326 } });
});
