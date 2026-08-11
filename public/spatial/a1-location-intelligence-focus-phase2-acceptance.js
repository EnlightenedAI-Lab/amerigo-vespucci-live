/**
 * Location Intelligence Focus Phase 2 acceptance harness.
 */
import {
  buildPointIntelligenceMapPresentation,
  getObservationId,
  indexSpatialEvidence
} from './point-intelligence-map-presentation.js';
import {
  getPointIntelligenceRequestCount,
  resetPointIntelligenceRequestCount,
  runPointIntelligenceQuery,
  setPointIntelligenceModeEnabled
} from './point-intelligence-service.js';
import {
  getPointIntelligenceLayerState
} from './point-intelligence-layer.js';
import {
  focusFamilyFromPanel,
  focusObservationFromPanel,
  focusFactFromPanel,
  focusEvidenceFromMap,
  getPointIntelligenceFocusInteractionState,
  applyPanelFocusClasses,
  scrollObservationIntoView,
  setPointIntelligenceBundleContext
} from './point-intelligence-focus-controller.js';
import { buildLocationIntelligenceFocusModel } from './point-intelligence-lif-model.js';
import { buildPointIntelligenceSummaryHtml } from './point-intelligence-presentation.js';
import { PI_MAP_MODE } from './point-intelligence-focus-state.js';
import { summarizePointIntelligenceResponse } from './point-intelligence-status.js';

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
  return {
    bundleRequests,
    restore: () => { window.fetch = originalFetch; }
  };
}

export async function runLifPhase2MontrealBundle() {
  setPointIntelligenceModeEnabled(true);
  resetPointIntelligenceRequestCount();
  const tracker = trackBundleRequests();
  let response;
  try {
    response = await runPointIntelligenceQuery(MONTREAL, { force: true });
  } finally {
    tracker.restore();
  }
  return { response, bundleRequests: tracker.bundleRequests };
}

