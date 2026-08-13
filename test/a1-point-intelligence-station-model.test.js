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
  PI_LOCAL_INSTRUMENT_MIN_SCALE,
  buildAirQualityCimSymbol,
  buildClimateCimSymbol,
  buildHydrometricCimSymbol,
  buildProofStationRenderer,
  buildRegionalFireflyCimSymbol,
  buildWeatherCimSymbol,
  buildWeatherCurrentCimSymbol
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

test('climate, citypage, and AQHI are mapped as station objects', () => {
  const records = buildProofStationRecords([
    hydroRegistry(),
    {
      resultId: 'clim',
      category: 'climate',
      clickDistanceMeters: 800,
      geometry: { type: 'Point', coordinates: [-73.58, 45.50] },
      observation: { property: 'MEAN_TEMPERATURE', value: 18.2, unit: 'C', observedAt: '2026-08-12' },
      properties: { CLIMATE_IDENTIFIER: '7025251', STATION_NAME: 'MONTREAL/PIERRE ELLIOTT TRUDEAU INTL' }
    },
    {
      resultId: 'city',
      category: 'weather-current',
      clickDistanceMeters: 1400,
      geometry: { type: 'Point', coordinates: [-73.55, 45.51] },
      observation: { property: 'temperature', value: 14.4, unit: 'C', observedAt: '2026-08-13T17:00:00Z' },
      properties: { name: { en: 'Montréal' } }
    },
    {
      resultId: 'aqhi',
      category: 'air-quality',
      clickDistanceMeters: 9000,
      geometry: { type: 'Point', coordinates: [-73.54, 45.55] },
      observation: { property: 'aqhi', value: 3, unit: 'AQHI', observedAt: '2026-08-13T17:00:00Z' },
      properties: { location_name_en: 'Montreal', aqhi: 3 }
    }
  ], { nowMs: NOW });
  assert.equal(records.length, 4);
  assert.equal(records.filter((row) => row.family === 'hydrometric').length, 1);
  assert.equal(records.filter((row) => row.family === 'climate').length, 1);
  assert.equal(records.filter((row) => row.family === 'weather-current').length, 1);
  assert.equal(records.filter((row) => row.family === 'air-quality').length, 1);
});

test('weather and climate at the same physical site collapse to one station with channels', () => {
  const records = buildProofStationRecords([
    swob('a', 2),
    {
      resultId: 'clim-hourly',
      category: 'climate-hourly',
      clickDistanceMeters: 900,
      geometry: { type: 'Point', coordinates: [-73.579185, 45.504926] },
      observation: { property: 'TEMP', value: 24.1, unit: 'C', observedAt: '2026-08-13T17:00:00Z' },
      properties: { CLIMATE_IDENTIFIER: '7024745', STATION_NAME: 'MCTAVISH', TEMP: 24.1 }
    },
    {
      resultId: 'clim-daily',
      category: 'climate',
      clickDistanceMeters: 900,
      geometry: { type: 'Point', coordinates: [-73.579185, 45.504926] },
      observation: { property: 'MEAN_TEMPERATURE', value: 18.4, unit: 'C', observedAt: '2026-08-12' },
      properties: { CLIMATE_IDENTIFIER: '7024745', STATION_NAME: 'MCTAVISH', MEAN_TEMPERATURE: 18.4 }
    }
  ], { nowMs: NOW });
  assert.equal(records.length, 1);
  assert.equal(records[0].family, 'weather');
  const families = records[0].channels.map((channel) => channel.family);
  assert.deepEqual(families, ['weather', 'climate-hourly', 'climate']);
  const hover = formatProofHoverModel(records[0]);
  assert.equal(hover.familyLabel, 'WEATHER / CLIMATE STATION');
  assert.match(hover.lines.join('\n'), /SWOB WEATHER/);
  assert.match(hover.lines.join('\n'), /CLIMATE HOURLY/);
  assert.match(hover.lines.join('\n'), /CLIMATE DAILY/);
});

