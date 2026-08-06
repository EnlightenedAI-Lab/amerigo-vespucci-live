import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer } from '../src/server.js';
import { MapApiService } from '../src/map-api.js';

const config = {
  targetMmsi: 247999000,
  currentLayerId: 0,
  historyLayerId: 1,
  travelledRouteLayerId: 2,
  destinationLayerId: 3,
  estimatedRouteLayerId: 4,
  conditionsLayerId: 5,
  routeMaxHistoryPoints: 5000,
  enableHistory: false,
  enableConditions: true,
  healthStaleAfterSeconds: 1800
};

const state = {
  lastPosition: null,
  lastPositionSource: 'aisstream',
  lastArcGISUpdate: new Date('2026-08-05T12:00:00Z'),
  lastHistoryWrite: null,
  historyPointCount: 0,
  lastTravelledRouteUpdate: null,
  lastDestinationUpdate: null,
  lastEstimatedRouteUpdate: null,
  distanceRemainingNM: null,
  estimatedETA: null,
  lastDataDockedAttempt: null,
  lastDataDockedAccepted: null,
  aisConnected: () => true,
  openMeteoClient: null
};

function createMockArcgis() {
  const lastAIS = Date.now() - 60_000;
  return {
    layerUrl: (id) => `https://example.test/${id}`,
    get: async (url) => {
      if (url.includes('/0/')) {
        return { features: [{ geometry: { x: -20, y: 38 }, attributes: { MMSI: 247999000, VesselName: 'AMERIGO VESPUCCI', LastAIS: lastAIS, SpeedKnots: 10, Course: 180, Heading: 175 } }] };
      }
      if (url.includes('/1/')) {
        return { features: [{ geometry: { x: -20, y: 38 }, attributes: { MMSI: 247999000, LastAIS: lastAIS } }] };
      }
      if (url.includes('/2/')) {
        return { features: [{ geometry: { paths: [[[-20, 38], [-21, 39]]] }, attributes: { RouteType: 'Observed AIS track', PointCount: 2 } }] };
      }
      if (url.includes('/3/')) {
        return { features: [{ geometry: { x: -25.66, y: 37.73 }, attributes: { DestinationName: 'Ponta Delgada', PortCode: 'PTPDL' } }] };
      }
      if (url.includes('/4/')) {
        return { features: [{ geometry: { paths: [[[-20, 38], [-25.66, 37.73]]] }, attributes: { RouteType: 'Straight-line estimate', DistanceNM: 500 } }] };
      }
      if (url.includes('/5/')) {
        return { features: [{ geometry: { x: -20, y: 38 }, attributes: { MMSI: 247999000, WeatherText: 'Clear', WindKnots: 12 } }] };
      }
      return { features: [] };
    }
  };
}

function request(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${urlPath}`, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(body) }));
    }).on('error', reject);
  });
}

function requestText(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${urlPath}`, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

function startServer() {
  const arcgis = createMockArcgis();
  const app = createServer(state, config, arcgis);
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port, arcgis });
    });
  });
}

