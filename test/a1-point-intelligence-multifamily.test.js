import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPointIntelligenceBrokerRequest
} from '../src/spatial/point-intelligence-broker-client.js';
import {
  POINT_INTELLIGENCE_FAMILY_ORDER,
  isVerifiedPointIntelligenceFamily
} from '../public/spatial/point-intelligence-config.js';
import {
  buildMultiFamilyResponse,
  deriveMultiFamilyQueryState,
  isMultiFamilyPointIntelligenceResponse
} from '../public/spatial/point-intelligence-multifamily.js';
import {
  summarizePointIntelligenceResponse,
  formatTemporalClassificationLabel
} from '../public/spatial/point-intelligence-status.js';
import {
  buildWeatherPresentation,
  buildHydrometricMeasurementPresentation
} from '../public/spatial/point-intelligence-presentation.js';

test('broker accepts all verified V2 information families', () => {
  for (const family of POINT_INTELLIGENCE_FAMILY_ORDER) {
    const built = buildPointIntelligenceBrokerRequest({
      geometry: { type: 'Point', coordinates: [-73.5673, 45.5017] },
      radiusMeters: 3000,
      informationFamily: family
    });
    assert.equal(built.ok, true, family);
    assert.equal(built.value.informationFamily, family);
  }
});

test('isVerifiedPointIntelligenceFamily recognizes V2 keys', () => {
  assert.equal(isVerifiedPointIntelligenceFamily('weather'), true);
  assert.equal(isVerifiedPointIntelligenceFamily('hydrometric-measurement'), true);
  assert.equal(isVerifiedPointIntelligenceFamily('marine'), false);
});

test('buildMultiFamilyResponse merges family evidence without fabrication', () => {
  const point = { longitude: -73.5673, latitude: 45.5017 };
  const merged = buildMultiFamilyResponse(point, ['hydrometric', 'weather'], [
    {
      queryState: 'SUCCESS',
      queryReceiptId: 'receipt-h',
      resultCount: 1,
      results: [{
        category: 'hydrometric',
        providerName: 'MSC GeoMet',
        nativeRecordId: '02OA047',
        properties: { STATION_NAME: 'Test Station' },
        geometry: { type: 'Point', coordinates: [-73.5, 45.5] }
      }]
    },
    {
      queryState: 'NO_RESULTS',
      queryReceiptId: 'receipt-w',
      resultCount: 0,
      results: []
    }
  ], 41);

  assert.equal(isMultiFamilyPointIntelligenceResponse(merged), true);
  assert.equal(merged.familiesWithEvidence, 1);
  assert.equal(merged.results.length, 1);
  assert.equal(merged.families.hydrometric.hasEvidence, true);
  assert.equal(merged.families.weather.hasEvidence, false);
  assert.equal(deriveMultiFamilyQueryState(merged.families), 'SUCCESS');
});

test('multi-family summary preserves per-family receipts', () => {
  const summary = summarizePointIntelligenceResponse({
    multiFamily: true,
    queryState: 'SUCCESS',
    familiesWithEvidence: 2,
    resultCount: 2,
    results: [],
    families: {
      hydrometric: {
        queryState: 'SUCCESS',
        hasEvidence: true,
        resultCount: 1,
        queryReceiptId: 'r1',
        results: [{ providerName: 'MSC GeoMet' }]
      },
      weather: {
        queryState: 'SUCCESS',
        hasEvidence: true,
        resultCount: 1,
        queryReceiptId: 'r2',
        results: [{ providerName: 'MSC GeoMet' }]
      }
    }
  });
  assert.equal(summary.familiesWithEvidence, 2);
  assert.deepEqual(summary.queryReceiptIds, ['r2', 'r1']);
});

test('weather presentation uses normalized observation evidence', () => {
  const card = buildWeatherPresentation({
    category: 'weather',
    providerName: 'MSC GeoMet',
    temporalClassification: 'NEAR_REAL_TIME',
    clickDistanceMeters: 420,
    observation: { property: 'air_temp', value: 12.4, unit: 'C', observedAt: '2026-08-09T18:00:00Z' },
    properties: { 'station-name-value': 'Montreal Airport' }
  });
  assert.equal(card.title, 'Montreal Airport');
  assert.ok(card.lines.some((line) => line.includes('12.4 °C')));
  assert.equal(card.honestyLabel, 'Near real-time observation');
  assert.equal(formatTemporalClassificationLabel('NEAR_REAL_TIME'), 'Near real-time observation');
});

test('hydrometric measurement presentation is distinct from station registry', () => {
  const card = buildHydrometricMeasurementPresentation({
    category: 'hydrometric-measurement',
    providerName: 'MSC GeoMet',
    temporalClassification: 'NEAR_REAL_TIME',
    observation: { property: 'LEVEL', value: 1.34, unit: 'm', observedAt: '2026-08-09T18:00:00Z' },
    properties: { STATION_NAME: 'Test River', WATERBODY_EN: 'Test River' }
  });
  assert.equal(card.honestyLabel, 'Near real-time observation');
  assert.ok(card.lines.some((line) => /Water level: 1\.3 m/.test(line)));
  assert.notEqual(card.honestyLabel, 'Hydrometric station registry');
});
