import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { createPreviewConfig, createPreviewState } from '../src/demo-map-api.js';
import {
  POINT_INTELLIGENCE_QUERY_PATH,
  POINT_INTELLIGENCE_QUERY_BUNDLE_PATH,
  isPointIntelligenceRouteRegistered,
  isPointIntelligenceBundleRouteRegistered,
  arePointIntelligenceRoutesRegistered,
  registerAgent1SpatialRoutes
} from '../src/spatial/agent1-spatial-routes.js';

const MONTREAL_REQUEST = {
  geometry: { type: 'Point', coordinates: [-73.5673, 45.5017] },
  radiusMeters: 3000,
  informationFamily: 'hydrometric'
};

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
    server.once('error', reject);
  });
}

test('registerAgent1SpatialRoutes mounts POST point-intelligence query route', async () => {
  const express = (await import('express')).default;
  const app = express();
  registerAgent1SpatialRoutes(app);
  assert.equal(isPointIntelligenceRouteRegistered(app), true);
  assert.equal(isPointIntelligenceBundleRouteRegistered(app), true);
  assert.equal(arePointIntelligenceRoutesRegistered(app), true);
});

test('preview createServer registers POST /api/spatial/point-intelligence/query', () => {
  const app = createServer(createPreviewState(), createPreviewConfig(0), null, { preview: true });
  assert.equal(arePointIntelligenceRoutesRegistered(app), true);
});

test('preview runtime exposes governed PI proxy route (not Express 404)', async () => {
  const previousMock = process.env.POINT_INTELLIGENCE_MOCK_STATE;
  process.env.POINT_INTELLIGENCE_MOCK_STATE = 'SUCCESS';
  const app = createServer(createPreviewState(), createPreviewConfig(0), null, { preview: true });
  const server = await listen(app);
  const port = server.address().port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}${POINT_INTELLIGENCE_QUERY_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(MONTREAL_REQUEST)
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.queryState, 'SUCCESS');
    assert.match(String(response.headers.get('content-type') || ''), /json/);
  } finally {
    if (previousMock == null) delete process.env.POINT_INTELLIGENCE_MOCK_STATE;
    else process.env.POINT_INTELLIGENCE_MOCK_STATE = previousMock;
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('preview runtime exposes governed PI bundle proxy route', async () => {
  const app = createServer(createPreviewState(), createPreviewConfig(0), null, { preview: true });
  const server = await listen(app);
  const port = server.address().port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}${POINT_INTELLIGENCE_QUERY_BUNDLE_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        geometry: { type: 'Point', coordinates: [-73.5673, 45.5017] },
        radiusMeters: 3000,
        informationFamilies: 'AUTO',
        temporalIntent: { mode: 'LATEST' },
        url: 'https://evil.example'
      })
    });
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.bundleState, 'INVALID_REQUEST');
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('preview entrypoint path matches npm run spatial', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const pkg = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'));
  assert.match(pkg.scripts.spatial, /src\/preview\.js/);
});
