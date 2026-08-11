import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptBundleResponse } from '../public/spatial/point-intelligence-bundle.js';
import {
  buildSafeEvidenceInspectorModel,
  buildSafeQueryReceiptInspectorModel,
  buildProviderIssueReceiptFixture,
  resolveReceiptForObservation
} from '../public/spatial/point-intelligence-inspector-model.js';
import {
  assertNoSecretsExposed,
  sanitizeEvidenceRecord,
  toSafeRawJson
} from '../public/spatial/point-intelligence-inspector-safe.js';
import {
  resetPointIntelligenceInspectorState,
  openEvidenceInspector,
  openReceiptInspector,
  getPointIntelligenceInspectorState,
  PI_INSPECTOR_MODE
} from '../public/spatial/point-intelligence-inspector-state.js';
import { renderEvidenceInspectorHtml, renderReceiptInspectorHtml } from '../public/spatial/point-intelligence-inspector-presentation.js';
import { getObservationId } from '../public/spatial/point-intelligence-map-presentation.js';

const MONTREAL = { longitude: -73.5673, latitude: 45.5017 };

const SAMPLE_BUNDLE = {
  bundleId: 'iqai.pi.bundle.test-phase3',
  orchestrationId: 'iqai.pi.bundleorch.test-phase3',
  bundleState: 'PARTIAL_RESULTS',
  plannerDecision: {
    selectionMode: 'AUTO',
    temporalIntent: { mode: 'LATEST' },
    eligible: [
      { informationFamily: 'weather', capabilityId: 'iqai.pi.candidate.weather', nativeId: 'swob-realtime' },
      { informationFamily: 'air-quality', capabilityId: 'iqai.pi.candidate.aq', nativeId: 'aqhi-observations-realtime' }
    ]
  },
  families: [
    {
      informationFamily: 'weather',
      status: 'SUCCESS',
      queryReceiptId: 'iqai.pi.qreceipt.weather-a',
      queryRequestId: 'iqai.pi.queryreq.weather-a',
      resultCount: 1,
      results: [{
        resultId: 'iqai.pi.result.weather-1',
        queryReceiptId: 'iqai.pi.qreceipt.weather-a',
        category: 'weather',
        providerName: 'MSC GeoMet',
        resultKind: 'DIRECT_MEASUREMENT',
        temporalClassification: 'NEAR_REAL_TIME',
        clickDistanceMeters: 993,
        geometry: { type: 'Point', coordinates: [-73.57, 45.50] },
        observation: { observedAt: '2026-08-10T03:41:00.000Z', value: 23.5, unit: 'C', property: 'air_temp' },
        retrievedAt: '2026-08-10T03:42:00.000Z',
        properties: { STATION_NUMBER: 'MCTAVISH' },
        provenance: { source: 'https://api.weather.gc.ca/collections/swob-realtime', queryReceiptId: 'iqai.pi.qreceipt.weather-a' }
      }]
    },
    {
      informationFamily: 'air-quality',
      status: 'NO_RESULTS',
      queryReceiptId: 'iqai.pi.qreceipt.aq-b',
      queryRequestId: 'iqai.pi.queryreq.aq-b',
      resultCount: 0,
      results: []
    }
  ],
  queryReceipts: [
    { informationFamily: 'weather', queryReceiptId: 'iqai.pi.qreceipt.weather-a', queryState: 'SUCCESS' },
    { informationFamily: 'air-quality', queryReceiptId: 'iqai.pi.qreceipt.aq-b', queryState: 'NO_RESULTS' }
  ],
  spatialSummary: {
    requestedGeometry: { type: 'Point', coordinates: [-73.5673, 45.5017] },
    radiusMeters: 3000,
    families: [
      {
        informationFamily: 'weather',
        spatialEligibility: {
          requestedRadiusMeters: 3000,
          providerResultsReceived: 5,
          excludedOutsideRadius: 2,
          resultsReturned: 1,
          predicate: 'CLICK_DISTANCE_METERS_LTE_RADIUS'
        }
      },
      {
        informationFamily: 'air-quality',
        spatialEligibility: {
          requestedRadiusMeters: 3000,
          providerResultsReceived: 0,
          resultsReturned: 0,
          predicate: 'CLICK_DISTANCE_METERS_LTE_RADIUS'
        }
      }
    ]
  },
  query: {
    geometry: { type: 'Point', coordinates: [-73.5673, 45.5017] },
    radiusMeters: 3000,
    temporalIntent: { mode: 'LATEST' }
  }
};

test('buildSafeEvidenceInspectorModel uses stable observation identity', () => {
  const adapted = adaptBundleResponse(SAMPLE_BUNDLE, MONTREAL, 1);
  const result = adapted.results[0];
  const model = buildSafeEvidenceInspectorModel(adapted, getObservationId(result));
  assert.equal(model.observationId, 'iqai.pi.result.weather-1');
  assert.equal(model.informationFamily, 'weather');
  assert.equal(model.provider.providerName, 'MSC GeoMet');
  assert.equal(model.spatial.coordinates, '45.50000, -73.57000');
  assert.match(model.spatial.distanceFromAnchor, /993 m/);
  assert.match(model.temporal.temporalClass, /Near real-time/i);
  assert.ok(model.measurements.some((m) => /23\.5/.test(m.value)));
});

