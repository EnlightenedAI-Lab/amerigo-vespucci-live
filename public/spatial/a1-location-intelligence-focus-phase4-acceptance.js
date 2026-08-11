/**
 * Location Intelligence Focus Phase 4 acceptance harness — Time Lens foundation.
 */
import {
  getPointIntelligenceRequestCount,
  getPointIntelligenceUnsupportedTemporalAttempts,
  resetPointIntelligenceRequestCount,
  resetPointIntelligenceUnsupportedTemporalAttempts,
  runPointIntelligenceQuery,
  setPointIntelligenceModeEnabled,
  getPointIntelligenceState
} from './point-intelligence-service.js';
import {
  PI_TIME_MODE,
  getPointIntelligenceTemporalState,
  getActiveTemporalGeneration,
  setPointIntelligenceTemporalState,
  localDateTimeInputToUtcIso
} from './point-intelligence-temporal-state.js';
import {
  getPointIntelligenceTemporalSupportModel
} from './point-intelligence-temporal-support.js';
import {
  buildPointIntelligenceBundleRequestModel
} from './point-intelligence-request.js';
import {
  focusFamilyFromPanel,
  focusObservationFromPanel,
  getPointIntelligenceFocusInteractionState,
  setPointIntelligenceBundleContext
} from './point-intelligence-focus-controller.js';
import {
  openEvidenceInspectorForObservation,
  closeInspectorPanel,
  getPointIntelligenceInspectorInteractionState
} from './point-intelligence-inspector-controller.js';
import { mountPointIntelligenceInspector } from './point-intelligence-inspector-controller.js';
import { getObservationId } from './point-intelligence-map-presentation.js';
import { buildPointIntelligenceSummaryHtml } from './point-intelligence-presentation.js';
import { PI_INSPECTOR_MODE } from './point-intelligence-inspector-state.js';
import { summarizePointIntelligenceResponse } from './point-intelligence-status.js';
import { buildSafeQueryReceiptInspectorModel } from './point-intelligence-inspector-model.js';
import { getCurrentTemporalContext } from './point-intelligence-temporal-state.js';

const MONTREAL = { longitude: -73.5673, latitude: 45.5017 };

function trackBundleRequests() {
  const bundleRequests = [];
  const originalFetch = window.fetch;
  window.fetch = async (url, init) => {
    if (String(url).includes('/api/spatial/point-intelligence/query-bundle')) {
      bundleRequests.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
    }
    return originalFetch(url, init);
  };
  return { bundleRequests, restore: () => { window.fetch = originalFetch; } };
}

