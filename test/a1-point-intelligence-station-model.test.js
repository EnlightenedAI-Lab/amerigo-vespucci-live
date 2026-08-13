import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProofStationRecords,
  computeDeterministicTrend,
  formatProofHoverModel,
  FRESHNESS_CLASS,
  FRESHNESS_POLICY,
  proofStationAssetKey
} from '../public/spatial/point-intelligence-station-model.js';
import {
  buildHydrometricCimSymbol,
  buildProofStationRenderer,
  buildWeatherCimSymbol
} from '../public/spatial/point-intelligence-station-symbols.js';

const NOW = Date.parse('2026-08-13T17:30:00Z');

function hydroRegistry() {
  return {
    resultId: 'reg-1',
    category: 'hydrometric',
    resultKind: 'STATION_REGISTRY',
    providerName: 'MSC GeoMet',
    nativeCollectionId: 'hydrometric-stations',
    nativeRecordId: '02OA016',
    clickDistanceMeters: 1200,
    geometry: { type: 'Point', coordinates: [-73.62316, 45.41501] },
    properties: {
      STATION_NUMBER: '02OA016',
      STATION_NAME: 'SAINT-LAURENT (FLEUVE) A LASALLE'
    }
  };
}

function hydroMeasurement(overrides = {}) {
  return {
    resultId: 'meas-1',
    category: 'hydrometric-measurement',
    resultKind: 'DIRECT_MEASUREMENT',
    providerName: 'MSC GeoMet',
    nativeCollectionId: 'hydrometric-realtime',
    nativeRecordId: '02OA016.2026-08-13T16:30:00Z',
    clickDistanceMeters: 1200,
    geometry: { type: 'Point', coordinates: [-73.62316, 45.41501] },
    observation: { property: 'LEVEL', value: 1.29, unit: 'm', observedAt: '2026-08-13T16:30:00Z' },
    temporal: { DATETIME: '2026-08-13T16:30:00Z' },
    properties: { STATION_NUMBER: '02OA016', STATION_NAME: 'SAINT-LAURENT (FLEUVE) A LASALLE', LEVEL: 1.29 },
    ...overrides
  };
}

function swob(id, minutesAgo, extras = {}) {
  const observedAt = new Date(NOW - minutesAgo * 60000).toISOString();
  return {
    resultId: `swob-${id}-${minutesAgo}`,
    category: 'weather',
    resultKind: 'DIRECT_MEASUREMENT',
    providerName: 'MSC GeoMet',
    nativeCollectionId: 'swob-realtime',
    nativeRecordId: `2026-08-13-${id}-${minutesAgo}-swob.xml`,
    clickDistanceMeters: 900,
    geometry: { type: 'Point', coordinates: [-73.579185, 45.504926] },
    observation: { property: 'air_temp', value: 24.2, unit: '°C', observedAt },
    temporal: { 'date_tm-value': observedAt },
    properties: {
      'tc_id-value': 'CWTA',
      'stn_nam-value': 'MCTAVISH',
      'air_temp-value': 24.2,
      ...extras
    }
  };
}

test('hydrometric registry and measurement collapse to one station object', () => {
  const records = buildProofStationRecords([
    hydroRegistry(),
    hydroMeasurement(),
    hydroMeasurement({
      resultId: 'meas-2',
      nativeRecordId: '02OA016.2026-08-13T16:45:00Z',
      observation: { property: 'LEVEL', value: 1.31, unit: 'm', observedAt: '2026-08-13T16:45:00Z' },
      temporal: { DATETIME: '2026-08-13T16:45:00Z' }
    })
  ], { nowMs: NOW });
  assert.equal(records.length, 1);
  assert.equal(records[0].family, 'hydrometric');
  assert.equal(records[0].stationId, '02OA016');
  assert.equal(records[0].primaryLabel, 'WATER LEVEL');
  assert.equal(records[0].primaryValue, 1.31);
  assert.equal(records[0].primaryUnit, 'm');
  assert.equal(records[0].observationIds.length, 3);
});

test('SWOB observations from the same persistent station collapse', () => {
  const records = buildProofStationRecords([
    swob('a', 2),
    swob('b', 3),
    swob('c', 4)
  ], { nowMs: NOW });
  assert.equal(records.length, 1);
  assert.equal(records[0].family, 'weather');
  assert.equal(records[0].stationId, 'CWTA');
  assert.equal(records[0].primaryLabel, 'TEMPERATURE');
  assert.equal(records[0].freshnessClass, FRESHNESS_CLASS.CURRENT);
});

test('climate and citypage are not proof station objects', () => {
  const records = buildProofStationRecords([
    hydroRegistry(),
    {
      resultId: 'clim',
      category: 'climate',
      geometry: { type: 'Point', coordinates: [-73.58, 45.50] },
      properties: { CLIMATE_IDENTIFIER: '7024745', STATION_NAME: 'MCTAVISH' }
    },
    {
      resultId: 'city',
      category: 'weather-current',
      geometry: { type: 'Point', coordinates: [-73.55, 45.51] },
      properties: { name: { en: 'Montréal' } }
    }
  ], { nowMs: NOW });
  assert.equal(records.length, 1);
  assert.equal(records[0].family, 'hydrometric');
});

