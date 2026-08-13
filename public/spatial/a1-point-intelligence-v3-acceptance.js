/**
 * Autonomous Point Intelligence V3 unified bundle acceptance harness.
 */
import {
  buildPointIntelligenceBundleRequest,
  buildPointIntelligenceRequest
} from './point-intelligence-request.js';
import {
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
import { buildPointIntelligenceSummaryHtml } from './point-intelligence-presentation.js';
import {
  isMultiFamilyPointIntelligenceResponse
} from './point-intelligence-multifamily.js';
import {
  formatRelationshipFacts,
  isBundleResponse
} from './point-intelligence-bundle.js';

const MONTREAL = { longitude: -73.5673, latitude: 45.5017 };

const FAMILY_CAPABILITY = Object.freeze({
  hydrometric: 'hydrometric-stations',
  climate: 'climate-daily',
  weather: 'swob-realtime',
  'weather-current': 'citypageweather-realtime',
  'climate-hourly': 'climate-hourly',
  'air-quality': 'aqhi-observations-realtime',
  'hydrometric-measurement': 'hydrometric-realtime'
});

function summarizeFamilyEvidence(family, entry, response) {
  const first = entry?.results?.[0] || null;
  return {
    family,
    status: entry?.queryState || 'ERROR',
    capability: response?.plannerDecision?.selectedCapabilities?.find?.((cap) => (
      cap.includes(family.replace('-measurement', '').replace('weather-current', 'citypage'))
    )) || FAMILY_CAPABILITY[family] || null,
    resultCount: entry?.resultCount ?? entry?.results?.length ?? 0,
    source: first?.providerName || null,
    temporalClass: first?.temporalClassification || entry?.temporalClassification || null,
    representativeTime: first?.observation?.observedAt
      || first?.temporal?.LOCAL_DATE
      || first?.temporal?.DATE
      || null,
    representativeMeasurements: first?.observation
      ? [`${first.observation.property}: ${first.observation.value}`]
      : [],
    distance: first?.clickDistanceMeters ?? null,
    queryReceipt: entry?.queryReceiptId || null,
    geometryCount: (entry?.results || []).filter((result) => result?.geometry?.type).length
  };
}

export async function runPointIntelligenceV3BundleClick(mapOperational = false) {
  setPointIntelligenceModeEnabled(true);
  resetPointIntelligenceRequestCount();
  const beforeCount = getPointIntelligenceRequestCount();
  const bundleRequests = [];
  const originalFetch = window.fetch;
  window.fetch = async (url, init) => {
    if (String(url).includes('/api/spatial/point-intelligence/query-bundle')) {
      bundleRequests.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
    }
    return originalFetch(url, init);
  };

  let response;
  try {
    response = await runPointIntelligenceQuery(MONTREAL, { force: true });
  } finally {
    window.fetch = originalFetch;
  }

  const summary = summarizePointIntelligenceResponse(response);
  const layers = getPointIntelligenceLayerState();
  const failures = [];

  if (!isBundleResponse(response)) failures.push('expected bundle response');
  if (!isMultiFamilyPointIntelligenceResponse(response)) failures.push('expected multi-family presentation model');
  if (bundleRequests.length !== 1) failures.push(`expected 1 bundle request, got ${bundleRequests.length}`);
  if (getPointIntelligenceRequestCount() - beforeCount !== 1) {
    failures.push(`expected requestCount delta 1, got ${getPointIntelligenceRequestCount() - beforeCount}`);
  }
  if (!['SUCCESS', 'PARTIAL_RESULTS', 'PARTIAL_FAILURE'].includes(response.bundleState || response.queryState)) {
    failures.push(`unexpected bundle state ${response.bundleState || response.queryState}`);
  }
  if (bundleRequests[0]?.body?.informationFamilies !== 'AUTO') {
    failures.push('bundle request missing informationFamilies=AUTO');
  }
  if (bundleRequests[0]?.body?.temporalIntent?.mode !== 'LATEST') {
    failures.push('bundle request missing temporalIntent.mode=LATEST');
  }
  if (mapOperational && layers.clickGraphics < 1) failures.push('missing click marker');
  if (mapOperational && summary.familiesWithEvidence > 0 && layers.resultGraphics < 1 && (layers.stationFeatures || 0) < 1) {
    failures.push('missing result graphics');
  }

  const panel = document.querySelector('#spatial-point-intelligence-results');
  const html = buildPointIntelligenceSummaryHtml({
    point: MONTREAL,
    response: { ...response, summary },
    presentation: getPointIntelligenceState().summary
  });
  if (panel) panel.innerHTML = html;
  const text = panel?.textContent || '';
  if (/\bLIVE\b/i.test(text)) failures.push('false LIVE labeling in bundle panel');
  if (summary.familiesWithEvidence > 0 && !/returned (local )?evidence/i.test(text)) {
    failures.push('bundle summary missing evidence count');
  }
  if (!/Point Intelligence/i.test(text)) {
    failures.push('LIF header missing');
  }

  const familyResults = {};
  for (const family of POINT_INTELLIGENCE_FAMILY_ORDER) {
    const entry = response.families?.[family];
    if (entry) familyResults[family] = summarizeFamilyEvidence(family, entry, response);
  }

  return {
    pass: failures.length === 0,
    failures,
    response,
    summary,
    layers,
    bundleRequests,
    familyResults,
    bundleId: response.bundleId || response.orchestrationId || null,
    bundleState: response.bundleState || response.queryState,
    plannerDecision: response.plannerDecision || null,
    relationshipFacts: formatRelationshipFacts(response.relationships),
    requestDelta: getPointIntelligenceRequestCount() - beforeCount,
    location: MONTREAL,
    radiusMeters: 3000,
    informationFamilies: 'AUTO',
    temporalIntent: 'LATEST'
  };
}

export async function runPointIntelligenceV3AuthorityChecks() {
  const bundleChecks = ['url', 'capabilityId', 'verified', 'provider', 'endpoint'].map((field) => {
    const payload = {
      [field]: 'evil',
      geometry: { type: 'Point', coordinates: [-73.5, 45.5] },
      informationFamilies: 'AUTO',
      temporalIntent: { mode: 'LATEST' }
    };
    const built = buildPointIntelligenceBundleRequest(payload);
    return { field, pass: !built.ok, built };
  });
  const rangeCheck = buildPointIntelligenceBundleRequest({
    geometry: { type: 'Point', coordinates: [-73.5, 45.5] },
    temporalIntent: { mode: 'RANGE', start: '2020-01-01', end: '2020-12-31' }
  });
  const singleFamily = buildPointIntelligenceRequest({
    geometry: { type: 'Point', coordinates: [-73.5, 45.5] },
    informationFamily: 'weather'
  });
  return {
    pass: bundleChecks.every((check) => check.pass)
      && !rangeCheck.ok
      && singleFamily.ok,
    bundleChecks,
    rangeRejected: !rangeCheck.ok,
    singleFamilyStillWorks: singleFamily.ok
  };
}

export async function runPointIntelligenceV3StaleBundleStep() {
  setPointIntelligenceModeEnabled(true);
  const first = runPointIntelligenceQuery(MONTREAL, { force: true });
  const second = await runPointIntelligenceQuery({
    ...MONTREAL,
    longitude: MONTREAL.longitude + 0.02
  }, { force: true });
  await first;
  const state = getPointIntelligenceState();
  const pass = state.lastClickedPoint?.longitude > MONTREAL.longitude + 0.01;
  return {
    pass,
    failures: pass ? [] : ['stale bundle response overwrote newer click'],
    secondBundleId: second.bundleId || second.orchestrationId || null,
    stateLongitude: state.lastClickedPoint?.longitude ?? null
  };
}

export async function runPointIntelligenceV3Acceptance(mapOperational = false) {
  const bundleClick = await runPointIntelligenceV3BundleClick(mapOperational);
  const authority = await runPointIntelligenceV3AuthorityChecks();
  const stale = await runPointIntelligenceV3StaleBundleStep();
  const modeOff = await (async () => {
    resetPointIntelligenceRequestCount();
    setPointIntelligenceModeEnabled(false);
    const before = getPointIntelligenceRequestCount();
    await runPointIntelligenceQuery(MONTREAL);
    const after = getPointIntelligenceRequestCount();
    return { pass: before === after, before, after };
  })();

  const steps = [
    { id: 'bundle-click', ...bundleClick },
    { id: 'authority', ...authority },
    { id: 'stale-bundle', ...stale },
    { id: 'mode-off', ...modeOff }
  ];
  const passed = steps.filter((step) => step.pass).length;
  const total = steps.length;

  return {
    state: passed === total && bundleClick.pass ? 'PASS' : 'PARTIAL',
    passed,
    failed: total - passed,
    total,
    steps,
    bundleClick,
    authority,
    stale,
    modeOff
  };
}

export function mountPointIntelligenceV3AcceptanceHarness() {
  if (typeof window === 'undefined') return;
  window.__IQAI_RUN_POINT_INTELLIGENCE_V3_ACCEPTANCE__ = runPointIntelligenceV3Acceptance;
  window.__IQAI_POINT_INTELLIGENCE_V3__ = {
    runBundleClick: runPointIntelligenceV3BundleClick,
    getState: getPointIntelligenceState
  };
}