test('coincident citypage places collapse to one map object', () => {
  const records = buildProofStationRecords([
    {
      resultId: 'city-a',
      category: 'weather-current',
      clickDistanceMeters: 10198,
      geometry: { type: 'Point', coordinates: [-73.57, 45.41] },
      observation: { property: 'temperature', value: 22.8, unit: 'C', observedAt: '2026-08-13T17:00:00Z' },
      properties: { name: { en: 'La Prairie' } }
    },
    {
      resultId: 'city-b',
      category: 'weather-current',
      clickDistanceMeters: 10198,
      geometry: { type: 'Point', coordinates: [-73.57, 45.41] },
      observation: { property: 'temperature', value: 22.8, unit: 'C', observedAt: '2026-08-13T17:00:00Z' },
      properties: { name: { en: 'Sainte-Catherine' } }
    }
  ], { nowMs: NOW });
  assert.equal(records.length, 1);
  assert.equal(records[0].family, 'weather-current');
  assert.match(records[0].stationName, /La Prairie/);
  assert.match(records[0].stationName, /Sainte-Catherine/);
});

test('citypage current weather does not collapse onto a SWOB station', () => {
  const records = buildProofStationRecords([
    swob('a', 2),
    {
      resultId: 'city',
      category: 'weather-current',
      clickDistanceMeters: 400,
      geometry: { type: 'Point', coordinates: [-73.579185, 45.504926] },
      observation: { property: 'temperature', value: 14.4, unit: 'C', observedAt: '2026-08-13T17:00:00Z' },
      properties: { name: { en: 'Montréal' } }
    }
  ], { nowMs: NOW });
  assert.equal(records.length, 2);
  assert.equal(records.some((row) => row.family === 'weather'), true);
  assert.equal(records.some((row) => row.family === 'weather-current'), true);
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
  assert.equal(hover.title, 'MCTAVISH');
  assert.match(hover.lines.join('\n'), /SWOB WEATHER/);
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
  assert.equal(renderer.visualVariables, undefined);
  assert.ok(renderer.uniqueValueInfos.some((info) => info.value === 'hydrometric-CURRENT'));
  assert.ok(renderer.uniqueValueInfos.some((info) => info.value === 'weather-STALE'));
  assert.ok(renderer.uniqueValueInfos.some((info) => info.value === 'climate-STALE'));
  assert.ok(renderer.uniqueValueInfos.some((info) => info.value === 'weather-current-CURRENT'));
  assert.ok(renderer.uniqueValueInfos.some((info) => info.value === 'air-quality-CURRENT'));
  const climate = buildClimateCimSymbol(FRESHNESS_CLASS.STALE);
  const citypage = buildWeatherCurrentCimSymbol(FRESHNESS_CLASS.CURRENT);
  const air = buildAirQualityCimSymbol(FRESHNESS_CLASS.CURRENT);
  assert.equal(climate.data.symbol.type, 'CIMPointSymbol');
  assert.equal(citypage.data.symbol.animations, undefined);
  assert.equal(air.data.symbol.type, 'CIMPointSymbol');
  const fireflyInfo = renderer.uniqueValueInfos.find((info) => info.value === 'hydrometric-CURRENT-inside');
  assert.equal(fireflyInfo.symbol.data.maxScale, PI_LOCAL_INSTRUMENT_MIN_SCALE);
  assert.equal(fireflyInfo.alternateSymbols.length, 1);
  assert.equal(fireflyInfo.alternateSymbols[0].data.minScale, PI_LOCAL_INSTRUMENT_MIN_SCALE);
  const fireflySymbol = buildRegionalFireflyCimSymbol('hydrometric', FRESHNESS_CLASS.CURRENT);
  assert.equal(fireflySymbol.data.symbol.animations, undefined);
  assert.equal(fireflySymbol.data.symbol.type, 'CIMPointSymbol');
});
