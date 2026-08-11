import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {
  buildPointIntelligenceBrokerBundleRequest,
  queryPointIntelligenceBundleBroker
} from '../src/spatial/point-intelligence-broker-client.js';
import {
  registerAgent1SpatialRoutes,
  POINT_INTELLIGENCE_QUERY_BUNDLE_PATH,
  isPointIntelligenceBundleRouteRegistered,
  arePointIntelligenceRoutesRegistered
} from '../src/spatial/agent1-spatial-routes.js';
import {
  buildPointIntelligenceBundleRequest,
  queryPointIntelligenceBundle
} from '../public/spatial/point-intelligence-request.js';
import {
  adaptBundleResponse,
  formatRelationshipFacts,
  isBundleResponse
} from '../public/spatial/point-intelligence-bundle.js';
import {
  buildPointIntelligenceSummaryHtml
} from '../public/spatial/point-intelligence-presentation.js';
import { isMultiFamilyPointIntelligenceResponse } from '../public/spatial/point-intelligence-multifamily.js';

const MONTREAL = { longitude: -73.5673, latitude: 45.5017 };

const SAMPLE_BUNDLE = {
  bundleId: 'iqai.pi.bundle.test-001',
  orchestrationId: 'iqai.pi.orchestration.test-001',
  bundleState: 'PARTIAL_RESULTS',
  plannerDecision: {
    selectionMode: 'AUTO',
    temporalIntent: { mode: 'LATEST' },
    selectedCapabilities: [
      'hydrometric-stations',
      'climate-daily',
      'swob-realtime'
    ]
  },
  families: [
    {
      informationFamily: 'hydrometric',
      status: 'SUCCESS',
      queryReceiptId: 'iqai.pi.qreceipt.hydrometric',
      resultCount: 1,
      temporalClassification: 'STATIC',
      results: [{
        category: 'hydrometric',
        providerName: 'MSC GeoMet',
        nativeRecordId: '02OA047',
        clickDistanceMeters: 1200,
        temporalClassification: 'STATIC',
        properties: { STATION_NAME: 'Test Station' },
        geometry: { type: 'Point', coordinates: [-73.56, 45.50] }
      }]
    },
    {
      informationFamily: 'weather',
      status: 'NO_RESULTS',
      queryReceiptId: 'iqai.pi.qreceipt.weather',
      resultCount: 0,
      results: []
    }
  ],
  queryReceipts: [
    { queryReceiptId: 'iqai.pi.qreceipt.hydrometric' },
    { queryReceiptId: 'iqai.pi.qreceipt.weather' }
  ],
  relationships: {
    familyAvailability: { requested: 7, withResults: 1 },
    observationAgePerFamily: { weather: { seconds: 720 } },
    nearestObservationPerFamily: { hydrometric: { clickDistanceMeters: 1200 } }
  }
};

test('broker bundle request accepts AUTO + LATEST only', () => {
  const built = buildPointIntelligenceBrokerBundleRequest({
    geometry: { type: 'Point', coordinates: [-73.5673, 45.5017] },
    radiusMeters: 3000,
    informationFamilies: 'AUTO',
    temporalIntent: { mode: 'LATEST' }
  });
  assert.equal(built.ok, true);
  assert.equal(built.value.informationFamilies, 'AUTO');
  assert.equal(built.value.temporalIntent.mode, 'LATEST');
});

test('broker bundle request rejects arbitrary authority fields', () => {
  for (const field of ['url', 'capabilityId', 'verified', 'provider']) {
    const built = buildPointIntelligenceBrokerBundleRequest({
      geometry: { type: 'Point', coordinates: [-73.5, 45.5] },
      [field]: 'evil'
    });
    assert.equal(built.ok, false, field);
  }
});

test('broker bundle request rejects non-AUTO informationFamilies', () => {
  const built = buildPointIntelligenceBrokerBundleRequest({
    geometry: { type: 'Point', coordinates: [-73.5, 45.5] },
    informationFamilies: 'weather'
  });
  assert.equal(built.ok, false);
});

test('broker bundle request rejects RANGE temporal mode', () => {
  const built = buildPointIntelligenceBrokerBundleRequest({
    geometry: { type: 'Point', coordinates: [-73.5, 45.5] },
    temporalIntent: { mode: 'RANGE', start: '2020-01-01', end: '2020-12-31' }
  });
  assert.equal(built.ok, false);
});

