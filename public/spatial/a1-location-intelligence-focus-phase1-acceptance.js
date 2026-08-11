/**
 * Location Intelligence Focus Phase 1 acceptance harness.
 */
import {
  buildLocationIntelligenceFocusModel
} from './point-intelligence-lif-model.js';
import {
  buildPointIntelligenceSummaryHtml
} from './point-intelligence-presentation.js';
import {
  getPointIntelligenceRequestCount,
  resetPointIntelligenceRequestCount,
  runPointIntelligenceQuery,
  setPointIntelligenceModeEnabled,
  getPointIntelligenceState
} from './point-intelligence-service.js';
import { getPointIntelligenceLayerState } from './point-intelligence-layer.js';
import { summarizePointIntelligenceResponse } from './point-intelligence-status.js';

const MONTREAL = { longitude: -73.5673, latitude: 45.5017 };

export async function runLifPhase1MontrealClick(mapOperational = false) {
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
  const lifModel = buildLocationIntelligenceFocusModel(response, MONTREAL);
  const layers = getPointIntelligenceLayerState();
  const failures = [];

  const panel = document.querySelector('#spatial-point-intelligence-results');
  const html = buildPointIntelligenceSummaryHtml({
    point: MONTREAL,
    response: { ...response, summary },
    presentation: getPointIntelligenceState().summary
  });
  if (panel) panel.innerHTML = html;
  const text = panel?.textContent || '';

  if (!/Point Intelligence/i.test(text)) failures.push('missing LIF header');
  if (!/45\.50170/.test(text) || !/-73\.56730/.test(text)) failures.push('missing coordinates');
  if (!/(3\.00 km|3000 m) radius/i.test(text)) failures.push('missing radius');
  if (!new RegExp(`${lifModel.summary.familiesChecked}`).test(text)) failures.push('families checked not shown');
  if (!new RegExp(`${lifModel.summary.familiesWithEvidence}`).test(text)) failures.push('evidence count not shown');
  if (lifModel.summary.familiesWithoutLocalEvidence > 0 && !/No local evidence/i.test(text)) {
    failures.push('no-evidence families not shown');
  }
  if (lifModel.summary.healthyPartial && /error|failed/i.test(panel?.querySelector('.lif-summary__headline')?.className || '')) {
    failures.push('healthy partial styled as error');
  }
  if (!/Coverage/i.test(text)) failures.push('missing coverage strip');
  if (!/Selected location/i.test(text)) failures.push('missing selected location synthesis');
  if (!/Current conditions/i.test(text)) failures.push('missing current conditions synthesis');
  if (lifModel.coverage.domains.length < 1) failures.push('missing domain grouping');
  if (bundleRequests.length !== 1) failures.push(`expected 1 bundle request, got ${bundleRequests.length}`);
  if (getPointIntelligenceRequestCount() - beforeCount !== 1) failures.push('request count not 1');
  if (!/Query receipt/i.test(text)) failures.push('receipt not accessible');
  if (/iqai\.pi\.bundle\./i.test(text)) failures.push('bundle UUID in primary view');
  if (mapOperational && layers.clickGraphics < 1) failures.push('missing click marker');

  const familyDetails = panel?.querySelector('.lif-family');
  if (familyDetails && !familyDetails.open) {
    familyDetails.open = true;
  }
  const expandedText = panel?.textContent || '';
  if (lifModel.summary.familiesWithEvidence > 0 && !/MSC GeoMet|Station|Temperature|Weather/i.test(expandedText)) {
    failures.push('observation detail not available after expand');
  }

  return {
    pass: failures.length === 0,
    failures,
    response,
    lifModel,
    summary,
    layers,
    bundleRequests,
    htmlSnippet: text.slice(0, 500),
    location: MONTREAL,
    radiusMeters: 3000
  };
}

export async function runLifPhase1Acceptance(mapOperational = false) {
  const montreal = await runLifPhase1MontrealClick(mapOperational);
  const steps = [{ id: 'montreal-lif', ...montreal }];
  const passed = steps.filter((s) => s.pass).length;
  return {
    state: passed === steps.length ? 'PASS' : 'PARTIAL',
    passed,
    failed: steps.length - passed,
    total: steps.length,
    steps,
    montreal
  };
}

export function mountLifPhase1AcceptanceHarness() {
  if (typeof window === 'undefined') return;
  window.__IQAI_RUN_LIF_PHASE1_ACCEPTANCE__ = runLifPhase1Acceptance;
}
