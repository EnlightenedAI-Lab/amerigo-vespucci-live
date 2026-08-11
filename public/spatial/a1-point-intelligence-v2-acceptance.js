/**
 * Autonomous Point Intelligence V2 multi-capability acceptance harness.
 */
import {
  buildPointIntelligenceRequest
} from './point-intelligence-request.js';
import {
  POINT_INTELLIGENCE_FAMILIES,
  POINT_INTELLIGENCE_FAMILY_ORDER
} from './point-intelligence-config.js';
import {
  getPointIntelligenceRequestCount,
  resetPointIntelligenceRequestCount,
  runPointIntelligenceQuery,
  setPointIntelligenceModeEnabled,
  getPointIntelligenceState
} from './point-intelligence-service.js';
import { getPointIntelligenceLayerState } from './point-intelligence-layer.js';
import { summarizePointIntelligenceResponse } from './point-intelligence-status.js';
import {
  buildHydrometricPresentation,
  buildClimatePresentation,
  buildWeatherPresentation,
  buildWeatherCurrentPresentation,
  buildClimateHourlyPresentation,
  buildAirQualityPresentation,
  buildHydrometricMeasurementPresentation
} from './point-intelligence-presentation.js';
import { buildPointIntelligenceSummaryHtml } from './point-intelligence-presentation.js';
import { isMultiFamilyPointIntelligenceResponse } from './point-intelligence-multifamily.js';

const MONTREAL = { longitude: -73.5673, latitude: 45.5017 };
const CORNER_BROOK = { longitude: -57.922167, latitude: 48.9521 };
const MARKHAM = { longitude: -79.23356, latitude: 43.85836 };
const OUTSIDE = { longitude: -30, latitude: 30 };

const CAPABILITY_POINTS = Object.freeze({
  hydrometric: MONTREAL,
  climate: MONTREAL,
  weather: MONTREAL,
  'weather-current': MONTREAL,
  'climate-hourly': MONTREAL,
  'air-quality': CORNER_BROOK,
  'hydrometric-measurement': MARKHAM
});

const PRESENTATION_BUILDERS = {
  hydrometric: buildHydrometricPresentation,
  climate: buildClimatePresentation,
  weather: buildWeatherPresentation,
  'weather-current': buildWeatherCurrentPresentation,
  'climate-hourly': buildClimateHourlyPresentation,
  'air-quality': buildAirQualityPresentation,
  'hydrometric-measurement': buildHydrometricMeasurementPresentation
};

function summarizeCapabilityEvidence(family, response) {
  const first = response?.results?.[0] || null;
  const builder = PRESENTATION_BUILDERS[family];
  const card = first && builder ? builder(first) : null;
  return {
    family,
    capability: ({
      hydrometric: 'hydrometric-stations',
      climate: 'climate-daily',
      weather: 'swob-realtime',
      'weather-current': 'citypageweather-realtime',
      'climate-hourly': 'climate-hourly',
      'air-quality': 'aqhi-observations-realtime',
      'hydrometric-measurement': 'hydrometric-realtime'
    })[family],
    queryState: response?.queryState || 'ERROR',
    resultCount: response?.resultCount ?? response?.results?.length ?? 0,
    source: first?.providerName || null,
    temporalClass: first?.temporalClassification || null,
    resultKind: first?.resultKind || null,
    representativeTime: card?.observationDate || first?.observation?.observedAt || first?.temporal?.LOCAL_DATE || null,
    representativeMeasurements: card?.lines?.filter((line) => /:|°C|AQHI|mm|km\/h|Water level|Discharge/.test(line)) || [],
    distance: first?.clickDistanceMeters ?? null,
    queryReceipt: response?.queryReceiptId || null,
    geometryRendered: Boolean(first?.geometry?.type),
    title: card?.title || null,
    honestyLabel: card?.honestyLabel || null
  };
}

async function querySingleFamily(family, point, radiusMeters = 3000) {
  setPointIntelligenceModeEnabled(true);
  return runPointIntelligenceQuery({
    ...point,
    informationFamily: family,
    radiusMeters
  }, { force: true });
}

export async function runPointIntelligenceV2CapabilityEvidence() {
  const capabilities = {};
  for (const family of POINT_INTELLIGENCE_FAMILY_ORDER) {
    const point = CAPABILITY_POINTS[family];
    const response = await querySingleFamily(family, point, family === 'air-quality' || family === 'hydrometric-measurement' ? 5000 : 3000);
    capabilities[family] = summarizeCapabilityEvidence(family, response);
  }
  return capabilities;
}

