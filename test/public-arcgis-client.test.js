import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicArcGISClient } from '../src/public-arcgis-client.js';

test('public ArcGIS client builds layer URLs without credentials', () => {
  const client = new PublicArcGISClient('https://services.example.com/arcgis/rest/services/demo/FeatureServer/');
  assert.equal(client.layerUrl(3), 'https://services.example.com/arcgis/rest/services/demo/FeatureServer/3');
});

test('public ArcGIS client queryHistoryPoints is read-only REST', async () => {
  const calls = [];
  const client = new PublicArcGISClient('https://services.example.com/demo/FeatureServer');
  client.get = async (url) => {
    calls.push(url);
    assert.doesNotMatch(url, /token=/i);
    return { features: [{ geometry: { x: 1, y: 2 }, attributes: { LastAIS: 1, PositionKey: 'a' } }] };
  };
  const points = await client.queryHistoryPoints({ targetMmsi: 247999000, historyLayerId: 1, routeMaxHistoryPoints: 10 });
  assert.equal(points.length, 1);
  assert.match(calls[0], /\/1\/query\?/);
});
