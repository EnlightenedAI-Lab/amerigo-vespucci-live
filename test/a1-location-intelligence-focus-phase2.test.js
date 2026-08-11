import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPointIntelligenceMapPresentation,
  getObservationId,
  getAuthoritativeAssetKey,
  indexSpatialEvidence,
  resolveFactObservationTarget
} from '../public/spatial/point-intelligence-map-presentation.js';
import { PI_MAP_MODE } from '../public/spatial/point-intelligence-focus-state.js';

function makeSpatialResult(overrides = {}) {
  const id = overrides.resultId || `iqai.pi.result.${overrides.idx ?? 0}`;
  return {
    resultId: id,
    category: overrides.family || 'weather',
    providerName: 'MSC GeoMet',
    clickDistanceMeters: overrides.distance ?? 500,
    geometry: overrides.geometry || { type: 'Point', coordinates: [-73.57, 45.50] },
    properties: overrides.properties || {},
    observation: overrides.observation || { observedAt: overrides.observedAt || '2026-08-09T12:00:00Z' },
    ...overrides
  };
}

test('getObservationId prefers resultId then nativeRecordId', () => {
  assert.equal(getObservationId({ resultId: 'a', nativeRecordId: 'b' }), 'a');
  assert.equal(getObservationId({ nativeRecordId: 'b' }), 'b');
});

test('co-located station records share one asset key', () => {
  const a = makeSpatialResult({
    resultId: 'r1',
    properties: { STATION_NUMBER: '7025267' },
    geometry: { type: 'Point', coordinates: [-73.57, 45.50] }
  });
  const b = makeSpatialResult({
    resultId: 'r2',
    properties: { STATION_NUMBER: '7025267' },
    geometry: { type: 'Point', coordinates: [-73.57, 45.50] }
  });
  assert.equal(getAuthoritativeAssetKey(a), getAuthoritativeAssetKey(b));
  const index = indexSpatialEvidence([a, b]);
  assert.equal(index.byAssetKey.size, 1);
  assert.equal(index.byAssetKey.get('station:7025267')?.length, 2);
});

test('representative thinning is deterministic across runs', () => {
  const results = Array.from({ length: 20 }, (_, i) => makeSpatialResult({
    idx: i,
    resultId: `iqai.pi.result.${i}`,
    family: i % 3 === 0 ? 'weather' : i % 3 === 1 ? 'climate' : 'air-quality',
    distance: 100 + i * 50,
    geometry: { type: 'Point', coordinates: [-73.57 + i * 0.001, 45.50 + i * 0.001] },
    observedAt: `2026-08-09T${String(10 + (i % 10)).padStart(2, '0')}:00:00Z`
  }));
  const first = buildPointIntelligenceMapPresentation(results, {});
  const second = buildPointIntelligenceMapPresentation(results, {});
  assert.deepEqual(
    first.renderedMarkers.map((m) => m.representativeObservationId),
    second.renderedMarkers.map((m) => m.representativeObservationId)
  );
  assert.ok(first.accounting.thinned);
  assert.equal(first.accounting.totalObservations, 20);
});

test('focused observation is always included even when thinned', () => {
  const results = Array.from({ length: 20 }, (_, i) => makeSpatialResult({
    idx: i,
    resultId: `iqai.pi.result.focus-${i}`,
    family: 'weather',
    distance: 100 + i * 100,
    geometry: { type: 'Point', coordinates: [-73.57 + i * 0.002, 45.50] }
  }));
  const focusedId = 'iqai.pi.result.focus-19';
  const presentation = buildPointIntelligenceMapPresentation(results, {
    mode: PI_MAP_MODE.FOCUSED_OBSERVATION,
    focusedObservationId: focusedId
  });
  const ids = presentation.renderedMarkers.flatMap((m) => m.observationIds);
  assert.ok(ids.includes(focusedId));
  const focusedMarker = presentation.renderedMarkers.find((m) => m.emphasized);
  assert.equal(focusedMarker?.representativeObservationId, focusedId);
});

