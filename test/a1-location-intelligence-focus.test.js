import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLocationIntelligenceFocusModel,
  buildBundleSummaryModel,
  buildTemporalMix,
  buildDeterministicFactModel,
  deriveCoverageState,
  groupFamiliesByDomain,
  buildFamilyCoverageModel
} from '../public/spatial/point-intelligence-lif-model.js';
import { buildPointIntelligenceSummaryHtml } from '../public/spatial/point-intelligence-presentation.js';
import { adaptBundleResponse } from '../public/spatial/point-intelligence-bundle.js';

const MONTREAL = { longitude: -73.5673, latitude: 45.5017 };

function makeFamily(family, status, opts = {}) {
  return {
    informationFamily: family,
    status,
    queryReceiptId: opts.receipt || `receipt-${family}`,
    resultCount: opts.resultCount ?? (opts.results?.length || 0),
    temporalClassification: opts.temporalClassification || null,
    results: opts.results || []
  };
}

function makeBundle(families, extras = {}) {
  return {
    bundleState: extras.bundleState || 'PARTIAL_RESULTS',
    bundleId: 'bundle-test',
    families,
    relationships: extras.relationships || null,
    query: {
      geometry: { type: 'Point', coordinates: [MONTREAL.longitude, MONTREAL.latitude] },
      radiusMeters: 3000
    }
  };
}

test('deriveCoverageState distinguishes evidence, gaps, and provider issues', () => {
  assert.equal(deriveCoverageState('SUCCESS', true), 'EVIDENCE');
  assert.equal(deriveCoverageState('NO_RESULTS', false), 'NO_LOCAL_EVIDENCE');
  assert.equal(deriveCoverageState('NO_APPLICABLE_CAPABILITY', false), 'NOT_APPLICABLE');
  assert.equal(deriveCoverageState('PROVIDER_UNAVAILABLE', false), 'PROVIDER_ISSUE');
});

test('buildBundleSummaryModel derives counts from live bundle families', () => {
  const adapted = adaptBundleResponse(makeBundle([
    makeFamily('weather', 'SUCCESS', {
      temporalClassification: 'NEAR_REAL_TIME',
      results: [{ temporalClassification: 'NEAR_REAL_TIME' }]
    }),
    makeFamily('air-quality', 'NO_RESULTS'),
    makeFamily('hydrometric', 'SUCCESS', {
      temporalClassification: 'STATIC',
      results: [{ temporalClassification: 'STATIC' }]
    })
  ], { bundleState: 'PARTIAL_RESULTS' }), MONTREAL, 1);

  const summary = buildBundleSummaryModel(adapted);
  assert.equal(summary.familiesChecked, 3);
  assert.equal(summary.familiesWithEvidence, 2);
  assert.equal(summary.familiesWithoutLocalEvidence, 1);
  assert.equal(summary.healthyPartial, true);
  assert.match(summary.evidenceSummary, /2 of 3/);
});

test('buildTemporalMix counts temporal classes from evidence families only', () => {
  const adapted = adaptBundleResponse(makeBundle([
    makeFamily('weather', 'SUCCESS', { temporalClassification: 'NEAR_REAL_TIME', results: [{}] }),
    makeFamily('climate', 'SUCCESS', { temporalClassification: 'HISTORICAL', results: [{}] }),
    makeFamily('climate-hourly', 'SUCCESS', { temporalClassification: 'RECENT', results: [{}] }),
    makeFamily('hydrometric', 'SUCCESS', { temporalClassification: 'STATIC', results: [{}] }),
    makeFamily('air-quality', 'NO_RESULTS')
  ]), MONTREAL, 1);

  const mix = buildTemporalMix(adapted);
  assert.equal(mix.find((e) => e.key === 'nearRealTime')?.count, 1);
  assert.equal(mix.find((e) => e.key === 'historical')?.count, 1);
  assert.equal(mix.find((e) => e.key === 'recent')?.count, 1);
  assert.equal(mix.find((e) => e.key === 'stationRegistry')?.count, 1);
});

test('groupFamiliesByDomain orders evidence before no-evidence within domain', () => {
  const adapted = adaptBundleResponse(makeBundle([
    makeFamily('weather', 'NO_RESULTS'),
    makeFamily('weather-current', 'SUCCESS', {
      temporalClassification: 'NEAR_REAL_TIME',
      results: [{ clickDistanceMeters: 500, temporalClassification: 'NEAR_REAL_TIME' }]
    })
  ]), MONTREAL, 1);
  const coverage = buildFamilyCoverageModel(adapted, MONTREAL);
  const domain = coverage.domains.find((d) => d.id === 'weather-atmosphere');
  assert.equal(domain.families[0].coverageState, 'EVIDENCE');
  assert.equal(domain.families[1].coverageState, 'NO_LOCAL_EVIDENCE');
});