test('registerAgent1SpatialRoutes mounts bundle route', () => {
  const app = express();
  registerAgent1SpatialRoutes(app);
  assert.equal(isPointIntelligenceBundleRouteRegistered(app), true);
  assert.equal(arePointIntelligenceRoutesRegistered(app), true);
});

test('browser bundle request builder mirrors governed contract', () => {
  const built = buildPointIntelligenceBundleRequest({
    geometry: { type: 'Point', coordinates: [-73.5673, 45.5017] },
    radiusMeters: 3000
  });
  assert.equal(built.ok, true);
  assert.equal(built.payload.informationFamilies, 'AUTO');
  assert.equal(built.payload.temporalIntent.mode, 'LATEST');
  assert.equal(built.payload.geometry.coordinates[0], -73.5673);
});

test('adaptBundleResponse preserves separate family receipts and statuses', () => {
  const adapted = adaptBundleResponse(SAMPLE_BUNDLE, MONTREAL, 7);
  assert.equal(isBundleResponse(adapted), true);
  assert.equal(isMultiFamilyPointIntelligenceResponse(adapted), true);
  assert.equal(adapted.bundleId, 'iqai.pi.bundle.test-001');
  assert.equal(adapted.bundleState, 'PARTIAL_RESULTS');
  assert.equal(adapted.families.hydrometric.hasEvidence, true);
  assert.equal(adapted.families.weather.hasEvidence, false);
  assert.equal(adapted.families.hydrometric.queryReceiptId, 'iqai.pi.qreceipt.hydrometric');
  assert.equal(adapted.families.weather.queryState, 'NO_RESULTS');
  assert.equal(adapted.results.length, 1);
  assert.equal(adapted.plannerDecision.selectionMode, 'AUTO');
});

test('formatRelationshipFacts emits facts without causal narrative', () => {
  const facts = formatRelationshipFacts(SAMPLE_BUNDLE.relationships);
  assert.ok(facts.some((fact) => /1 of 7 families returned evidence/.test(fact)));
  assert.ok(facts.some((fact) => /weather observation: 12 min old/.test(fact)));
  assert.ok(facts.some((fact) => /Nearest hydrometric: 1\.20 km/.test(fact)));
  assert.equal(facts.some((fact) => /caused/i.test(fact)), false);
});

test('grouped bundle presentation shows LIF hierarchy with evidence vs gaps', () => {
  const adapted = adaptBundleResponse(SAMPLE_BUNDLE, MONTREAL, 7);
  adapted.request = { geometry: { coordinates: [MONTREAL.longitude, MONTREAL.latitude] }, radiusMeters: 3000 };
  const html = buildPointIntelligenceSummaryHtml({
    point: MONTREAL,
    response: adapted,
    presentation: { state: adapted.bundleState, message: '1 of 2 information families returned local evidence.' }
  });
  assert.match(html, /Point Intelligence/);
  assert.match(html, /of \d+ information families returned local evidence/);
  assert.match(html, /Coverage/);
  assert.match(html, /No local evidence/i);
  assert.match(html, /iqai\.pi\.qreceipt\.hydrometric/);
  assert.match(html, /Location facts/);
  assert.doesNotMatch(html, /\bLIVE\b/i);
  assert.doesNotMatch(html, /iqai\.pi\.bundle\.test-001/);
});

test('queryPointIntelligenceBundleBroker targets governed Agent 5 bundle endpoint', async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = '';
  globalThis.fetch = async (url, init) => {
    capturedUrl = String(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({ bundleState: 'SUCCESS', families: [] })
    };
  };
  try {
    await queryPointIntelligenceBundleBroker({
      geometry: { type: 'Point', coordinates: [-73.5, 45.5] },
      informationFamilies: 'AUTO',
      temporalIntent: { mode: 'LATEST' }
    }, { brokerUrl: 'http://127.0.0.1:3027' });
    assert.equal(capturedUrl, 'http://127.0.0.1:3027/v1/point-intelligence/query-bundle');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('browser queryPointIntelligenceBundle uses product proxy path', async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = '';
  globalThis.fetch = async (url) => {
    capturedUrl = String(url);
    return {
      json: async () => SAMPLE_BUNDLE
    };
  };
  try {
    await queryPointIntelligenceBundle({
      geometry: { type: 'Point', coordinates: [-73.5673, 45.5017] },
      radiusMeters: 3000
    });
    assert.equal(capturedUrl, '/api/spatial/point-intelligence/query-bundle');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