test('GET /health returns 200 with tracking fields preserved', async () => {
  const { server, port } = await startServer();
  try {
    const res = await request(port, '/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.mmsi, 247999000);
    assert.equal(res.body.aisConnected, true);
    assert.equal(res.body.historyEnabled, false);
  } finally {
    server.close();
  }
});

test('GET / serves index.html', async () => {
  const { server, port } = await startServer();
  try {
    const res = await requestText(port, '/');
    assert.equal(res.status, 200);
    assert.match(res.body, /Amerigo Vespucci/);
    assert.match(res.body, /leaflet/i);
  } finally {
    server.close();
  }
});

test('GET /api/map-data returns combined map data', async () => {
  const { server, port } = await startServer();
  try {
    const res = await request(port, '/api/map-data');
    assert.equal(res.status, 200);
    assert.ok(res.body.vessel);
    assert.ok(res.body.history);
    assert.ok(res.body.travelledRoute);
    assert.ok(res.body.destination);
    assert.ok(res.body.estimatedRoute);
    assert.ok(res.body.conditions);
    assert.ok(res.body.meta);
    assert.equal(res.body.meta.source, 'arcgis');
  } finally {
    server.close();
  }
});

test('individual API endpoints return expected data', async () => {
  const { server, port } = await startServer();
  try {
    const vessel = await request(port, '/api/vessel');
    assert.equal(vessel.body.geojson.features.length, 1);
    assert.equal(vessel.body.freshness, 'fresh');

    const history = await request(port, '/api/history');
    assert.equal(history.body.count, 1);

    const route = await request(port, '/api/travelled-route');
    assert.equal(route.body.empty, false);

    const dest = await request(port, '/api/destination');
    assert.equal(dest.body.properties.PortCode, 'PTPDL');

    const estimated = await request(port, '/api/estimated-route');
    assert.match(estimated.body.disclaimer, /not an official navigational route/i);

    const conditions = await request(port, '/api/conditions');
    assert.match(conditions.body.warning, /not for navigation/i);
  } finally {
    server.close();
  }
});

test('API responses include cache metadata', async () => {
  const { server, port } = await startServer();
  try {
    const first = await request(port, '/api/vessel');
    assert.equal(first.body.cached, false);
    assert.ok(first.body.fetchedAt);
    assert.ok(first.body.expiresAt);

    const second = await request(port, '/api/vessel');
    assert.equal(second.body.cached, true);
  } finally {
    server.close();
  }
});

test('API responses do not contain credentials', async () => {
  const { server, port } = await startServer();
  try {
    const res = await request(port, '/api/map-data');
    const json = JSON.stringify(res.body);
    assert.doesNotMatch(json, /ARCGIS_TOKEN/i);
    assert.doesNotMatch(json, /DATADOCKED_API_KEY/i);
    assert.doesNotMatch(json, /AISSTREAM_API_KEY/i);
    assert.doesNotMatch(json, /password/i);
  } finally {
    server.close();
  }
});

test('security headers are set on responses', async () => {
  const { server, port } = await startServer();
  try {
    const res = await requestText(port, '/health');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-frame-options'], 'DENY');
  } finally {
    server.close();
  }
});

test('static CSS and JS files are served', async () => {
  const { server, port } = await startServer();
  try {
    const css = await requestText(port, '/css/styles.css');
    assert.equal(css.status, 200);
    assert.match(css.body, /--bg:/);

    const js = await requestText(port, '/js/app.js');
    assert.equal(js.status, 200);
    assert.match(js.body, /fetchMapData/);
  } finally {
    server.close();
  }
});

test('read endpoints only call ArcGIS get, not provider clients', async () => {
  let getCallCount = 0;
  const arcgis = createMockArcgis();
  const originalGet = arcgis.get;
  arcgis.get = async (...args) => { getCallCount++; return originalGet(...args); };

  const dataDockedCalled = { poll: false, fetch: false };
  const openMeteoCalled = { onPosition: false };
  const aisCalled = { start: false };

  const testState = {
    ...state,
    dataDockedClient: { poll: () => { dataDockedCalled.poll = true; } },
    openMeteoClient: { onPosition: () => { openMeteoCalled.onPosition = true; }, health: () => ({}) },
    aisClient: { start: () => { aisCalled.start = true; } }
  };

  const service = new MapApiService(arcgis, config, testState);
  await service.getMapData();

  assert.ok(getCallCount > 0);
  assert.equal(dataDockedCalled.poll, false);
  assert.equal(openMeteoCalled.onPosition, false);
  assert.equal(aisCalled.start, false);
});

test('empty layers return empty geojson without error', async () => {
  const arcgis = {
    layerUrl: (id) => `https://example.test/${id}`,
    get: async () => ({ features: [] })
  };
  const service = new MapApiService(arcgis, config, state);
  const history = await service.getHistory();
  assert.equal(history.empty, true);
  assert.equal(history.geojson.features.length, 0);

  const route = await service.getTravelledRoute();
  assert.equal(route.empty, true);
});