test('family focus emphasizes focused family markers', () => {
  const results = [
    makeSpatialResult({ resultId: 'w1', family: 'weather', distance: 100 }),
    makeSpatialResult({ resultId: 'w2', family: 'weather', distance: 200, geometry: { type: 'Point', coordinates: [-73.58, 45.51] } }),
    makeSpatialResult({ resultId: 'c1', family: 'climate', distance: 150, geometry: { type: 'Point', coordinates: [-73.56, 45.49] } })
  ];
  const presentation = buildPointIntelligenceMapPresentation(results, {
    mode: PI_MAP_MODE.FOCUSED_FAMILY,
    focusedFamily: 'weather'
  });
  const weatherMarkers = presentation.renderedMarkers.filter((m) => m.family === 'weather');
  const climateMarkers = presentation.renderedMarkers.filter((m) => m.family === 'climate');
  assert.ok(weatherMarkers.every((m) => m.emphasized));
  assert.ok(climateMarkers.every((m) => m.deemphasized));
});

test('non-spatial observation has no geometry in index', () => {
  const spatial = makeSpatialResult({ resultId: 's1' });
  const nonSpatial = {
    resultId: 'n1',
    category: 'weather',
    providerName: 'MSC GeoMet',
    properties: { note: 'metadata only' }
  };
  const index = indexSpatialEvidence([spatial, nonSpatial]);
  assert.equal(index.observations.length, 2);
  assert.equal(index.spatialObservations.length, 1);
  assert.equal(index.byObservationId.get('n1')?.hasGeometry, false);
});

test('resolveFactObservationTarget maps nearest and newest facts', () => {
  const results = [
    makeSpatialResult({ resultId: 'near', family: 'weather', distance: 200 }),
    makeSpatialResult({
      resultId: 'far',
      family: 'weather',
      distance: 900,
      geometry: { type: 'Point', coordinates: [-73.55, 45.52] },
      observation: { observedAt: '2026-08-09T20:00:00Z' }
    })
  ];
  const index = indexSpatialEvidence(results);
  const nearest = resolveFactObservationTarget({ kind: 'nearest', familyKey: 'weather' }, index);
  const newest = resolveFactObservationTarget({ kind: 'newest', familyKey: 'weather' }, index);
  assert.equal(nearest, 'near');
  assert.equal(newest, 'far');
});

test('scale fixture keeps bounded rendered markers with full observation accounting', () => {
  const families = ['weather', 'climate', 'air-quality', 'hydrometric', 'climate-hourly'];
  const results = Array.from({ length: 100 }, (_, i) => makeSpatialResult({
    idx: i,
    resultId: `iqai.pi.result.scale-${i}`,
    family: families[i % families.length],
    distance: 50 + (i % 25) * 120,
    geometry: { type: 'Point', coordinates: [-73.57 + (i % 10) * 0.003, 45.50 + Math.floor(i / 10) * 0.002] },
    properties: i % 7 === 0 ? { STATION_NUMBER: `ST-${Math.floor(i / 7)}` } : {}
  }));
  const presentation = buildPointIntelligenceMapPresentation(results, {});
  assert.equal(presentation.accounting.totalObservations, 100);
  assert.ok(presentation.accounting.renderedMapLocations <= families.length * 3);
  const familyFocus = buildPointIntelligenceMapPresentation(results, {
    mode: PI_MAP_MODE.FOCUSED_FAMILY,
    focusedFamily: 'weather'
  });
  assert.ok(familyFocus.renderedMarkers.some((m) => m.family === 'weather' && m.emphasized));
});

test('returned vs rendered accounting is explainable', () => {
  const results = [
    makeSpatialResult({ resultId: 'a1', properties: { STATION_NUMBER: '100' } }),
    makeSpatialResult({ resultId: 'a2', properties: { STATION_NUMBER: '100' } }),
    makeSpatialResult({ resultId: 'b1', geometry: { type: 'Point', coordinates: [-73.56, 45.51] } })
  ];
  const presentation = buildPointIntelligenceMapPresentation(results, {});
  assert.equal(presentation.accounting.spatialObservations, 3);
  assert.equal(presentation.accounting.uniqueSpatialAssets, 2);
  assert.equal(presentation.accounting.renderedMapLocations, 2);
  assert.equal(presentation.accounting.thinned, true);
});
