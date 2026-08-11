import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatClickDistance,
  formatClimateObservationDate,
  buildHydrometricPresentation,
  buildClimatePresentation,
  buildPointIntelligenceResultPresentation,
  buildPointIntelligenceSummaryHtml,
  buildFamilyEvidencePreview,
  groupResultsByAuthoritativeStation,
  stationLabelFromNativeRecordId
} from '../public/spatial/point-intelligence-presentation.js';

test('formatClickDistance renders meters and kilometers', () => {
  assert.equal(formatClickDistance(84), '84 m');
  assert.equal(formatClickDistance(1280), '1.28 km');
  assert.equal(formatClickDistance(3000), '3.00 km');
  assert.equal(formatClickDistance(null), null);
});

test('hydrometric presentation prioritizes station name and honesty label', () => {
  const card = buildHydrometricPresentation({
    nativeRecordId: '02OA047',
    providerName: 'MSC GeoMet',
    clickDistanceMeters: 1280,
    properties: {
      STATION_NAME: 'Saint-Laurent (Fleuve) au quai de la rue Frontenac',
      STATION_NUMBER: '02OA047',
      STATUS_EN: 'Active',
      CONTRIBUTOR_EN: 'Environment and Climate Change Canada',
      DRAINAGE_AREA_GROSS: 500000000,
      REAL_TIME: 1
    }
  });
  assert.equal(card.title, 'Saint-Laurent (Fleuve) au quai de la rue Frontenac');
  assert.equal(card.honestyLabel, 'Hydrometric station registry');
  assert.match(card.footnote, /No water-level or flow observation/);
  assert.ok(card.lines.some((line) => line.includes('Station 02OA047')));
  assert.ok(card.lines.some((line) => line.includes('1.28 km away')));
  assert.ok(card.lines.some((line) => line.includes('Status: Active')));
  assert.ok(card.lines.some((line) => line.includes('Contributor:')));
  assert.ok(card.lines.some((line) => line.includes('Drainage area:')));
  assert.ok(card.lines.some((line) => line.includes('registry metadata only')));
  assert.equal(card.nativeRecordId, '02OA047');
});

test('climate presentation shows date, temperatures, and distance', () => {
  const card = buildClimatePresentation({
    nativeRecordId: '7025267.2026.8.9',
    providerName: 'MSC GeoMet',
    clickDistanceMeters: 1660,
    category: 'climate',
    properties: {
      STATION_NAME: 'Montreal Lafontaine',
      LOCAL_DATE: '2026-08-09 00:00:00',
      MIN_TEMPERATURE: 17.8,
      MEAN_TEMPERATURE: 22.4,
      MAX_TEMPERATURE: 26.9,
      TOTAL_PRECIPITATION: 2.2,
      TOTAL_RAIN: 2.2,
      TOTAL_SNOW: 0
    },
    temporal: { LOCAL_DATE: '2026-08-09 00:00:00' }
  });
  assert.equal(card.title, 'Montreal Lafontaine');
  assert.equal(card.observationDate, 'Aug 9, 2026');
  assert.ok(card.lines.some((line) => line.includes('Mean: 22.4 °C')));
  assert.ok(card.lines.some((line) => line.includes('Min: 17.8 °C')));
  assert.ok(card.lines.some((line) => line.includes('Max: 26.9 °C')));
  assert.ok(card.lines.some((line) => line.includes('Precipitation: 2.2 mm')));
  assert.ok(card.lines.some((line) => line.includes('Rain: 2.2 mm')));
  assert.ok(card.lines.some((line) => line.includes('Snow: 0 cm')));
  assert.ok(card.lines.some((line) => line.includes('1.66 km away')));
  assert.equal(card.honestyLabel, 'Historical');
  assert.equal(card.nativeRecordId, '7025267.2026.8.9');
});

test('climate presentation omits null measurements', () => {
  const card = buildClimatePresentation({
    providerName: 'MSC GeoMet',
    category: 'climate',
    properties: {
      STATION_NAME: 'Montreal Lafontaine',
      LOCAL_DATE: '2026-08-09 00:00:00',
      MEAN_TEMPERATURE: 22.4
    }
  });
  assert.ok(card.lines.some((line) => line.includes('Mean: 22.4 °C')));
  assert.ok(!card.lines.some((line) => /Precipitation|Rain|Snow|Min:|Max:/.test(line)));
});

