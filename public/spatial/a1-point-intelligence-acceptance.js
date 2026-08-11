/**
 * Autonomous Point Intelligence UI acceptance harness.
 */
import {
  buildPointIntelligenceRequest
} from './point-intelligence-request.js';
import {
  getPointIntelligenceRequestCount,
  resetPointIntelligenceRequestCount,
  runPointIntelligenceQuery,
  setPointIntelligenceFamily,
  setPointIntelligenceModeEnabled,
  getPointIntelligenceState
} from './point-intelligence-service.js';
import { getPointIntelligenceLayerState } from './point-intelligence-layer.js';
import { summarizePointIntelligenceResponse } from './point-intelligence-status.js';
import {
  buildHydrometricPresentation,
  buildClimatePresentation
} from './point-intelligence-presentation.js';

const MONTREAL = { longitude: -73.5673, latitude: 45.5017 };
const OUTSIDE = { longitude: -30, latitude: 30 };

export function buildPointIntelligenceAcceptanceMatrix() {
  return [
    { id: 'hydrometric-ui', label: 'Montréal HYDROMETRIC click', family: 'hydrometric', point: MONTREAL, expectStates: ['SUCCESS', 'PARTIAL_RESULTS', 'NO_RESULTS'] },
    { id: 'climate-ui', label: 'Montréal CLIMATE click', family: 'climate', point: MONTREAL, expectStates: ['SUCCESS', 'PARTIAL_RESULTS', 'NO_RESULTS'] },
    { id: 'outside-coverage-ui', label: 'Outside coverage', family: 'hydrometric', point: OUTSIDE, expectStates: ['NO_APPLICABLE_CAPABILITY'] },
    { id: 'provider-failure-ui', label: 'Provider failure', mockState: 'PROVIDER_UNAVAILABLE', expectStates: ['PROVIDER_UNAVAILABLE'] },
    { id: 'mode-disabled-ui', label: 'Mode disabled zero requests', modeDisabled: true },
    { id: 'authority-url-ui', label: 'Arbitrary URL authority blocked', authority: 'url' },
    { id: 'authority-capability-ui', label: 'UNVERIFIED capability authority blocked', authority: 'capabilityId' },
    { id: 'stale-response-ui', label: 'Stale response suppression', stale: true }
  ];
}

async function runLiveStep(step, mapOperational = false) {
  setPointIntelligenceModeEnabled(true);
  setPointIntelligenceFamily(step.family);
  const beforeCount = getPointIntelligenceRequestCount();
  const response = await runPointIntelligenceQuery({
    ...step.point,
    informationFamily: step.family
  });
  const summary = summarizePointIntelligenceResponse(response);
  const layers = getPointIntelligenceLayerState();
  const failures = [];
  if (!step.expectStates.includes(response.queryState)) {
    failures.push(`expected ${step.expectStates.join('|')} got ${response.queryState}`);
  }
  if (['SUCCESS', 'PARTIAL_RESULTS'].includes(response.queryState)) {
    if (!summary.queryReceiptId) failures.push('missing queryReceiptId');
    if (!summary.providerName) failures.push('missing provider');
    if (mapOperational && layers.clickGraphics < 1) failures.push('missing click marker');
  }
  const panel = document.querySelector('#spatial-point-intelligence-results');
  const text = panel?.textContent || '';
  if (step.id === 'hydrometric-ui' && ['SUCCESS', 'PARTIAL_RESULTS'].includes(response.queryState)) {
    const first = response.results?.[0];
    if (first) {
      const card = buildHydrometricPresentation(first);
      if (!text.includes(card.title)) failures.push('station name not visible in panel');
      if (!text.includes('Hydrometric station registry')) failures.push('missing hydrometric honesty label');
      if (first.clickDistanceMeters != null && !/\d+(\.\d+)? (m|km) away/.test(text)) {
        failures.push('distance not visible');
      }
      if (card.nativeRecordId && text.indexOf(card.nativeRecordId) < text.indexOf(card.title)) {
        failures.push('native id appears before station name');
      }
      if (/water[- ]level|flow observation/i.test(text) && !/No water-level or flow observation/.test(text)) {
        failures.push('implies water-level or flow data');
      }
    }
    if (summary.resultCount != null && !text.includes(String(summary.resultCount))) {
      failures.push('result count not reflected in panel');
    }
  }
  if (step.id === 'climate-ui') {
    if (/\b(LIVE|CURRENT WEATHER|NOW)\b/i.test(text)) failures.push('false live/current labeling');
    if (['SUCCESS', 'PARTIAL_RESULTS'].includes(response.queryState)) {
      const first = response.results?.[0];
      if (first) {
        const card = buildClimatePresentation(first);
        if (!text.includes(card.title)) failures.push('climate station name not visible');
        if (card.observationDate && !text.includes(card.observationDate)) {
          failures.push('observation date not visible');
        }
        if (first.clickDistanceMeters != null && !/\d+(\.\d+)? (m|km) away/.test(text)) {
          failures.push('climate distance not visible');
        }
        if (card.honestyLabel && !text.includes(card.honestyLabel)) {
          failures.push('missing climate temporal honesty label');
        }
      }
    }
  }
  return {
    pass: failures.length === 0,
    failures,
    response,
    summary,
    layers,
    requestDelta: getPointIntelligenceRequestCount() - beforeCount
  };
}

