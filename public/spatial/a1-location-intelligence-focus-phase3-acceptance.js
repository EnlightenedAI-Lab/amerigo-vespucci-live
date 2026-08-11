/**
 * Location Intelligence Focus Phase 3 acceptance harness.
 */
import {
  getPointIntelligenceRequestCount,
  resetPointIntelligenceRequestCount,
  runPointIntelligenceQuery,
  setPointIntelligenceModeEnabled
} from './point-intelligence-service.js';
import {
  focusEvidenceFromMap,
  focusObservationFromPanel,
  getPointIntelligenceFocusInteractionState,
  setPointIntelligenceBundleContext
} from './point-intelligence-focus-controller.js';
import {
  openEvidenceInspectorForObservation,
  openReceiptInspectorForFamily,
  closeInspectorPanel,
  getPointIntelligenceInspectorInteractionState,
  buildSafeEvidenceInspectorModel,
  buildSafeQueryReceiptInspectorModel,
  buildProviderIssueReceiptFixture,
  assertNoSecretsExposed
} from './point-intelligence-inspector-controller.js';
import { getObservationId } from './point-intelligence-map-presentation.js';
import { buildPointIntelligenceSummaryHtml } from './point-intelligence-presentation.js';
import { PI_INSPECTOR_MODE } from './point-intelligence-inspector-state.js';
import { summarizePointIntelligenceResponse } from './point-intelligence-status.js';
import { mountPointIntelligenceInspector } from './point-intelligence-inspector-controller.js';

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