test('summary html prioritizes station evidence over technical ids', () => {
  const html = buildPointIntelligenceSummaryHtml({
    point: { latitude: 45.5017, longitude: -73.5673 },
    response: {
      queryState: 'SUCCESS',
      queryReceiptId: 'qreceipt-test',
      resultCount: 1,
      summary: {
        informationFamily: 'hydrometric',
        resultCount: 1,
        providerName: 'MSC GeoMet',
        queryReceiptId: 'qreceipt-test'
      },
      results: [{
        nativeRecordId: '02OA047',
        providerName: 'MSC GeoMet',
        clickDistanceMeters: 1280,
        category: 'hydrometric',
        properties: {
          STATION_NAME: 'Saint-Laurent (Fleuve) au quai de la rue Frontenac',
          STATION_NUMBER: '02OA047',
          STATUS_EN: 'Active'
        }
      }]
    },
    presentation: { state: 'SUCCESS', message: '1 hydrometric station found.' }
  });
  assert.match(html, /Point Intelligence/);
  assert.match(html, /Saint-Laurent \(Fleuve\) au quai de la rue Frontenac/);
  assert.match(html, /Hydrometric station registry/);
  assert.match(html, /1\.28 km away/);
  assert.match(html, /Inspect evidence/);
  assert.match(html, /Query receipt/);
  assert.match(html, /qreceipt-test/);
  assert.doesNotMatch(html, /Native record:/);
  assert.doesNotMatch(html, /\b(LIVE|CURRENT WEATHER|NOW)\b/i);
});

test('buildPointIntelligenceResultPresentation routes by family', () => {
  const hydrometric = buildPointIntelligenceResultPresentation({
    category: 'hydrometric',
    properties: { STATION_NAME: 'Test Station' }
  }, 'hydrometric');
  assert.equal(hydrometric.family, 'hydrometric');

  const climate = buildPointIntelligenceResultPresentation({
    category: 'climate',
    properties: { STATION_NAME: 'Climate Station', LOCAL_DATE: '2026-01-01 00:00:00' }
  }, 'climate');
  assert.equal(climate.family, 'climate');
});

test('formatClimateObservationDate handles ISO-like local dates', () => {
  assert.equal(formatClimateObservationDate('2026-08-09 00:00:00'), 'Aug 9, 2026');
});

test('stationLabelFromNativeRecordId shortens climate technical ids', () => {
  assert.equal(stationLabelFromNativeRecordId('7025267.1971.1', 'climate'), 'Station 7025267');
});

test('buildFamilyEvidencePreview surfaces station and measurement', () => {
  const preview = buildFamilyEvidencePreview({
    informationFamily: 'climate',
    coverageState: 'EVIDENCE',
    hasEvidence: true,
    results: [{
      nativeRecordId: '7025267.2026.8.9',
      clickDistanceMeters: 1700,
      category: 'climate',
      properties: {
        STATION_NAME: 'MCTAVISH',
        LOCAL_DATE: '2026-08-09 00:00:00',
        MEAN_TEMPERATURE: 22.1
      }
    }]
  }, 3000);
  assert.equal(preview.station, 'MCTAVISH');
  assert.equal(preview.measurement, '22.1 °C');
  assert.match(preview.distance, /1\.70 km away/);
});

test('groupResultsByAuthoritativeStation groups shared station ids', () => {
  const groups = groupResultsByAuthoritativeStation([
    {
      nativeRecordId: '7025267.2026.8.8',
      properties: { STATION_NAME: 'MCTAVISH', STATION_NUMBER: '7025267', MEAN_TEMPERATURE: 20.8 }
    },
    {
      nativeRecordId: '7025267.2026.8.9',
      properties: { STATION_NAME: 'MCTAVISH', STATION_NUMBER: '7025267', MEAN_TEMPERATURE: 22.1 }
    }
  ], 'climate');
  assert.equal(groups.length, 1);
  assert.equal(groups[0].results.length, 2);
  assert.equal(groups[0].title, 'MCTAVISH');
});
