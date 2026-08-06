import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseLayer, layer0AttributesToPosition } from '../src/arcgis-diagnostics.js';

const config = {
  targetMmsi: 247999000,
  currentLayerId: 0,
  historyLayerId: 1,
  travelledRouteLayerId: 2,
  destinationLayerId: 3,
  estimatedRouteLayerId: 4,
  conditionsLayerId: 5,
  routeMaxHistoryPoints: 5000
};

function mockClient(layerResponses) {
  return {
    featureServiceUrl: 'https://services.arcgis.com/example/FeatureServer',
    layerUrl: (id) => `https://services.arcgis.com/example/FeatureServer/${id}`,
    get: async (url) => {
      if (url.includes('?f=json') && !url.includes('/query')) {
        const id = Number(url.match(/\/(\d)\?/)?.[1]);
        return { geometryType: layerResponses[id]?.geometryType || 'esriGeometryPoint' };
      }
      if (url.includes('returnCountOnly')) {
        const id = Number(url.match(/\/(\d)\//)?.[1]);
        return { count: layerResponses[id]?.count ?? 0 };
      }
      const id = Number(url.match(/\/(\d)\//)?.[1]);
      return { features: layerResponses[id]?.features || [], extent: layerResponses[id]?.extent };
    },
    queryHistoryPoints: async () => layerResponses[1]?.historyPoints || []
  };
}

test('diagnostics are read-only and report layer counts', async () => {
  const client = mockClient({
    0: {
      geometryType: 'esriGeometryPoint',
      count: 1,
      features: [{ geometry: { x: -68, y: 48 }, attributes: { MMSI: 247999000, LastAIS: Date.now(), Latitude: 48, Longitude: -68 } }]
    }
  });
  const report = await diagnoseLayer(client, 0, config);
  assert.equal(report.featureCount, 1);
  assert.equal(report.hasValidGeometry, true);
  assert.equal(report.name, 'Current Vessel Position');
});

test('diagnostics explain insufficient history for travelled route', async () => {
  const client = mockClient({
    1: { geometryType: 'esriGeometryPoint', count: 1, features: [{ geometry: { x: 1, y: 2 }, attributes: { LastAIS: 1 } }], historyPoints: [{ latitude: 2, longitude: 1, attributes: {} }] },
    2: { geometryType: 'esriGeometryPolyline', count: 0, features: [] }
  });
  const route = await diagnoseLayer(client, 2, config);
  assert.match(route.travelledRouteNote, /fewer than two stored observations/i);
});

test('layer0AttributesToPosition never calls external providers', () => {
  const pos = layer0AttributesToPosition({ Latitude: 48, Longitude: -68, LastAIS: Date.now(), MMSI: 247999000 }, config);
  assert.ok(pos);
  assert.equal(pos.latitude, 48);
});