test('buildSafeQueryReceiptInspectorModel uses governed bundle receipt fields', () => {
  const adapted = adaptBundleResponse(SAMPLE_BUNDLE, MONTREAL, 1);
  const receipt = buildSafeQueryReceiptInspectorModel(adapted, 'weather');
  assert.equal(receipt.queryReceiptId, 'iqai.pi.qreceipt.weather-a');
  assert.equal(receipt.informationFamily, 'weather');
  assert.equal(receipt.temporalIntent, 'LATEST');
  assert.equal(receipt.radiusMeters, 3000);
  assert.equal(receipt.spatialAccounting.resultsReturned, 1);
  assert.equal(receipt.governed, true);
});

test('distinct families expose distinct receipt IDs', () => {
  const adapted = adaptBundleResponse(SAMPLE_BUNDLE, MONTREAL, 1);
  const a = buildSafeQueryReceiptInspectorModel(adapted, 'weather');
  const b = buildSafeQueryReceiptInspectorModel(adapted, 'air-quality');
  assert.notEqual(a.queryReceiptId, b.queryReceiptId);
  assert.equal(b.resultCount, 0);
  assert.match(b.executionStatus, /no local evidence/i);
});

test('NO_RESULTS receipt proves execution without evidence language', () => {
  const adapted = adaptBundleResponse(SAMPLE_BUNDLE, MONTREAL, 1);
  const receipt = buildSafeQueryReceiptInspectorModel(adapted, 'air-quality');
  assert.equal(receipt.resultCount, 0);
  assert.match(receipt.executionStatus, /completed/i);
  assert.match(receipt.resultStatus, /No local evidence/i);
  assert.equal(receipt.spatialAccounting.providerResultsReceived, 0);
});

test('non-spatial evidence reports unavailable geometry', () => {
  const adapted = adaptBundleResponse({
    ...SAMPLE_BUNDLE,
    families: [{
      informationFamily: 'weather',
      status: 'SUCCESS',
      queryReceiptId: 'iqai.pi.qreceipt.ns',
      resultCount: 1,
      results: [{
        resultId: 'iqai.pi.result.ns-1',
        category: 'weather',
        providerName: 'test',
        properties: { note: 'metadata' }
      }]
    }]
  }, MONTREAL, 1);
  const model = buildSafeEvidenceInspectorModel(adapted, 'iqai.pi.result.ns-1');
  assert.equal(model.hasGeometry, false);
  assert.match(model.spatial.message, /No spatial geometry/i);
});

test('secret fields are redacted from inspector output', () => {
  const dirty = {
    resultId: 'iqai.pi.result.dirty',
    providerName: 'MSC GeoMet',
    authorization: 'Bearer evil-token',
    apiKey: 'secret-key',
    password: 'pw',
    properties: { STATION_NUMBER: '1', api_key: 'hidden' }
  };
  const sanitized = sanitizeEvidenceRecord(dirty);
  const html = renderEvidenceInspectorHtml(buildSafeEvidenceInspectorModel({
    results: [dirty],
    families: { weather: { results: [dirty], queryReceiptId: 'r1', queryState: 'SUCCESS', hasEvidence: true } }
  }, 'iqai.pi.result.dirty'));
  const raw = toSafeRawJson(sanitized);
  assert.equal(assertNoSecretsExposed(sanitized), true);
  assert.equal(assertNoSecretsExposed({ html, raw }), true);
  assert.doesNotMatch(raw, /evil-token|secret-key|hidden/);
  assert.doesNotMatch(html, /evil-token|secret-key|Bearer/i);
});

test('provider issue fixture is distinct from NO_RESULTS', () => {
  const issue = buildProviderIssueReceiptFixture();
  const adapted = adaptBundleResponse(SAMPLE_BUNDLE, MONTREAL, 1);
  const noResults = buildSafeQueryReceiptInspectorModel(adapted, 'air-quality');
  assert.match(issue.executionStatus, /Provider issue/i);
  assert.match(noResults.resultStatus, /No local evidence/i);
  assert.equal(assertNoSecretsExposed(issue), true);
});

test('evidence resolves to matching family receipt', () => {
  const adapted = adaptBundleResponse(SAMPLE_BUNDLE, MONTREAL, 1);
  const receipt = resolveReceiptForObservation(adapted, 'iqai.pi.result.weather-1');
  assert.equal(receipt.queryReceiptId, 'iqai.pi.qreceipt.weather-a');
  assert.equal(receipt.informationFamily, 'weather');
});

test('inspector state resets on new generation', () => {
  resetPointIntelligenceInspectorState(1);
  openEvidenceInspector('iqai.pi.result.weather-1', 'weather', 1);
  resetPointIntelligenceInspectorState(2);
  assert.equal(getPointIntelligenceInspectorState().mode, PI_INSPECTOR_MODE.CLOSED);
});

test('receipt inspector html includes technical details collapsed', () => {
  const adapted = adaptBundleResponse(SAMPLE_BUNDLE, MONTREAL, 1);
  const html = renderReceiptInspectorHtml(buildSafeQueryReceiptInspectorModel(adapted, 'weather'));
  assert.match(html, /Query receipt/);
  assert.match(html, /True-radius accounting/);
  assert.match(html, /Technical details|Raw receipt/);
});

test('scale fixture preserves compact primary presentation contract', () => {
  const adapted = adaptBundleResponse(SAMPLE_BUNDLE, MONTREAL, 1);
  const html = renderEvidenceInspectorHtml(buildSafeEvidenceInspectorModel(adapted, 'iqai.pi.result.weather-1'));
  assert.ok(html.length < 20000);
  assert.doesNotMatch(html, /apiKey|password|secret/i);
});