export async function runPointIntelligenceV2MultiFamilyClick(mapOperational = false) {
  setPointIntelligenceModeEnabled(true);
  resetPointIntelligenceRequestCount();
  const beforeCount = getPointIntelligenceRequestCount();
  const response = await runPointIntelligenceQuery(MONTREAL, { force: true });
  const summary = summarizePointIntelligenceResponse(response);
  const layers = getPointIntelligenceLayerState();
  const failures = [];

  if (!isMultiFamilyPointIntelligenceResponse(response)) {
    failures.push('expected multi-family response');
  }
  if (!['SUCCESS', 'PARTIAL_RESULTS'].includes(response.queryState)) {
    failures.push(`expected SUCCESS|PARTIAL_RESULTS got ${response.queryState}`);
  }
  if ((summary.familiesWithEvidence || 0) < 2) {
    failures.push(`expected >=2 families with evidence, got ${summary.familiesWithEvidence || 0}`);
  }
  if (getPointIntelligenceRequestCount() - beforeCount !== 1) {
    failures.push(`expected 1 bundle request, got ${getPointIntelligenceRequestCount() - beforeCount}`);
  }
  if (mapOperational && layers.clickGraphics < 1) failures.push('missing click marker');
  if (mapOperational && layers.resultGraphics < 1) failures.push('missing result graphics');

  const panel = document.querySelector('#spatial-point-intelligence-results');
  const html = buildPointIntelligenceSummaryHtml({
    point: MONTREAL,
    response: { ...response, summary },
    presentation: { state: response.queryState, message: `${summary.familiesWithEvidence} families` }
  });
  if (panel) panel.innerHTML = html;
  const text = panel?.textContent || '';
  if (!/Hydrometric station registry/i.test(text) && response.families?.hydrometric?.hasEvidence) {
    failures.push('hydrometric registry label missing in multi-family panel');
  }
  if (/\bLIVE\b/i.test(text)) failures.push('false LIVE labeling in multi-family panel');

  const familiesWithEvidence = Object.entries(response.families || {})
    .filter(([, entry]) => entry.hasEvidence)
    .map(([family]) => family);

  return {
    pass: failures.length === 0,
    failures,
    response,
    summary,
    layers,
    familiesWithEvidence,
    requestDelta: getPointIntelligenceRequestCount() - beforeCount,
    location: MONTREAL
  };
}

export async function runPointIntelligenceV2ZeroResultStep() {
  setPointIntelligenceModeEnabled(true);
  const response = await runPointIntelligenceQuery({
    ...OUTSIDE,
    informationFamily: POINT_INTELLIGENCE_FAMILIES.HYDROMETRIC
  }, { force: true });
  const layers = getPointIntelligenceLayerState();
  const failures = [];
  if (response.queryState !== 'NO_APPLICABLE_CAPABILITY') {
    failures.push(`expected NO_APPLICABLE_CAPABILITY got ${response.queryState}`);
  }
  if ((response.resultCount ?? response.results?.length ?? 0) > 0) {
    failures.push('unexpected results for outside coverage');
  }
  if (layers.resultGraphics > 0) failures.push('unexpected map features for zero-result query');
  return { pass: failures.length === 0, failures, response, layers };
}

export async function runPointIntelligenceV2AuthorityChecks() {
  const checks = ['url', 'capabilityId', 'verified', 'endpoint'].map((field) => {
    const payload = { [field]: 'evil', geometry: { type: 'Point', coordinates: [-73.5, 45.5] } };
    const built = buildPointIntelligenceRequest(payload);
    return { field, pass: !built.ok, built };
  });
  const pass = checks.every((check) => check.pass);
  return { pass, checks };
}

export async function runPointIntelligenceV2Acceptance(mapOperational = false) {
  const capabilities = await runPointIntelligenceV2CapabilityEvidence();
  const multiFamily = await runPointIntelligenceV2MultiFamilyClick(mapOperational);
  const zeroResult = await runPointIntelligenceV2ZeroResultStep();
  const authority = await runPointIntelligenceV2AuthorityChecks();

  const capabilityPass = Object.values(capabilities).filter((entry) => (
    entry.resultCount > 0 || ['NO_RESULTS', 'NO_APPLICABLE_CAPABILITY'].includes(entry.queryState)
  )).length;

  const steps = [
    { id: 'multi-family-click', ...multiFamily },
    { id: 'zero-result', ...zeroResult },
    { id: 'authority', ...authority }
  ];

  const passed = steps.filter((step) => step.pass).length
    + (capabilityPass === POINT_INTELLIGENCE_FAMILY_ORDER.length ? 1 : 0);
  const total = steps.length + 1;

  return {
    state: passed === total && multiFamily.pass ? 'PASS' : 'PARTIAL',
    passed,
    failed: total - passed,
    total,
    capabilities,
    steps,
    modeOff: await (async () => {
      resetPointIntelligenceRequestCount();
      setPointIntelligenceModeEnabled(false);
      const before = getPointIntelligenceRequestCount();
      await runPointIntelligenceQuery(MONTREAL);
      const after = getPointIntelligenceRequestCount();
      return { pass: before === after, before, after };
    })()
  };
}

export function mountPointIntelligenceV2AcceptanceHarness() {
  if (typeof window === 'undefined') return;
  window.__IQAI_RUN_POINT_INTELLIGENCE_V2_ACCEPTANCE__ = runPointIntelligenceV2Acceptance;
  window.__IQAI_POINT_INTELLIGENCE_V2__ = {
    runCapabilityEvidence: runPointIntelligenceV2CapabilityEvidence,
    runMultiFamilyClick: runPointIntelligenceV2MultiFamilyClick,
    getState: getPointIntelligenceState
  };
}