async function runMockProviderFailure() {
  const originalFetch = window.fetch;
  window.fetch = async (url, init) => {
    if (String(url).includes('/api/spatial/point-intelligence/query')) {
      return new Response(JSON.stringify({
        queryState: 'PROVIDER_UNAVAILABLE',
        resultCount: 0,
        results: []
      }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    }
    return originalFetch(url, init);
  };
  try {
    setPointIntelligenceModeEnabled(true);
    const response = await runPointIntelligenceQuery({
      ...MONTREAL,
      informationFamily: 'hydrometric'
    });
    const pass = response.queryState === 'PROVIDER_UNAVAILABLE';
    return { pass, failures: pass ? [] : [`expected PROVIDER_UNAVAILABLE got ${response.queryState}`], response };
  } finally {
    window.fetch = originalFetch;
  }
}

function runAuthorityStep(kind) {
  const payload = kind === 'url'
    ? { url: 'https://evil.example', geometry: { type: 'Point', coordinates: [-73.5, 45.5] } }
    : { capabilityId: 'fake-capability', geometry: { type: 'Point', coordinates: [-73.5, 45.5] } };
  const built = buildPointIntelligenceRequest(payload);
  const pass = !built.ok;
  return {
    pass,
    failures: pass ? [] : ['authority field was accepted'],
    built
  };
}

async function runModeDisabledStep() {
  resetPointIntelligenceRequestCount();
  setPointIntelligenceModeEnabled(false);
  const before = getPointIntelligenceRequestCount();
  await runPointIntelligenceQuery(MONTREAL);
  const after = getPointIntelligenceRequestCount();
  const pass = before === after;
  return { pass, failures: pass ? [] : [`expected 0 requests, delta=${after - before}`], before, after };
}

async function runStaleStep() {
  setPointIntelligenceModeEnabled(true);
  const first = runPointIntelligenceQuery({ ...MONTREAL, informationFamily: 'hydrometric' });
  const second = await runPointIntelligenceQuery({
    ...MONTREAL,
    longitude: MONTREAL.longitude + 0.01,
    informationFamily: 'hydrometric'
  });
  await first;
  const state = getPointIntelligenceState();
  const pass = state.lastClickedPoint?.longitude > MONTREAL.longitude;
  return { pass, failures: pass ? [] : ['stale first response overwrote newer query'], state };
}

export async function runPointIntelligenceAcceptanceStep(step, mapOperational = false) {
  if (step.authority) return runAuthorityStep(step.authority);
  if (step.modeDisabled) return runModeDisabledStep();
  if (step.mockState) return runMockProviderFailure();
  if (step.stale) return runStaleStep();
  return runLiveStep(step, mapOperational);
}

export async function runPointIntelligenceAcceptance(mapOperational = false) {
  const steps = buildPointIntelligenceAcceptanceMatrix();
  const results = [];
  for (const step of steps) {
    const outcome = await runPointIntelligenceAcceptanceStep(step, mapOperational);
    results.push({ id: step.id, label: step.label, ...outcome });
  }
  const passed = results.filter((r) => r.pass).length;
  return {
    state: passed === results.length ? 'PASS' : 'PARTIAL',
    passed,
    failed: results.length - passed,
    total: results.length,
    steps: results
  };
}

export function mountPointIntelligenceAcceptanceHarness(app) {
  if (typeof window === 'undefined') return;
  window.__IQAI_RUN_POINT_INTELLIGENCE_ACCEPTANCE__ = async (mapOperational = false) => (
    runPointIntelligenceAcceptance(mapOperational)
  );
  window.__IQAI_POINT_INTELLIGENCE__ = {
    getState: getPointIntelligenceState,
    getRequestCount: getPointIntelligenceRequestCount,
    resetRequestCount: resetPointIntelligenceRequestCount,
    runQuery: runPointIntelligenceQuery,
    setMode: setPointIntelligenceModeEnabled,
    setFamily: setPointIntelligenceFamily,
    getLayerState: getPointIntelligenceLayerState
  };
}
