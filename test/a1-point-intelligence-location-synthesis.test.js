import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildLocationSynthesisModel,
  collectSynthesisMeasurements,
  renderLocationSynthesisHtml,
  LOCATION_SYNTHESIS_RULES
} from '../public/spatial/point-intelligence-location-synthesis.js';
import { buildPointIntelligenceSummaryHtml } from '../public/spatial/point-intelligence-presentation.js';
import { adaptBundleResponse } from '../public/spatial/point-intelligence-bundle.js';

const MONTREAL = { latitude: 45.5017, longitude: -73.5673 };

function loadMontrealBundleResponse() {
  const raw = JSON.parse(readFileSync(
    'artifacts/agent1-point-intelligence-v3/latest.json',
    'utf8'
  ));
  return raw.steps.find((step) => step.id === 'bundle-click')?.response;
}

test('LOCATION_SYNTHESIS_RULES documents deterministic precedence', () => {
  assert.ok(LOCATION_SYNTHESIS_RULES.precedence.length >= 4);
  assert.match(LOCATION_SYNTHESIS_RULES.temporalSeparation, /never appear under Current/i);
});

test('collectSynthesisMeasurements groups weather temperature and wind', () => {
  const lines = collectSynthesisMeasurements({
    category: 'weather',
    temporalClassification: 'NEAR_REAL_TIME',
    observation: { property: 'air_temp', value: 21.1, unit: 'C', observedAt: '2026-08-10T02:21:00Z' },
    properties: {
      'wind_spd_scal-value': 12,
      'wind_spd_scal-value-uom': 'km/h',
      'wind_dir_10_min-value': 240
    }
  }, 'weather');
  assert.ok(lines.some((line) => line.includes('21.1 °C')));
  assert.ok(lines.some((line) => /Wind:/.test(line)));
});

test('buildLocationSynthesisModel separates current, historical, water, and coverage', () => {
  const bundle = loadMontrealBundleResponse();
  assert.ok(bundle, 'Montreal bundle artifact required');
  const point = MONTREAL;
  const adapted = {
    ...bundle,
    families: bundle.families,
    familiesQueried: 7,
    familiesWithEvidence: 5
  };
  const model = buildLocationSynthesisModel(adapted, point, { radiusMeters: 3000 });
  const sectionIds = model.sections.map((section) => section.id);
  assert.ok(sectionIds.includes('current'), 'expected current conditions section');
  assert.ok(sectionIds.includes('context'), 'expected historical context section');
  assert.ok(sectionIds.includes('water'), 'expected water section');
  assert.ok(sectionIds.includes('coverage'), 'expected coverage section');

  const current = model.sections.find((section) => section.id === 'current');
  assert.ok(current.blocks.length >= 2, 'expected multiple current condition families');
  assert.ok(current.blocks.some((block) => (
    block.measurements.some((line) => line.includes('21.1') || line.includes('21.2'))
  )));

  const context = model.sections.find((section) => section.id === 'context');
  assert.ok(context.blocks.some((block) => /MCTAVISH/i.test(block.station)));
  assert.ok(context.blocks.some((block) => block.temporalLabel === 'Historical record'
    || block.temporalLabel === 'Recent observation'));

  const water = model.sections.find((section) => section.id === 'water');
  assert.equal(water.blocks[0].temporalLabel, 'Station registry metadata');
  assert.ok(/SAINT-LAURENT/i.test(water.blocks[0].station));

  const coverage = model.sections.find((section) => section.id === 'coverage');
  assert.ok(coverage.blocks.some((block) => /Air Quality/i.test(block.familyLabel)));
  assert.ok(coverage.blocks.some((block) => /No local evidence within/.test(block.message)));
});

test('renderLocationSynthesisHtml appears above detailed evidence in bundle summary', () => {
  const bundle = loadMontrealBundleResponse();
  const point = MONTREAL;
  const html = buildPointIntelligenceSummaryHtml({
    point,
    response: bundle,
    presentation: { state: bundle.queryState, message: '5 of 7 information families returned local evidence.' }
  });
  const synthesisIndex = html.indexOf('lif-synthesis');
  const previewIndex = html.indexOf('lif-evidence-preview');
  assert.ok(synthesisIndex >= 0, 'missing synthesis section');
  assert.ok(previewIndex > synthesisIndex, 'synthesis must precede detailed evidence cards');
  assert.match(html, /Selected location/);
  assert.match(html, /Current conditions/);
  assert.match(html, /MCTAVISH/);
  assert.match(html, /Temperature: 21\.[0-9] °C/);
  assert.match(html, /Station registry metadata/);
  assert.match(html, /No local evidence within 3\.00 km/);
  assert.doesNotMatch(html, />7025267\.1971\.1</);
  assert.match(html, /Inspect evidence/);
});

test('adapted bundle synthesis uses real Agent 5 fields only', () => {
  const bundle = loadMontrealBundleResponse();
  const adapted = adaptBundleResponse({
    bundle: true,
    bundleId: bundle.bundleId,
    bundleState: bundle.bundleState,
    families: Object.values(bundle.families).map((family) => ({
      informationFamily: family.informationFamily,
      status: family.queryState,
      queryState: family.queryState,
      queryReceiptId: family.queryReceiptId,
      resultCount: family.resultCount,
      results: family.results,
      temporalClassification: family.temporalClassification
    }))
  }, MONTREAL, 1);
  const model = buildLocationSynthesisModel(adapted, MONTREAL, { radiusMeters: 3000 });
  const html = renderLocationSynthesisHtml(model);
  assert.ok(html.includes('lif-synthesis'));
  assert.ok(model.sections.length >= 3);
});