export async function runLifPhase3Acceptance(mapOperational = false) {
  const failures = [];
  const steps = [];

  setPointIntelligenceModeEnabled(true);
  resetPointIntelligenceRequestCount();
  const tracker = trackBundleRequests();
  let response;
  try {
    response = await runPointIntelligenceQuery(MONTREAL, { force: true });
    if (mapOperational) await setPointIntelligenceBundleContext(MONTREAL, response);
  } finally {
    tracker.restore();
  }

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

  const spatialResult = (response.results || []).find((r) => r.geometry?.type);
  const obsId = spatialResult ? getObservationId(spatialResult) : null;
  const evidenceFamily = spatialResult?.category;

  if (obsId) {
    const before = getPointIntelligenceRequestCount();
    openEvidenceInspectorForObservation(obsId, evidenceFamily);
    if (getPointIntelligenceRequestCount() !== before) failures.push('evidence inspector caused bundle request');
    const state = getPointIntelligenceInspectorInteractionState();
    if (state.inspector.mode !== PI_INSPECTOR_MODE.EVIDENCE) failures.push('evidence inspector not open');
    if (state.evidenceModel?.observationId !== obsId) failures.push('inspector observation ID mismatch');
    if (state.evidenceModel?.informationFamily !== evidenceFamily) failures.push('inspector family mismatch');
    const receipt = buildSafeQueryReceiptInspectorModel(response, evidenceFamily);
    if (state.evidenceModel?.queryReceiptId !== receipt?.queryReceiptId) {
      failures.push('evidence receipt linkage mismatch');
    }
    steps.push({ id: 'evidence-inspector', pass: !failures.some((f) => f.includes('inspector') || f.includes('evidence')) });

    const beforeReceipt = getPointIntelligenceRequestCount();
    openReceiptInspectorForFamily(evidenceFamily, receipt?.queryReceiptId);
    if (getPointIntelligenceRequestCount() !== beforeReceipt) failures.push('receipt inspector caused bundle request');
    const receiptState = getPointIntelligenceInspectorInteractionState();
    if (receiptState.inspector.mode !== PI_INSPECTOR_MODE.RECEIPT) failures.push('receipt inspector not open');
    if (!receiptState.receiptModel?.governed) failures.push('receipt not governed');
    if (!receiptState.receiptModel?.queryReceiptId) failures.push('missing receipt id');
    steps.push({ id: 'receipt-inspector', pass: !failures.some((f) => f.includes('receipt')) });
  }

  const familiesWithEvidence = Object.values(response.families || {}).filter((f) => f.hasEvidence);
  if (familiesWithEvidence.length >= 2) {
    const a = buildSafeQueryReceiptInspectorModel(response, familiesWithEvidence[0].informationFamily);
    const b = buildSafeQueryReceiptInspectorModel(response, familiesWithEvidence[1].informationFamily);
    if (!a?.queryReceiptId || !b?.queryReceiptId || a.queryReceiptId === b.queryReceiptId) {
      failures.push('distinct receipts not proven');
    }
    steps.push({ id: 'distinct-receipts', pass: a?.queryReceiptId !== b?.queryReceiptId });
  }

  const noResultsFamily = Object.values(response.families || {}).find((f) => f.queryState === 'NO_RESULTS');
  if (noResultsFamily) {
    const receipt = buildSafeQueryReceiptInspectorModel(response, noResultsFamily.informationFamily);
    openReceiptInspectorForFamily(noResultsFamily.informationFamily, receipt?.queryReceiptId);
    if (!receipt?.queryReceiptId) failures.push('NO_RESULTS missing receipt');
    if (receipt?.resultCount !== 0) failures.push('NO_RESULTS result count not zero');
    if (/provider issue/i.test(receipt?.executionStatus || '')) failures.push('NO_RESULTS styled as provider issue');
    steps.push({ id: 'no-results-receipt', pass: !failures.some((f) => f.includes('NO_RESULTS')) });
  } else {
    steps.push({ id: 'no-results-receipt', pass: true, note: 'no live NO_RESULTS family in current bundle' });
  }

  const providerIssue = buildProviderIssueReceiptFixture();
  if (!/provider issue/i.test(providerIssue.executionStatus)) failures.push('provider issue fixture failed');
  if (!assertNoSecretsExposed(providerIssue)) failures.push('provider issue fixture leaked secrets');
  steps.push({ id: 'provider-issue-fixture', pass: !failures.some((f) => f.includes('provider issue fixture')) });

  const secretFixture = buildSafeQueryReceiptInspectorModel({
    families: { weather: { queryState: 'SUCCESS', queryReceiptId: 'r', error: { authorization: 'Bearer x', apiKey: 'k' } } },
    queryReceipts: [{ informationFamily: 'weather', queryReceiptId: 'r', queryState: 'SUCCESS' }],
    request: { radiusMeters: 3000 }
  }, 'weather');
  const secretHtml = document.querySelector('#lif-inspector-host')?.textContent || '';
  if (!assertNoSecretsExposed({ secretFixture, secretHtml })) failures.push('secret exposure detected');
  steps.push({ id: 'secret-redaction', pass: !failures.some((f) => f.includes('secret')) });

  const nonSpatial = {
    resultId: 'iqai.pi.result.nonspatial',
    category: 'weather',
    providerName: 'fixture',
    properties: { note: 'no geometry' }
  };
  const nsModel = buildSafeEvidenceInspectorModel({
    results: [nonSpatial],
    families: { weather: { results: [nonSpatial], queryReceiptId: 'r', queryState: 'SUCCESS', hasEvidence: true } }
  }, 'iqai.pi.result.nonspatial');
  if (nsModel.hasGeometry) failures.push('non-spatial fixture has geometry');
  steps.push({ id: 'non-spatial-inspector', pass: !nsModel.hasGeometry });

  if (mapOperational && obsId && spatialResult) {
    const beforeMap = getPointIntelligenceRequestCount();
    await focusEvidenceFromMap({ observationId: obsId, family: evidenceFamily });
    openEvidenceInspectorForObservation(obsId, evidenceFamily);
    const linked = getPointIntelligenceInspectorInteractionState();
    if (linked.evidenceModel?.observationId !== obsId) failures.push('map inspector identity drift');
    const beforeFocus = getPointIntelligenceRequestCount();
    await focusObservationFromPanel(obsId, spatialResult, evidenceFamily);
    if (getPointIntelligenceRequestCount() !== beforeFocus) failures.push('focus on map caused bundle request');
    steps.push({ id: 'map-inspector-link', pass: !failures.some((f) => f.includes('map inspector') || f.includes('focus on map')) });
  }

  closeInspectorPanel();
  if (getPointIntelligenceInspectorInteractionState().inspector.mode !== PI_INSPECTOR_MODE.CLOSED) {
    failures.push('inspector did not close');
  }

  steps.push({ id: 'phase1-hierarchy', pass: /Point Intelligence/i.test(panel?.textContent || '') });
  steps.push({ id: 'phase2-focus-preserved', pass: Boolean(getPointIntelligenceFocusInteractionState().response) });
  steps.push({ id: 'one-click-one-bundle', pass: tracker.bundleRequests.length === 1 });
  steps.push({ id: 'inspector-zero-bundle', pass: !failures.some((f) => f.includes('bundle request')) });

  const passed = steps.filter((s) => s.pass).length;
  return {
    state: failures.length === 0 && passed === steps.length ? 'PASS' : 'PARTIAL',
    passed,
    failed: steps.length - passed,
    total: steps.length,
    failures,
    steps,
    response,
    distinctReceipts: familiesWithEvidence.length >= 2
      ? {
        a: buildSafeQueryReceiptInspectorModel(response, familiesWithEvidence[0].informationFamily)?.queryReceiptId,
        b: buildSafeQueryReceiptInspectorModel(response, familiesWithEvidence[1].informationFamily)?.queryReceiptId
      }
      : null,
    noResultsFamily: noResultsFamily?.informationFamily || null,
    location: MONTREAL
  };
}

export function mountLifPhase3AcceptanceHarness() {
  if (typeof window === 'undefined') return;
  window.__IQAI_RUN_LIF_PHASE3_ACCEPTANCE__ = runLifPhase3Acceptance;
  window.__IQAI_BUILD_PROVIDER_ISSUE_RECEIPT_FIXTURE__ = buildProviderIssueReceiptFixture;
}