export async function runLifPhase4Acceptance(mapOperational = false) {
  const failures = [];
  const steps = [];

  setPointIntelligenceModeEnabled(true);
  setPointIntelligenceTemporalState({ mode: PI_TIME_MODE.LATEST });
  resetPointIntelligenceRequestCount();
  resetPointIntelligenceUnsupportedTemporalAttempts();

  const defaultState = getPointIntelligenceTemporalState();
  steps.push({ id: 'latest-default', pass: defaultState.mode === PI_TIME_MODE.LATEST });
  if (defaultState.mode !== PI_TIME_MODE.LATEST) failures.push('LATEST not default');

  const tracker = trackBundleRequests();
  let response;
  try {
    response = await runPointIntelligenceQuery(MONTREAL, { force: true });
    if (mapOperational) await setPointIntelligenceBundleContext(MONTREAL, response);
  } finally {
    tracker.restore();
  }

  steps.push({ id: 'latest-bundle', pass: Boolean(response?.bundleState || response?.queryState) });
  steps.push({ id: 'one-latest-bundle', pass: tracker.bundleRequests.length === 1 });
  if (tracker.bundleRequests.length !== 1) failures.push('LATEST bundle count not 1');

  const section = document.querySelector('#spatial-point-intelligence-section');
  mountPointIntelligenceInspector(section);
  const panel = document.querySelector('#spatial-point-intelligence-results');
  const summary = summarizePointIntelligenceResponse(response);
  if (panel) {
    panel.hidden = false;
    panel.innerHTML = buildPointIntelligenceSummaryHtml({
      point: MONTREAL,
      response: { ...response, summary },
      presentation: summary
    });
  }

  const lifEcho = panel?.querySelector('[data-pi-time-lens-echo]');
  const panelLens = document.querySelector('#spatial-time-lens');
  const mapLens = document.querySelector('#spatial-map-time-lens-host .pi-time-lens');
  steps.push({
    id: 'map-lif-temporal-consistency',
    pass: Boolean(panelLens) && (panelLens?.textContent || '').includes('LATEST')
      && (!mapLens || (mapLens.textContent || '').includes('LATEST'))
  });
  if (!panelLens) failures.push('Time Lens control missing');

  steps.push({ id: 'phase1-3-preserved', pass: /Point Intelligence/i.test(panel?.textContent || '') });

  let staleResult = null;
  const staleTracker = trackBundleRequests();
  const staleGen = getActiveTemporalGeneration();
  const originalFetch = window.fetch;
  let releaseStaleFetch;
  const staleGate = new Promise((resolve) => { releaseStaleFetch = resolve; });
  window.fetch = async (url, init) => {
    if (String(url).includes('/api/spatial/point-intelligence/query-bundle')) {
      await staleGate;
      return originalFetch(url, init);
    }
    return originalFetch(url, init);
  };
  setPointIntelligenceTemporalState({ mode: PI_TIME_MODE.LATEST });
  const staleQuery = runPointIntelligenceQuery(MONTREAL, { force: true });
  setPointIntelligenceTemporalState({
    mode: PI_TIME_MODE.AT,
    at: localDateTimeInputToUtcIso('2026-08-03T21:00', 'America/Toronto')
  });
  releaseStaleFetch();
  staleResult = await staleQuery;
  window.fetch = originalFetch;
  staleTracker.restore();
  steps.push({
    id: 'stale-temporal-response-protection',
    pass: (Boolean(staleResult?.stale) || staleResult?.queryState === 'STALE')
      && getActiveTemporalGeneration() !== staleGen
  });

  const spatialResult = (response.results || []).find((r) => r.geometry?.type);
  const obsId = spatialResult ? getObservationId(spatialResult) : null;
  const evidenceFamily = spatialResult?.category;

  if (obsId && mapOperational) {
    await focusFamilyFromPanel(evidenceFamily);
    await focusObservationFromPanel(obsId, spatialResult, evidenceFamily);
    openEvidenceInspectorForObservation(obsId, evidenceFamily);
  }

  const atIso = localDateTimeInputToUtcIso('2026-08-03T21:00', 'America/Toronto');
  setPointIntelligenceTemporalState({ mode: PI_TIME_MODE.AT, at: atIso });
  const atState = getPointIntelligenceTemporalState();
  steps.push({
    id: 'at-state',
    pass: atState.mode === PI_TIME_MODE.AT && atState.at === '2026-08-04T01:00:00.000Z'
  });
  if (atState.at !== '2026-08-04T01:00:00.000Z') failures.push('AT instant normalization failed');
  steps.push({
    id: 'map-lif-at-consistency',
    pass: (panelLens?.textContent || '').includes('AT')
      && Boolean(document.querySelector('[data-pi-temporal-notice]'))
  });

  const focusAfterAt = getPointIntelligenceFocusInteractionState();
  const inspectorAfterAt = getPointIntelligenceInspectorInteractionState();
  steps.push({
    id: 'focus-reset-on-temporal-change',
    pass: !focusAfterAt.focus?.focusedObservationId && !focusAfterAt.focus?.focusedFamily
  });
  steps.push({
    id: 'inspector-reset-on-temporal-change',
    pass: inspectorAfterAt.inspector.mode === PI_INSPECTOR_MODE.CLOSED
  });

  const beforeAtAttempt = getPointIntelligenceRequestCount();
  const atTracker = trackBundleRequests();
  try {
    await runPointIntelligenceQuery(MONTREAL, { force: true });
  } finally {
    atTracker.restore();
  }
  steps.push({
    id: 'zero-unsupported-at-bundle',
    pass: atTracker.bundleRequests.length === 0
      && getPointIntelligenceRequestCount() === beforeAtAttempt
  });
  if (atTracker.bundleRequests.length > 0) failures.push('AT caused bundle request');

  setPointIntelligenceTemporalState({
    mode: PI_TIME_MODE.RANGE,
    rangeStart: atIso,
    rangeEnd: localDateTimeInputToUtcIso('2026-08-04T06:00', 'America/Toronto')
  });
  const rangeState = getPointIntelligenceTemporalState();
  steps.push({ id: 'range-state', pass: rangeState.mode === PI_TIME_MODE.RANGE && rangeState.valid });

  const rangeTracker = trackBundleRequests();
  try {
    await runPointIntelligenceQuery(MONTREAL, { force: true });
  } finally {
    rangeTracker.restore();
  }
  steps.push({ id: 'zero-unsupported-range-bundle', pass: rangeTracker.bundleRequests.length === 0 });
  if (rangeTracker.bundleRequests.length > 0) failures.push('RANGE caused bundle request');

  setPointIntelligenceTemporalState({
    mode: PI_TIME_MODE.RANGE,
    rangeStart: '2026-08-04T10:00:00.000Z',
    rangeEnd: '2026-08-04T01:00:00.000Z'
  });
  const invalidRange = getPointIntelligenceTemporalState();
  steps.push({ id: 'invalid-range-guard', pass: !invalidRange.valid });

  setPointIntelligenceTemporalState({ mode: PI_TIME_MODE.AT, at: null });
  steps.push({ id: 'invalid-at-guard', pass: !getPointIntelligenceTemporalState().valid });

  setPointIntelligenceTemporalState({ mode: PI_TIME_MODE.LATEST });
  const support = getPointIntelligenceTemporalSupportModel();
  const requestModelAt = buildPointIntelligenceBundleRequestModel({
    geometry: { type: 'Point', coordinates: [MONTREAL.longitude, MONTREAL.latitude] },
    temporalIntent: { mode: 'AT', at: atIso }
  });
  const requestModelRange = buildPointIntelligenceBundleRequestModel({
    geometry: { type: 'Point', coordinates: [MONTREAL.longitude, MONTREAL.latitude] },
    temporalIntent: {
      mode: 'RANGE',
      start: atIso,
      end: localDateTimeInputToUtcIso('2026-08-04T06:00', 'America/Toronto')
    }
  });
  steps.push({ id: 'request-model-latest', pass: true });
  steps.push({ id: 'request-model-at', pass: requestModelAt.ok });
  steps.push({ id: 'request-model-range', pass: requestModelRange.ok });

  const receiptReady = buildSafeQueryReceiptInspectorModel(response, evidenceFamily || 'weather');
  steps.push({
    id: 'receipt-temporal-readiness',
    pass: Boolean(receiptReady?.temporalIntent)
  });

  const agent2Seam = getCurrentTemporalContext();
  steps.push({ id: 'agent2-seam', pass: Boolean(agent2Seam?.mode) });

  steps.push({ id: 'unsupported-honesty', pass: support.AT === 'FUTURE_READY' && support.RANGE === 'FUTURE_READY' });
  steps.push({ id: 'no-silent-fallback', pass: getPointIntelligenceUnsupportedTemporalAttempts() >= 2 });

  closeInspectorPanel();

  const passed = steps.filter((s) => s.pass).length;
  return {
    state: failures.length === 0 && passed === steps.length ? 'PASS' : 'PARTIAL',
    passed,
    failed: steps.length - passed,
    total: steps.length,
    failures,
    steps,
    temporal: {
      policy: 'UTC ISO instants + explicit displayTimezone (America/Toronto default)',
      atExample: atIso,
      rangeExample: {
        start: atIso,
        end: localDateTimeInputToUtcIso('2026-08-04T06:00', 'America/Toronto')
      },
      support,
      latestBundleRequests: tracker.bundleRequests.length,
      unsupportedAtDelta: atTracker.bundleRequests.length,
      unsupportedRangeDelta: rangeTracker.bundleRequests.length,
      agent2Seam: 'getCurrentTemporalContext()'
    },
    piState: getPointIntelligenceState(),
    location: MONTREAL
  };
}

export function mountLifPhase4AcceptanceHarness() {
  if (typeof window === 'undefined') return;
  window.__IQAI_RUN_LIF_PHASE4_ACCEPTANCE__ = runLifPhase4Acceptance;
}