test('freshness uses family-specific cadences', () => {
  const weatherStale = buildProofStationRecords([swob('s', 90)], { nowMs: NOW });
  assert.equal(weatherStale[0].freshnessClass, FRESHNESS_CLASS.STALE);
  const hydroRecent = buildProofStationRecords([hydroMeasurement()], { nowMs: NOW });
  assert.equal(hydroRecent[0].freshnessClass, FRESHNESS_CLASS.RECENT);
  assert.ok(FRESHNESS_POLICY.weather.currentSeconds < FRESHNESS_POLICY.hydrometric.currentSeconds);
});

test('registry-only hydrometric is not styled as live', () => {
  const records = buildProofStationRecords([hydroRegistry()], { nowMs: NOW });
  assert.equal(records[0].freshnessClass, FRESHNESS_CLASS.REGISTRY);
  assert.equal(records[0].primaryValue, null);
});

test('trend is computed only from chronological same-property observations', () => {
  const trend = computeDeterministicTrend([
    { t: NOW - 3600000, v: 1.22, unit: 'm', property: 'LEVEL' },
    { t: NOW, v: 1.29, unit: 'm', property: 'LEVEL' }
  ]);
  assert.equal(trend.delta.toFixed(2), '0.07');
  assert.equal(trend.unit, 'm');
  assert.equal(computeDeterministicTrend([{ t: NOW, v: 1.29, unit: 'm' }]), null);
});

test('hover omits invented wind, quality, and trend', () => {
  const [record] = buildProofStationRecords([swob('h', 3)], { nowMs: NOW });
  const hover = formatProofHoverModel(record);
  assert.equal(hover.title, 'CWTA');
  assert.match(hover.lines.join('\n'), /TEMPERATURE/);
  assert.doesNotMatch(hover.lines.join('\n'), /WIND|TREND|QUALITY|air_temp/i);
  assert.equal(record.qualityState, null);
});

test('single hydrometric measurement does not invent trend', () => {
  const [record] = buildProofStationRecords([hydroRegistry(), hydroMeasurement()], { nowMs: NOW });
  assert.equal(record.trend, null);
  const hover = formatProofHoverModel(record);
  assert.doesNotMatch(hover.lines.join('\n'), /TREND/);
});

test('level and discharge are not combined into one magnitude', () => {
  const records = buildProofStationRecords([
    hydroMeasurement(),
    hydroMeasurement({
      resultId: 'dis-1',
      nativeRecordId: '02OA016.discharge',
      observation: { property: 'DISCHARGE', value: 2400, unit: 'm3/s', observedAt: '2026-08-13T16:30:00Z' },
      properties: { STATION_NUMBER: '02OA016', DISCHARGE: 2400 }
    })
  ], { nowMs: NOW });
  assert.equal(records.length, 1);
  assert.equal(records[0].primaryLabel, 'WATER LEVEL');
  assert.equal(records[0].primaryUnit, 'm');
  assert.notEqual(records[0].primaryUnit, 'm³/s');
  assert.ok(records[0].primaryValue < 10);
});

test('weather direction is omitted unless a direction value exists', () => {
  const [speedOnly] = buildProofStationRecords([swob('spd', 2, {
    'wind_spd_scal-value': 18
  })], { nowMs: NOW });
  const hover = formatProofHoverModel(speedOnly);
  const windLine = hover.lines.find((line) => line.startsWith('WIND')) || '';
  assert.equal(windLine, 'WIND 18 km/h');
  assert.doesNotMatch(windLine, /°/);
});

test('hover includes wind only when direction or speed exists', () => {
  const [record] = buildProofStationRecords([swob('w', 3, {
    'wind_spd_scal-value': 18,
    'wind_dir_10_min-value': 210
  })], { nowMs: NOW });
  const hover = formatProofHoverModel(record);
  assert.match(hover.lines.join('\n'), /WIND 210° · 18 km\/h/);
});

test('SWOB native observation ids are not used as station identity', () => {
  const key = proofStationAssetKey(swob('x', 1));
  assert.equal(key, 'swob:CWTA');
  assert.doesNotMatch(key, /swob\.xml/);
});

test('CIM symbols are static multilayer point references', () => {
  const hydro = buildHydrometricCimSymbol(FRESHNESS_CLASS.CURRENT);
  const weather = buildWeatherCimSymbol(FRESHNESS_CLASS.CURRENT);
  assert.equal(hydro.type, 'cim');
  assert.equal(weather.data.symbol.type, 'CIMPointSymbol');
  assert.equal(hydro.data.symbol.animations, undefined);
  const renderer = buildProofStationRenderer();
  assert.equal(renderer.type, 'unique-value');
  assert.equal(renderer.field, 'rendererKey');
  assert.ok(renderer.uniqueValueInfos.some((info) => info.value === 'hydrometric-CURRENT'));
  assert.ok(renderer.uniqueValueInfos.some((info) => info.value === 'weather-STALE'));
});
