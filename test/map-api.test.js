import test from 'node:test';
import assert from 'node:assert/strict';
import {
  arcgisDateToIso,
  normalizeAttributes,
  pointToCoordinates,
  polylineToCoordinates,
  toGeoJsonFeature,
  toFeatureCollection,
  arcgisFeaturesToGeoJson,
  MapApiService
} from '../src/map-api.js';
import { classifyFreshness } from '../src/freshness.js';

test('converts ArcGIS epoch dates to ISO strings', () => {
  const ms = new Date('2026-08-05T12:00:00Z').getTime();
  const iso = arcgisDateToIso(ms);
  assert.equal(iso, '2026-08-05T12:00:00.000Z');
});

test('returns null for invalid ArcGIS dates', () => {
  assert.equal(arcgisDateToIso(null), null);
  assert.equal(arcgisDateToIso(''), null);
});

test('normalizes attributes and converts date fields', () => {
  const ms = new Date('2026-08-05T12:00:00Z').getTime();
  const attrs = { MMSI: 247999000, LastAIS: ms, OBJECTID: 1 };
  const normalized = normalizeAttributes(attrs);
  assert.equal(normalized.MMSI, 247999000);
  assert.equal(normalized.LastAIS, '2026-08-05T12:00:00.000Z');
  assert.equal(normalized.OBJECTID, undefined);
});

test('converts point geometry to coordinates', () => {
  assert.deepEqual(pointToCoordinates({ x: -20, y: 38 }), [-20, 38]);
  assert.deepEqual(pointToCoordinates(null, { Longitude: -25, Latitude: 37 }), [-25, 37]);
});

test('converts Web Mercator point geometry to WGS84', () => {
  const coords = pointToCoordinates(
    { x: -7325499.761979387, y: 6340296.433247873 },
    { Longitude: -65.806084, Latitude: 49.384148 }
  );
  assert.ok(Math.abs(coords[0] - (-65.806084)) < 0.0001);
  assert.ok(Math.abs(coords[1] - 49.384148) < 0.0001);
});

test('converts Web Mercator polyline geometry to WGS84', () => {
  const coords = polylineToCoordinates({
    paths: [[[-7325499.761979387, 6340296.433247873], [-2856952.837174794, 4542018.411122051]]]
  });
  assert.equal(coords.length, 2);
  assert.ok(Math.abs(coords[0][0] - (-65.806084)) < 0.0001);
  assert.ok(Math.abs(coords[0][1] - 49.384148) < 0.0001);
  assert.ok(Math.abs(coords[1][0] - (-25.664444)) < 0.0001);
  assert.ok(Math.abs(coords[1][1] - 37.734722) < 0.0001);
});

test('returns null for invalid point coordinates', () => {
  assert.equal(pointToCoordinates(null, {}), null);
});

test('converts polyline geometry to coordinates', () => {
  const coords = polylineToCoordinates({ paths: [[[-20, 38], [-21, 39]]] });
  assert.deepEqual(coords, [[-20, 38], [-21, 39]]);
});

test('returns null for polyline with fewer than two points', () => {
  assert.equal(polylineToCoordinates({ paths: [[[-20, 38]]] }), null);
  assert.equal(polylineToCoordinates(null), null);
});

test('builds GeoJSON Feature from point', () => {
  const ms = new Date('2026-08-05T12:00:00Z').getTime();
  const feature = toGeoJsonFeature('Point', [-20, 38], { MMSI: 247999000, LastAIS: ms });
  assert.equal(feature.type, 'Feature');
  assert.deepEqual(feature.geometry, { type: 'Point', coordinates: [-20, 38] });
  assert.equal(feature.properties.MMSI, 247999000);
});

test('builds FeatureCollection filtering null features', () => {
  const fc = toFeatureCollection([
    toGeoJsonFeature('Point', [-20, 38], { MMSI: 1 }),
    null,
    toGeoJsonFeature('Point', [-21, 39], { MMSI: 2 })
  ]);
  assert.equal(fc.features.length, 2);
});

test('converts ArcGIS point features to GeoJSON', () => {
  const fc = arcgisFeaturesToGeoJson([
    { geometry: { x: -20, y: 38 }, attributes: { MMSI: 247999000, VesselName: 'TEST' } }
  ], 'point');
  assert.equal(fc.type, 'FeatureCollection');
  assert.equal(fc.features.length, 1);
  assert.deepEqual(fc.features[0].geometry.coordinates, [-20, 38]);
});

test('converts ArcGIS polyline features to GeoJSON', () => {
  const fc = arcgisFeaturesToGeoJson([
    { geometry: { paths: [[[-20, 38], [-21, 39]]] }, attributes: { RouteType: 'Observed AIS track' } }
  ], 'polyline');
  assert.equal(fc.features[0].geometry.type, 'LineString');
});

