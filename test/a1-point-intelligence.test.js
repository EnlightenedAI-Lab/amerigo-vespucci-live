import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPointIntelligenceBrokerRequest,
  queryPointIntelligenceBroker
} from '../src/spatial/point-intelligence-broker-client.js';
import {
  buildPointIntelligenceRequest
} from '../public/spatial/point-intelligence-request.js';
import {
  formatPointIntelligenceStatus,
  summarizePointIntelligenceResponse
} from '../public/spatial/point-intelligence-status.js';
import { POINT_INTELLIGENCE_UI_ENABLED } from '../public/spatial/point-intelligence-config.js';

test('Point Intelligence UI gate is enabled', () => {
  assert.equal(POINT_INTELLIGENCE_UI_ENABLED, true);
});

test('browser request builder rejects arbitrary URL authority', () => {
  const built = buildPointIntelligenceRequest({
    url: 'https://evil.example',
    geometry: { type: 'Point', coordinates: [-73.5, 45.5] }
  });
  assert.equal(built.ok, false);
});

test('browser request builder rejects capabilityId authority', () => {
  const built = buildPointIntelligenceRequest({
    capabilityId: 'hydrometric-stations',
    geometry: { type: 'Point', coordinates: [-73.5, 45.5] }
  });
  assert.equal(built.ok, false);
});

test('server broker request builder allowlists spatial intent only', () => {
  const built = buildPointIntelligenceBrokerRequest({
    geometry: { type: 'Point', coordinates: [-73.5673, 45.5017] },
    radiusMeters: 3000,
    informationFamily: 'hydrometric'
  });
  assert.equal(built.ok, true);
  assert.deepEqual(Object.keys(built.value).sort(), ['domains', 'geometry', 'informationFamily', 'radiusMeters']);
});

test('status mapping distinguishes provider failure from no results', () => {
  const provider = formatPointIntelligenceStatus('PROVIDER_UNAVAILABLE');
  const empty = formatPointIntelligenceStatus('NO_RESULTS');
  assert.notEqual(provider.message, empty.message);
  assert.equal(provider.severity, 'error');
  assert.equal(empty.severity, 'info');
});

test('summary exposes receipt and provider without inventing live labels', () => {
  const summary = summarizePointIntelligenceResponse({
    queryState: 'SUCCESS',
    queryReceiptId: 'qreceipt-test',
    resultCount: 1,
    results: [{
      providerName: 'MSC GeoMet',
      spatialPrecision: 'SOURCE_POINT',
      temporal: { OBSERVATION_DATETIME: '2024-01-01T00:00:00Z' },
      category: 'climate'
    }],
    request: { informationFamily: 'climate', geometry: { coordinates: [-73.5, 45.5] } }
  });
  assert.equal(summary.queryReceiptId, 'qreceipt-test');
  assert.equal(summary.providerName, 'MSC GeoMet');
  assert.equal(summary.informationFamily, 'climate');
});

test('broker client maps transport failure to PROVIDER_UNAVAILABLE', async () => {
  const result = await queryPointIntelligenceBroker(
    {
      geometry: { type: 'Point', coordinates: [-73.5, 45.5] },
      radiusMeters: 1000,
      informationFamily: 'hydrometric'
    },
    { brokerUrl: 'http://127.0.0.1:1', timeoutMs: 200 }
  );
  assert.equal(result.body.queryState, 'PROVIDER_UNAVAILABLE');
});
