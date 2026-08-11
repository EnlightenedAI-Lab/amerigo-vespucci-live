#!/usr/bin/env node
/**
 * Agent 1 IQAI Spatial product stability verification (API-level).
 * Complements launcher script and browser acceptance.
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeOpenWorldSearchResponse } from '../public/spatial/open-world-intelligence-model.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BASE = process.env.SPATIAL_URL || 'http://localhost:3000';
const ARTIFACT_DIR = resolve(ROOT, 'artifacts', 'agent1-stability');

function loadEnv() {
  const path = resolve(ROOT, '.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!process.env[key]) process.env[key] = trimmed.slice(eq + 1).trim();
  }
}

loadEnv();

const report = {
  generatedAt: new Date().toISOString(),
  baseUrl: BASE,
  checks: []
};

function record(id, pass, detail = {}) {
  report.checks.push({ id, pass, ...detail });
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { Accept: 'application/json', ...(options.headers || {}) } });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

// 1. Application boot / health
const health = await fetchJson(`${BASE}/health`);
record('application_boot', health.ok && health.body?.ok === true && health.body?.spatialEngine === 'compound-v1', {
  spatialEngine: health.body?.spatialEngine,
  port: BASE
});

const spatialPage = await fetch(`${BASE}/spatial/`);
record('spatial_shell', spatialPage.ok, { status: spatialPage.status, url: `${BASE}/spatial/` });

// 2. MAP COMMAND — deterministic GIS plan path
try {
  const { planNaturalLanguageGISRequest } = await import('../src/spatial/a1-gis-plan-natural-language-service.js');
  const { setGisPlanProviderCallOverride, clearGisPlanProviderCallOverride } = await import('../src/spatial/a1-gis-plan-model-provider.js');
  const prompt = 'map fire stations within 3 km of 997 de la commune';
  setGisPlanProviderCallOverride(async () => ({
    rawContent: JSON.stringify({
      type: 'PLAN',
      plan: {
        schemaVersion: '1.0.0',
        operation: 'WITHIN',
        dataset: 'fire_stations',
        location: { type: 'address', text: '997 de la Commune' },
        radius: { value: 3, unit: 'km' }
      }
    }),
    provider: 'MOCK',
    model: 'stability-mock'
  }));
  const planned = await planNaturalLanguageGISRequest({ text: prompt });
  clearGisPlanProviderCallOverride();
  record('map_command_plan', planned?.status === 'VALID_PLAN' && planned?.normalizedPlan?.dataset === 'fire_stations', {
    prompt,
    status: planned?.status,
    dataset: planned?.normalizedPlan?.dataset
  });
} catch (error) {
  record('map_command_plan', false, { error: error.message });
}

// 3. AI MAP — mock provider path (deterministic safety)
try {
  const { setGisPlanProviderCallOverride, clearGisPlanProviderCallOverride } = await import('../src/spatial/a1-gis-plan-model-provider.js');
  const { planNaturalLanguageGISRequest } = await import('../src/spatial/a1-gis-plan-natural-language-service.js');
  setGisPlanProviderCallOverride(async () => ({
    rawContent: JSON.stringify({
      type: 'PLAN',
      plan: {
        schemaVersion: '1.0.0',
        operation: 'NEAREST',
        dataset: 'police_stations',
        location: { type: 'address', text: 'Montreal' },
        limit: 3
      }
    }),
    provider: 'MOCK',
    model: 'stability-mock'
  }));
  const ai = await planNaturalLanguageGISRequest({ text: 'show 3 nearest police stations near downtown Montreal' });
  clearGisPlanProviderCallOverride();
  record('ai_map_plan', ai?.status === 'VALID_PLAN', { status: ai?.status, dataset: ai?.normalizedPlan?.dataset });
} catch (error) {
  record('ai_map_plan', false, { error: error.message });
}

// 4. Point Intelligence — Montreal bundle
const piBody = {
  geometry: { type: 'Point', coordinates: [-73.5673, 45.5017] },
  radiusMeters: 3000,
  informationFamilies: 'AUTO',
  temporalIntent: { mode: 'LATEST' }
};
const piBundle = await fetchJson(`${BASE}/api/spatial/point-intelligence/query-bundle`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(piBody)
});
const families = Object.values(piBundle.body?.families || {});
const withResults = families.filter((f) => Number(f.resultCount) > 0);
record('point_intelligence', piBundle.ok && withResults.length >= 1, {
  bundleState: piBundle.body?.bundleState,
  familiesWithResults: withResults.length,
  proof: withResults.slice(0, 3).map((f) => `${f.informationFamily}=${f.resultCount}`).join(', ')
});

// 5. Open-World Intelligence — fire search
const owiPlan = {
  keyword: 'fire',
  interpretation: 'APPEARED',
  temporalMode: 'LATEST',
  spatial: { province: 'QC' },
  archive: { mode: 'CURRENT', freeText: 'fire' },
  incidents: { operationalScope: 'current', projectionEligible: 'true' },
  events: { operationalScope: 'current', geometryEligible: 'true' }
};
const owi = await fetchJson(`${BASE}/api/spatial/open-world-intelligence/search`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ keyword: 'fire', interpretation: 'APPEARED', plan: owiPlan })
});
const normalized = normalizeOpenWorldSearchResponse(owi.body, null);
const sample = normalized.spatial[0];
record('open_world_intelligence', owi.ok && normalized.summary.spatialResults >= 1 && sample?.title !== sample?.locationLabel, {
  spatialResults: normalized.summary.spatialResults,
  nonSpatialResults: normalized.summary.nonSpatialResults,
  sampleTitle: sample?.title,
  sampleLocation: sample?.locationLabel,
  sampleSource: sample?.primarySource || sample?.sourceFamily
});

// 6. Agent 2 health seam
const a2 = await fetchJson(`${BASE}/api/spatial/intelligence/health`);
record('agent2_health', a2.ok && a2.body?.service === 'iqai-intelligence-connectors', {
  service: a2.body?.service
});

const failed = report.checks.filter((c) => !c.pass);
report.state = failed.length ? 'FAIL' : 'PASS';
report.pass = report.checks.length - failed.length;
report.fail = failed.length;
report.total = report.checks.length;

mkdirSync(ARTIFACT_DIR, { recursive: true });
writeFileSync(resolve(ARTIFACT_DIR, 'latest.json'), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(resolve(ARTIFACT_DIR, 'latest.txt'), [
  'AGENT 1 PRODUCT STABILITY',
  `STATE: ${report.state}`,
  `CHECKS: ${report.pass}/${report.total}`,
  '',
  ...report.checks.map((c) => `${c.pass ? 'PASS' : 'FAIL'} ${c.id} ${JSON.stringify(c)}`)
].join('\n'));

console.log(JSON.stringify({ state: report.state, pass: report.pass, total: report.total }, null, 2));
for (const check of report.checks) {
  console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.id}`);
}
process.exit(failed.length ? 1 : 0);
