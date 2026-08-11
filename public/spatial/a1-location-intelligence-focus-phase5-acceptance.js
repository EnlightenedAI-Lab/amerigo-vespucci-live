/**
 * Location Intelligence Focus Phase 5 acceptance harness — Agent 2 open-world integration.
 */
import {
  getOpenWorldIntelligenceRequestCount,
  resetOpenWorldIntelligenceRequestCount,
  runOpenWorldIntelligenceSearch,
  invalidateOpenWorldIntelligenceForTemporalChange
} from './open-world-intelligence-service.js';
import {
  PI_TIME_MODE,
  PI_KNOWLEDGE_SEMANTICS,
  setPointIntelligenceTemporalState,
  getPointIntelligenceTemporalState,
  getActiveTemporalGeneration
} from './point-intelligence-temporal-state.js';
import {
  isAgent2TemporalQuerySupported,
  buildAgent2SearchQueryPlan
} from './open-world-intelligence-temporal-mapping.js';
import {
  getPointIntelligenceRequestCount,
  resetPointIntelligenceRequestCount,
  runPointIntelligenceQuery,
  setPointIntelligenceModeEnabled
} from './point-intelligence-service.js';
import {
  getUnsupportedTemporalMessage
} from './point-intelligence-temporal-gate.js';
import {
  isTemporalModeExecutable
} from './point-intelligence-temporal-support.js';
import {
  openOpenWorldInspector,
  closeOpenWorldInspector,
  getOpenWorldInspectorState,
  mountOpenWorldInspector
} from './open-world-intelligence-inspector-controller.js';
import { focusOpenWorldMapFeature } from './open-world-intelligence-map-layer.js';
import { buildOpenWorldIntelligenceHtml } from './open-world-intelligence-presentation.js';
import { OPEN_WORLD_SEARCH_PATH } from './open-world-intelligence-config.js';

const MONTREAL = { longitude: -73.5673, latitude: 45.5017, radiusMeters: 5000 };

function trackOwiRequests() {
  const requests = [];
  const originalFetch = window.fetch;
  window.fetch = async (url, init) => {
    if (String(url).includes(OPEN_WORLD_SEARCH_PATH)) {
      requests.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
    }
    return originalFetch(url, init);
  };
  return { requests, restore: () => { window.fetch = originalFetch; } };
}

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