test('handles empty ArcGIS feature arrays', () => {
  const fc = arcgisFeaturesToGeoJson([], 'point');
  assert.equal(fc.features.length, 0);
});

test('handles missing optional fields gracefully', () => {
  const feature = toGeoJsonFeature('Point', [-20, 38], { MMSI: 247999000 });
  assert.equal(feature.properties.VesselName, undefined);
  assert.equal(feature.properties.Heading, undefined);
});

test('MapApiService returns empty vessel when no features', async () => {
  const mockArcgis = {
    layerUrl: (id) => `https://example.test/${id}`,
    get: async () => ({ features: [] })
  };
  const config = { targetMmsi: 247999000, currentLayerId: 0, historyLayerId: 1, travelledRouteLayerId: 2, destinationLayerId: 3, estimatedRouteLayerId: 4, conditionsLayerId: 5, routeMaxHistoryPoints: 5000 };
  const service = new MapApiService(mockArcgis, config, {});
  const vessel = await service.getVessel();
  assert.equal(vessel.empty, true);
  assert.equal(vessel.geojson.features.length, 0);
  assert.equal(vessel.freshness, 'unknown');
});

test('MapApiService includes freshness and source from state', async () => {
  const lastAIS = new Date('2026-08-05T11:59:00Z').getTime();
  const mockArcgis = {
    layerUrl: (id) => `https://example.test/${id}`,
    get: async () => ({
      features: [{ geometry: { x: -20, y: 38 }, attributes: { MMSI: 247999000, LastAIS: lastAIS, VesselName: 'AMERIGO VESPUCCI' } }]
    })
  };
  const config = { targetMmsi: 247999000, currentLayerId: 0, historyLayerId: 1, travelledRouteLayerId: 2, destinationLayerId: 3, estimatedRouteLayerId: 4, conditionsLayerId: 5, routeMaxHistoryPoints: 5000 };
  const now = new Date('2026-08-05T12:00:00Z').getTime();
  const service = new MapApiService(mockArcgis, config, { lastPositionSource: 'aisstream' });
  const vessel = await service.getVessel();
  assert.equal(vessel.empty, false);
  assert.equal(vessel.source, 'aisstream');
  assert.equal(classifyFreshness(vessel.lastAIS, now), 'fresh');
});

test('MapApiService estimated route includes disclaimer', async () => {
  const mockArcgis = {
    layerUrl: (id) => `https://example.test/${id}`,
    get: async () => ({
      features: [{ geometry: { paths: [[[-20, 38], [-25, 37]]] }, attributes: { RouteType: 'Straight-line estimate', DistanceNM: 500 } }]
    })
  };
  const config = { targetMmsi: 247999000, currentLayerId: 0, historyLayerId: 1, travelledRouteLayerId: 2, destinationLayerId: 3, estimatedRouteLayerId: 4, conditionsLayerId: 5, routeMaxHistoryPoints: 5000 };
  const service = new MapApiService(mockArcgis, config, {});
  const route = await service.getEstimatedRoute();
  assert.equal(route.empty, false);
  assert.match(route.disclaimer, /not an official navigational route/i);
});

test('MapApiService conditions includes warning and attribution', async () => {
  const mockArcgis = {
    layerUrl: (id) => `https://example.test/${id}`,
    get: async () => ({
      features: [{ geometry: { x: -20, y: 38 }, attributes: { MMSI: 247999000, WeatherText: 'Clear', Attribution: 'Open-Meteo' } }]
    })
  };
  const config = { targetMmsi: 247999000, currentLayerId: 0, historyLayerId: 1, travelledRouteLayerId: 2, destinationLayerId: 3, estimatedRouteLayerId: 4, conditionsLayerId: 5, routeMaxHistoryPoints: 5000 };
  const service = new MapApiService(mockArcgis, config, {});
  const conditions = await service.getConditions();
  assert.match(conditions.warning, /not for navigation/i);
  assert.ok(conditions.attribution);
});

test('MapApiService getMapData strips sensitive fields', async () => {
  const mockArcgis = {
    layerUrl: (id) => `https://example.test/${id}`,
    get: async () => ({ features: [] })
  };
  const config = { targetMmsi: 247999000, currentLayerId: 0, historyLayerId: 1, travelledRouteLayerId: 2, destinationLayerId: 3, estimatedRouteLayerId: 4, conditionsLayerId: 5, routeMaxHistoryPoints: 5000 };
  const service = new MapApiService(mockArcgis, config, {});
  const data = await service.getMapData();
  const json = JSON.stringify(data);
  assert.doesNotMatch(json, /ARCGIS_TOKEN/i);
  assert.doesNotMatch(json, /password/i);
  assert.ok(data.meta);
  assert.equal(data.meta.source, 'arcgis');
});
