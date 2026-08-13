import test from 'node:test';
import assert from 'node:assert/strict';
import {
  haversineMeters,
  shouldUseMscFallback
} from '../src/spatial/point-intelligence-msc-fallback.js';
import { buildPointIntelligenceProseSummary } from '../public/spatial/point-intelligence-location-synthesis.js';

test('haversineMeters returns a legitimate downtown-to-McTavish distance', () => {
  const meters = haversineMeters(-73.5673, 45.5017, -73.5776, 45.5044);
  assert.ok(meters > 700 && meters < 1200);
});

test('shouldUseMscFallback when broker is down or empty', () => {
  assert.equal(shouldUseMscFallback(null), true);
  assert.equal(shouldUseMscFallback({ ok: false, body: { families: [] } }), true);
  assert.equal(shouldUseMscFallback({
    ok: true,
    body: { bundleState: 'PARTIAL_FAILURE', families: [] }
  }), true);
  assert.equal(shouldUseMscFallback({
    ok: true,
    body: {
      bundleState: 'PARTIAL_RESULTS',
      families: [{ informationFamily: 'weather', status: 'SUCCESS', resultCount: 1 }]
    }
  }), false);
});

test('prose summary uses returned families only and does not invent certainty', () => {
  const prose = buildPointIntelligenceProseSummary([
    { informationFamily: 'air-quality', coverageState: 'NO_LOCAL_EVIDENCE', hasEvidence: false },
    { informationFamily: 'hydrometric', coverageState: 'EVIDENCE', hasEvidence: true },
    { informationFamily: 'hydrometric-measurement', coverageState: 'NO_LOCAL_EVIDENCE', hasEvidence: false }
  ], {
    currentBlocks: [{
      family: 'weather',
      station: 'MCTAVISH',
      distance: '0.85 km away',
      measurements: ['Temperature: 21.1 °C']
    }],
    contextBlocks: []
  });
  assert.match(prose, /21\.1/);
  assert.match(prose, /MCTAVISH/);
  assert.match(prose, /No nearby air-quality/);
  assert.match(prose, /Hydrometric context is station registry metadata only/);
  assert.doesNotMatch(prose, /certainly|definitely|exactly at the clicked point/i);
});