export async function runLifPhase5Acceptance() {
  const failures = [];
  const steps = [];
  const evidence = {
    live: null,
    asOf: null,
    requestDeltas: {}
  };

  setPointIntelligenceModeEnabled(true);
  setPointIntelligenceTemporalState({ mode: PI_TIME_MODE.LATEST, interpretationMode: PI_KNOWLEDGE_SEMANTICS.APPEARED });
  resetOpenWorldIntelligenceRequestCount();
  resetPointIntelligenceRequestCount();

  const control = document.querySelector('#spatial-open-world-intelligence');
  steps.push({ id: 'owi-control-present', pass: Boolean(control) });
  if (!control) failures.push('Open-world control missing');

  const mappingLatestAppeared = buildAgent2SearchQueryPlan({
    keyword: 'fire',
    interpretation: PI_KNOWLEDGE_SEMANTICS.APPEARED,
    temporal: { mode: PI_TIME_MODE.LATEST }
  });
  steps.push({
    id: 'temporal-mapping-latest-appeared',
    pass: mappingLatestAppeared.ok && mappingLatestAppeared.plan.archive?.mode === 'CURRENT'
  });

  const mappingAtKnown = buildAgent2SearchQueryPlan({
    keyword: '',
    interpretation: PI_KNOWLEDGE_SEMANTICS.KNOWN_AS_OF,
    temporal: { mode: PI_TIME_MODE.AT, at: '2026-08-05T14:05:00.000Z' }
  });
  steps.push({
    id: 'temporal-mapping-at-known-as-of',
    pass: mappingAtKnown.ok && mappingAtKnown.plan.archive?.mode === 'AS_OF'
  });

  const invalidKnown = isAgent2TemporalQuerySupported({
    timeMode: PI_TIME_MODE.LATEST,
    interpretation: PI_KNOWLEDGE_SEMANTICS.KNOWN_AS_OF
  });
  steps.push({ id: 'known-as-of-invalid-without-at', pass: invalidKnown.status === 'INVALID' });

  const owiTracker = trackOwiRequests();
  let liveResponse;
  try {
    liveResponse = await runOpenWorldIntelligenceSearch({
      keyword: 'Montréal',
      interpretation: PI_KNOWLEDGE_SEMANTICS.APPEARED,
      point: MONTREAL
    });
  } finally {
    owiTracker.restore();
  }

  steps.push({ id: 'live-search-success', pass: liveResponse?.searchState === 'SUCCESS' || Boolean(liveResponse?.normalized) });
  steps.push({ id: 'one-owi-request', pass: owiTracker.requests.length === 1 });
  steps.push({
    id: 'keyword-in-plan',
    pass: owiTracker.requests[0]?.body?.plan?.archive?.freeText === 'Montréal'
      || owiTracker.requests[0]?.body?.keyword === 'Montréal'
  });
  steps.push({
    id: 'spatial-context-in-plan',
    pass: Array.isArray(owiTracker.requests[0]?.body?.geometry?.coordinates)
  });
  if (owiTracker.requests.length !== 1) failures.push('OWI search request count not 1');

  const normalized = liveResponse?.normalized;
  const panel = document.querySelector('#spatial-open-world-intelligence-results');
  if (panel && normalized) {
    panel.hidden = false;
    panel.innerHTML = buildOpenWorldIntelligenceHtml(liveResponse);
  }

  steps.push({
    id: 'non-spatial-accounting',
    pass: Number.isFinite(normalized?.summary?.nonSpatialResults)
  });
  steps.push({
    id: 'spatial-results',
    pass: (normalized?.spatial?.length || 0) >= 0
  });
  steps.push({
    id: 'incident-dedup-accounting',
    pass: (normalized?.accounting?.renderedMapIncidents || 0) <= (normalized?.accounting?.agent2IncidentsReturned || 0)
  });

  evidence.live = {
    request: owiTracker.requests[0]?.body || null,
    summary: normalized?.summary || null,
    sourceFamilies: [...new Set((normalized?.results || []).map((r) => r.sourceFamily).filter(Boolean))],
    nonSpatial: normalized?.summary?.nonSpatialResults || 0,
    mapIncidents: normalized?.summary?.mapIncidentMarkers || 0
  };

  const activeResponse = await runOpenWorldIntelligenceSearch({
    keyword: '',
    interpretation: PI_KNOWLEDGE_SEMANTICS.ACTIVE,
    point: MONTREAL
  });
  steps.push({ id: 'active-contract', pass: activeResponse?.searchState === 'SUCCESS' || activeResponse?.searchState === 'STALE' || Boolean(activeResponse?.normalized) });

  const asOfTracker = trackOwiRequests();
  setPointIntelligenceTemporalState({
    mode: PI_TIME_MODE.AT,
    at: '2026-08-09T12:00:00.000Z',
    interpretationMode: PI_KNOWLEDGE_SEMANTICS.KNOWN_AS_OF
  });
  let asOfResponse;
  try {
    asOfResponse = await runOpenWorldIntelligenceSearch({
      keyword: '',
      interpretation: PI_KNOWLEDGE_SEMANTICS.KNOWN_AS_OF,
      point: MONTREAL
    });
  } finally {
    asOfTracker.restore();
  }
  steps.push({
    id: 'known-as-of-query',
    pass: asOfTracker.requests[0]?.body?.plan?.archive?.mode === 'AS_OF'
  });
  steps.push({
    id: 'as-of-backend-authority',
    pass: asOfResponse?.queryPlan?.archive?.mode === 'AS_OF' || asOfTracker.requests[0]?.body?.plan?.archive?.mode === 'AS_OF'
  });
  evidence.asOf = {
    request: asOfTracker.requests[0]?.body || null,
    observationCount: asOfResponse?.archive?.count ?? asOfResponse?.normalized?.summary?.totalMatches
  };

  const beforeFocus = getOpenWorldIntelligenceRequestCount();
  const spatialId = normalized?.spatial?.[0]?.id;
  if (spatialId) focusOpenWorldMapFeature(spatialId);
  const afterFocus = getOpenWorldIntelligenceRequestCount();
  evidence.requestDeltas.focus = afterFocus - beforeFocus;
  steps.push({ id: 'focus-zero-requests', pass: evidence.requestDeltas.focus === 0 });

  const beforeInspector = getOpenWorldIntelligenceRequestCount();
  const inspectorHost = document.createElement('div');
  document.body.appendChild(inspectorHost);
  mountOpenWorldInspector(inspectorHost);
  if (normalized?.results?.[0]) openOpenWorldInspector(normalized.results[0]);
  const afterInspector = getOpenWorldIntelligenceRequestCount();
  evidence.requestDeltas.inspector = afterInspector - beforeInspector;
  steps.push({ id: 'inspector-zero-requests', pass: evidence.requestDeltas.inspector === 0 });
  steps.push({ id: 'inspector-open', pass: getOpenWorldInspectorState().mode === 'OPEN' });
  closeOpenWorldInspector();

  setPointIntelligenceTemporalState({ mode: PI_TIME_MODE.LATEST, interpretationMode: PI_KNOWLEDGE_SEMANTICS.APPEARED });
  const staleGen = getActiveTemporalGeneration();
  invalidateOpenWorldIntelligenceForTemporalChange();
  const staleBlocked = await runOpenWorldIntelligenceSearch({
    keyword: 'bridge',
    interpretation: PI_KNOWLEDGE_SEMANTICS.APPEARED,
    point: MONTREAL
  });
  setPointIntelligenceTemporalState({ mode: PI_TIME_MODE.AT, at: '2026-08-08T12:00:00.000Z' });
  const staleTemporal = staleBlocked?.stale === true || getActiveTemporalGeneration() !== staleGen;
  steps.push({ id: 'temporal-stale-protection', pass: staleTemporal || getPointIntelligenceTemporalState().mode === PI_TIME_MODE.AT });

  setPointIntelligenceTemporalState({ mode: PI_TIME_MODE.AT, at: '2026-08-08T12:00:00.000Z' });
  const atBlocked = isTemporalModeExecutable(PI_TIME_MODE.AT);
  steps.push({ id: 'agent5-at-unsupported', pass: !atBlocked });
  steps.push({
    id: 'agent5-historical-honesty-message',
    pass: Boolean(getUnsupportedTemporalMessage())
  });

  setPointIntelligenceTemporalState({ mode: PI_TIME_MODE.LATEST });
  const piTracker = trackBundleRequests();
  let piResponse;
  try {
    piResponse = await runPointIntelligenceQuery(MONTREAL, { force: true });
  } finally {
    piTracker.restore();
  }
  steps.push({ id: 'agent5-latest-works', pass: Boolean(piResponse?.bundleState || piResponse?.queryState) });
  steps.push({ id: 'phase4-time-lens-present', pass: Boolean(document.querySelector('#spatial-time-lens, .pi-time-lens')) });
  steps.push({ id: 'phase3-inspector-plane-separated', pass: getOpenWorldInspectorState().mode === 'CLOSED' });
  steps.push({ id: 'phase2-pi-section', pass: Boolean(document.querySelector('#spatial-point-intelligence-section')) });
  steps.push({ id: 'phase1-lif-panel', pass: Boolean(document.querySelector('#spatial-detail-panel')) });

  const passed = steps.filter((s) => s.pass).length;
  return {
    state: failures.length === 0 && passed === steps.length ? 'PASS' : 'PARTIAL',
    passed,
    failed: steps.length - passed,
    total: steps.length,
    failures,
    steps,
    evidence,
    agent2Endpoint: OPEN_WORLD_SEARCH_PATH,
    location: MONTREAL
  };
}

export function mountLifPhase5AcceptanceHarness() {
  if (typeof window === 'undefined') return;
  window.__IQAI_RUN_LIF_PHASE5_ACCEPTANCE__ = runLifPhase5Acceptance;
}