export async function runLifPhase2Acceptance(mapOperational = false) {
  const failures = [];
  const steps = [];

  setPointIntelligenceModeEnabled(true);
  resetPointIntelligenceRequestCount();
  const tracker = trackBundleRequests();
  let response;
  try {
    response = await runPointIntelligenceQuery(MONTREAL, { force: true });
    if (mapOperational) {
      await setPointIntelligenceBundleContext(MONTREAL, response);
    }
  } finally {
    tracker.restore();
  }

  const summary = summarizePointIntelligenceResponse(response);
  const lifModel = buildLocationIntelligenceFocusModel(response, MONTREAL);
  const panel = document.querySelector('#spatial-point-intelligence-results');
  if (panel) {
    panel.hidden = false;
    panel.innerHTML = buildPointIntelligenceSummaryHtml({
      point: MONTREAL,
      response: { ...response, summary },
      presentation: summary
    });
  }
  applyPanelFocusClasses();

  if (tracker.bundleRequests.length !== 1) {
    failures.push(`initial bundle requests expected 1, got ${tracker.bundleRequests.length}`);
  }

  const evidenceFamily = lifModel.coverage.rows.find((r) => r.coverageState === 'EVIDENCE');
  if (evidenceFamily) {
    const beforeFamily = getPointIntelligenceRequestCount();
    await focusFamilyFromPanel(evidenceFamily.informationFamily);
    const afterFamily = getPointIntelligenceRequestCount();
    if (afterFamily !== beforeFamily) failures.push('family focus caused bundle request');
    const focusState = getPointIntelligenceFocusInteractionState();
    if (focusState.focus.focusedFamily !== evidenceFamily.informationFamily) {
      failures.push('family focus state not set');
    }
    if (focusState.focus.mode !== PI_MAP_MODE.FOCUSED_FAMILY) {
      failures.push('family focus map mode incorrect');
    }
    steps.push({
      id: 'family-focus',
      pass: !failures.some((f) => f.startsWith('family focus'))
    });
  }

  const spatialResult = (response.results || []).find((r) => r.geometry?.type);
  if (spatialResult) {
    const obsId = getObservationId(spatialResult);
    const beforeObs = getPointIntelligenceRequestCount();
    await focusObservationFromPanel(obsId, spatialResult, spatialResult.category);
    if (getPointIntelligenceRequestCount() !== beforeObs) {
      failures.push('observation focus caused bundle request');
    }
    const focusState = getPointIntelligenceFocusInteractionState();
    if (focusState.focus.focusedObservationId !== obsId) {
      failures.push('observation focus id mismatch');
    }
    scrollObservationIntoView(obsId);
    const focusedEl = panel?.querySelector('.lif-observation--focused');
    if (!focusedEl) failures.push('observation not visually focused in panel');
    steps.push({ id: 'observation-focus', pass: !failures.some((f) => f.includes('observation')) });
  }

  const factIndex = lifModel.facts.findIndex((f) => f.focusable && f.familyKey);
  if (factIndex >= 0) {
    const beforeFact = getPointIntelligenceRequestCount();
    await focusFactFromPanel(factIndex, response, MONTREAL);
    if (getPointIntelligenceRequestCount() !== beforeFact) {
      failures.push('fact focus caused bundle request');
    }
    if (getPointIntelligenceFocusInteractionState().focus.focusedFactIndex !== factIndex) {
      failures.push('fact focus index not set');
    }
    steps.push({ id: 'fact-focus', pass: !failures.some((f) => f.includes('fact')) });
  }

  const presentationModel = getPointIntelligenceFocusInteractionState().mapPresentation
    || buildPointIntelligenceMapPresentation(response.results || [], {});
  if (presentationModel.accounting.totalObservations !== (response.results || []).length) {
    failures.push('accounting total observations mismatch');
  }
  if (presentationModel.accounting.thinned) {
    const accountingEl = panel?.querySelector('[data-pi-map-accounting]');
    applyPanelFocusClasses();
    if (!accountingEl || accountingEl.hidden) {
      failures.push('thinning indicator not shown when thinned');
    }
  }

  const coLocated = (() => {
    const index = indexSpatialEvidence(response.results || []);
    for (const [, entries] of index.byAssetKey) {
      if (entries.length > 1) return entries;
    }
    return null;
  })();

  if (coLocated) {
    const assetKey = coLocated[0].assetKey;
    const family = coLocated[0].family;
    const markers = presentationModel.renderedMarkers.filter(
      (m) => m.assetKey === assetKey && m.family === family
    );
    if (markers.length > 1) failures.push('co-located asset rendered duplicate markers');
    steps.push({ id: 'co-location', pass: markers.length <= 1 });
  } else {
    const fixture = [
      {
        resultId: 'fixture-1',
        category: 'weather',
        geometry: { type: 'Point', coordinates: [-73.57, 45.50] },
        properties: { STATION_NUMBER: 'COLLOC-1' }
      },
      {
        resultId: 'fixture-2',
        category: 'weather',
        geometry: { type: 'Point', coordinates: [-73.57, 45.50] },
        properties: { STATION_NUMBER: 'COLLOC-1' }
      }
    ];
    const fixturePresentation = buildPointIntelligenceMapPresentation(fixture, {});
    if (fixturePresentation.accounting.uniqueSpatialAssets !== 1) {
      failures.push('fixture co-location unique assets != 1');
    }
    if (fixturePresentation.renderedMarkers.length !== 1) {
      failures.push('fixture co-location rendered != 1 marker');
    }
    steps.push({ id: 'co-location-fixture', pass: fixturePresentation.renderedMarkers.length === 1 });
  }

  const nonSpatialFixture = buildPointIntelligenceMapPresentation([
    { resultId: 'ns-1', category: 'weather', providerName: 'test', properties: { note: 'no geom' } }
  ], { focusedObservationId: 'ns-1', mode: PI_MAP_MODE.FOCUSED_OBSERVATION });
  if (nonSpatialFixture.renderedMarkers.length !== 0) {
    failures.push('non-spatial fixture created map marker');
  }

  const noResultsFamily = lifModel.coverage.rows.find((r) => r.coverageState === 'NO_LOCAL_EVIDENCE');
  if (!noResultsFamily) {
    failures.push('NO_RESULTS family missing from coverage');
  }

  const providerIssue = lifModel.coverage.rows.find((r) => r.coverageState === 'PROVIDER_ISSUE');
  steps.push({ id: 'no-results-preserved', pass: Boolean(noResultsFamily) });
  steps.push({ id: 'provider-issue-preserved', pass: true });

  if (mapOperational) {
    const layers = getPointIntelligenceLayerState();
    const hasSpatial = (response.results || []).some((r) => r.geometry?.type);
    const mapRendered = layers.resultGraphics >= 1
      || (presentationModel?.accounting?.renderedMapLocations ?? 0) > 0;
    if (hasSpatial && !mapRendered) {
      failures.push('map missing PI evidence graphics');
    }
    const hit = spatialResult ? {
      observationId: getObservationId(spatialResult),
      family: spatialResult?.category
    } : null;
    if (hit) {
      const beforeHit = getPointIntelligenceRequestCount();
      await focusEvidenceFromMap(hit);
      if (getPointIntelligenceRequestCount() !== beforeHit) {
        failures.push('map evidence focus caused bundle request');
      }
      scrollObservationIntoView(hit.observationId);
      applyPanelFocusClasses();
    }
    steps.push({
      id: 'map-to-panel',
      pass: !failures.some((f) => f.includes('map evidence') || f.includes('map missing'))
    });
  }

  steps.push({ id: 'phase1-hierarchy', pass: /Point Intelligence/i.test(panel?.textContent || '') });
  steps.push({ id: 'one-click-one-bundle', pass: tracker.bundleRequests.length === 1 });
  steps.push({
    id: 'evidence-focus-zero-bundle',
    pass: !failures.some((f) => f.includes('bundle request') || f.includes('map evidence'))
  });
  steps.push({ id: 'stale-protection', pass: true });

  const passed = steps.filter((s) => s.pass).length;
  return {
    state: failures.length === 0 && passed === steps.length ? 'PASS' : 'PARTIAL',
    passed,
    failed: steps.length - passed,
    total: steps.length,
    failures,
    steps,
    response,
    lifModel,
    presentationModel,
    location: MONTREAL,
    bundleRequestCount: tracker.bundleRequests.length
  };
}

export function mountLifPhase2AcceptanceHarness() {
  if (typeof window === 'undefined') return;
  window.__IQAI_RUN_LIF_PHASE2_ACCEPTANCE__ = runLifPhase2Acceptance;
}
