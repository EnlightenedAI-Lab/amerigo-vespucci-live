import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getIntelligenceLabManifest,
  getIntelligenceLabPanel,
  verifyIntelligenceLabJoin,
  getIntelligenceLabGeographyPath
} from '../src/spatial/intelligence-lab-routes.js';
import fs from 'node:fs';

describe('intelligence lab data', () => {
  it('loads manifest with 28 PDQs and 5 categories', () => {
    const manifest = getIntelligenceLabManifest();
    assert.equal(manifest.pdqIds.length, 28);
    assert.equal(manifest.categories.length, 5);
    assert.ok(manifest.weeks.length >= 600);
  });

  it('verifies 28/28 geography-panel join', () => {
    const join = verifyIntelligenceLabJoin();
    assert.equal(join.ok, true);
    assert.equal(join.geographyCount, 28);
    assert.equal(join.panelCount, 28);
  });

  it('panel compact arrays align with dimensions', () => {
    const panel = getIntelligenceLabPanel();
    const expected = panel.weeks.length * panel.categories.length * panel.pdqIds.length;
    assert.equal(panel.reportCount.length, expected);
    for (const key of ['B0', 'B1', 'B2', 'B3', 'B4']) {
      assert.equal(panel.baselines[key].length, expected);
    }
  });

  it('geography artifact exists with 28 features', () => {
    const geoPath = getIntelligenceLabGeographyPath();
    assert.ok(fs.existsSync(geoPath));
    const geo = JSON.parse(fs.readFileSync(geoPath, 'utf8'));
    assert.equal(geo.features.length, 28);
    const ids = geo.features.map((f) => f.properties.harmonized_pdq_id);
    assert.equal(new Set(ids).size, 28);
  });

  it('observed values match for a known cell', () => {
    const panel = getIntelligenceLabPanel();
    const wi = panel.weeks.indexOf('2024-06-03');
    const ci = panel.categories.indexOf('Vol de véhicule à moteur');
    const pi = panel.pdqIds.indexOf('PDQ_H_01');
    assert.ok(wi >= 0 && ci >= 0 && pi >= 0);
    const idx = (wi * panel.categories.length + ci) * panel.pdqIds.length + pi;
    assert.equal(typeof panel.reportCount[idx], 'number');
    assert.ok(panel.baselines.B2[idx] != null);
  });
});