test('buildDeterministicFactModel structures facts without causal prose', () => {
  const facts = buildDeterministicFactModel({
    nearestObservationPerFamily: {
      weather: { clickDistanceMeters: 993, stationName: 'MCTAVISH' }
    },
    observationAgePerFamily: {
      'hydrometric-measurement': { seconds: 300 }
    },
    coverageGaps: [{ informationFamily: 'air-quality' }],
    timestampSpread: { spreadSeconds: 93600 },
    sharedStationIdentifiers: [{ identifier: '7025267', families: ['climate', 'climate-hourly'] }]
  }, {
    weather: { label: 'Weather' },
    'hydrometric-measurement': { label: 'Hydrometric (Measurement)' },
    'air-quality': { label: 'Air Quality' },
    climate: { label: 'Climate (Daily)' },
    'climate-hourly': { label: 'Climate (Hourly)' }
  }, 3000);

  assert.ok(facts.some((f) => f.kind === 'nearest' && /993 m/.test(f.text)));
  assert.ok(facts.some((f) => f.kind === 'newest' && /5 min ago/.test(f.text)));
  assert.ok(facts.some((f) => f.kind === 'coverage' && /Air Quality/.test(f.text)));
  assert.ok(facts.some((f) => f.kind === 'spread'));
  assert.equal(facts.some((f) => /caused/i.test(f.text)), false);
});

test('LIF html presents hierarchy without bundle UUID in primary view', () => {
  const adapted = adaptBundleResponse(makeBundle([
    makeFamily('hydrometric', 'SUCCESS', {
      temporalClassification: 'STATIC',
      results: [{
        category: 'hydrometric',
        providerName: 'MSC GeoMet',
        clickDistanceMeters: 1284,
        temporalClassification: 'STATIC',
        properties: { STATION_NAME: 'Test Station' }
      }]
    }),
    makeFamily('air-quality', 'NO_RESULTS')
  ], {
    bundleState: 'PARTIAL_RESULTS',
    relationships: {
      nearestObservationPerFamily: { hydrometric: { clickDistanceMeters: 1284 } }
    }
  }), MONTREAL, 1);
  adapted.request = { geometry: { coordinates: [MONTREAL.longitude, MONTREAL.latitude] }, radiusMeters: 3000 };

  const html = buildPointIntelligenceSummaryHtml({
    point: MONTREAL,
    response: adapted,
    presentation: { state: 'PARTIAL_RESULTS', message: '1 of 2 information families returned local evidence.' }
  });

  assert.match(html, /Point Intelligence/);
  assert.match(html, /45\.50170, -73\.56730/);
  assert.match(html, /3\.00 km radius/);
  assert.match(html, /Coverage/);
  assert.match(html, /Location facts/);
  assert.match(html, /Hydrology/);
  assert.match(html, /Query receipt/i);
  assert.match(html, /receipt-hydrometric/);
  assert.doesNotMatch(html, /bundle-test/);
  assert.doesNotMatch(html, /\bLIVE\b/i);
});

test('scalability fixture with 20 families keeps summary compact', () => {
  const families = Array.from({ length: 20 }, (_, i) => makeFamily(
    `family-${i}`,
    i % 3 === 0 ? 'NO_RESULTS' : 'SUCCESS',
    {
      temporalClassification: 'NEAR_REAL_TIME',
      results: i % 3 === 0 ? [] : [{ temporalClassification: 'NEAR_REAL_TIME' }]
    }
  ));
  const response = {
    multiFamily: true,
    bundleState: 'PARTIAL_RESULTS',
    familiesQueried: 20,
    families: Object.fromEntries(families.map((f) => {
      const key = f.informationFamily;
      return [key, {
        informationFamily: key,
        queryState: f.status,
        hasEvidence: f.results.length > 0,
        resultCount: f.results.length,
        results: f.results,
        temporalClassification: f.temporalClassification
      }];
    })),
    familiesWithEvidence: families.filter((f) => f.results.length).length,
    request: { radiusMeters: 3000, geometry: { coordinates: [-73.5, 45.5] } }
  };

  const model = buildLocationIntelligenceFocusModel(response, MONTREAL);
  assert.equal(model.summary.familiesChecked, 20);
  assert.ok(model.coverage.domains.length >= 1);
  const html = buildPointIntelligenceSummaryHtml({ point: MONTREAL, response });
  assert.match(html, /Point Intelligence/);
  assert.ok(html.length < 120000);
});

test('scalability fixture with 100 families groups without per-family toggles', () => {
  const families = Array.from({ length: 100 }, (_, i) => {
    const key = `scale-family-${i}`;
    const hasEvidence = i % 4 !== 0;
    return [key, {
      informationFamily: key,
      queryState: hasEvidence ? 'SUCCESS' : 'NO_RESULTS',
      hasEvidence,
      resultCount: hasEvidence ? 1 : 0,
      results: hasEvidence ? [{ temporalClassification: 'NEAR_REAL_TIME' }] : [],
      temporalClassification: hasEvidence ? 'NEAR_REAL_TIME' : null
    }];
  });
  const response = {
    multiFamily: true,
    bundleState: 'PARTIAL_RESULTS',
    familiesQueried: 100,
    families: Object.fromEntries(families),
    familiesWithEvidence: 75,
    request: { radiusMeters: 5000 }
  };
  const model = buildLocationIntelligenceFocusModel(response, MONTREAL);
  assert.equal(model.summary.familiesChecked, 100);
  assert.equal(model.summary.familiesWithEvidence, 75);
  const html = buildPointIntelligenceSummaryHtml({ point: MONTREAL, response });
  assert.doesNotMatch(html, /type="checkbox"/);
  assert.match(html, /75 of 100/);
});
