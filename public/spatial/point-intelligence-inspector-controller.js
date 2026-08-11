/**
 * Point Intelligence inspector controller — plugs into Phase 2 focus model.
 */
import {
  openEvidenceInspector,
  openReceiptInspector,
  closePointIntelligenceInspector,
  getPointIntelligenceInspectorState,
  subscribePointIntelligenceInspectorState,
  resetPointIntelligenceInspectorState,
  getInspectorQueryGeneration,
  PI_INSPECTOR_MODE
} from './point-intelligence-inspector-state.js';
import {
  buildSafeEvidenceInspectorModel,
  buildSafeQueryReceiptInspectorModel,
  resolveReceiptForObservation
} from './point-intelligence-inspector-model.js';
import {
  renderEvidenceInspectorHtml,
  renderReceiptInspectorHtml
} from './point-intelligence-inspector-presentation.js';
import {
  focusObservationFromPanel,
  getPointIntelligenceFocusInteractionState
} from './point-intelligence-focus-controller.js';
import { getActiveQueryGeneration } from './point-intelligence-focus-state.js';

let hostEl = null;
let sectionEl = null;
let lastResponse = null;

/** @type {Set<(payload: object) => void>} */
const listeners = new Set();

function emit() {
  const state = getPointIntelligenceInspectorState();
  const payload = {
    inspector: state,
    evidenceModel: state.mode === PI_INSPECTOR_MODE.EVIDENCE && state.observationId
      ? buildSafeEvidenceInspectorModel(lastResponse, state.observationId)
      : null,
    receiptModel: state.mode === PI_INSPECTOR_MODE.RECEIPT && state.family
      ? buildSafeQueryReceiptInspectorModel(lastResponse, state.family, state.queryReceiptId)
      : null
  };
  for (const listener of listeners) {
    try { listener(payload); } catch { /* ignore */ }
  }
}

function renderInspector() {
  hostEl = sectionEl?.querySelector('#lif-inspector-host');
  if (!hostEl) return;
  const state = getPointIntelligenceInspectorState();
  if (state.mode === PI_INSPECTOR_MODE.CLOSED) {
    hostEl.hidden = true;
    hostEl.innerHTML = '';
    sectionEl?.classList.remove('lif-section--inspector-open');
    return;
  }

  let html = '';
  if (state.mode === PI_INSPECTOR_MODE.EVIDENCE && state.observationId) {
    const model = buildSafeEvidenceInspectorModel(lastResponse, state.observationId);
    html = renderEvidenceInspectorHtml(model);
  } else if (state.mode === PI_INSPECTOR_MODE.RECEIPT && state.family) {
    const model = buildSafeQueryReceiptInspectorModel(lastResponse, state.family, state.queryReceiptId);
    html = renderReceiptInspectorHtml(model);
  }

  hostEl.hidden = false;
  hostEl.innerHTML = html;
  sectionEl?.classList.add('lif-section--inspector-open');
  emit();
}

export function setPointIntelligenceInspectorBundleContext(response) {
  lastResponse = response;
  const generation = response?.queryGroupId ?? getActiveQueryGeneration();
  resetPointIntelligenceInspectorState(generation);
  renderInspector();
}

export function subscribePointIntelligenceInspectorUi(listener) {
  listeners.add(listener);
  listener({
    inspector: getPointIntelligenceInspectorState(),
    evidenceModel: null,
    receiptModel: null
  });
  return () => listeners.delete(listener);
}

export function openEvidenceInspectorForObservation(observationId, family = null) {
  const generation = getInspectorQueryGeneration() || getActiveQueryGeneration();
  openEvidenceInspector(observationId, family, generation);
  renderInspector();
}

export function openReceiptInspectorForFamily(family, receiptId = null) {
  const generation = getInspectorQueryGeneration() || getActiveQueryGeneration();
  openReceiptInspector(family, receiptId, generation);
  renderInspector();
}

export function closeInspectorPanel() {
  closePointIntelligenceInspector(getInspectorQueryGeneration() || getActiveQueryGeneration());
  renderInspector();
}

async function copyText(value) {
  if (!value) return false;
  try {
    await navigator.clipboard.writeText(String(value));
    return true;
  } catch {
    return false;
  }
}

export function mountPointIntelligenceInspector(sectionContainer) {
  if (!sectionContainer) return;
  sectionEl = sectionContainer;
  hostEl = sectionContainer.querySelector('#lif-inspector-host');
  if (!hostEl) {
    hostEl = document.createElement('div');
    hostEl.id = 'lif-inspector-host';
    hostEl.className = 'lif-inspector-host';
    hostEl.hidden = true;
    sectionContainer.appendChild(hostEl);
  }

  if (sectionContainer.dataset.piInspectorMounted === '1') return;
  sectionContainer.dataset.piInspectorMounted = '1';

  sectionContainer.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const inspectEvidence = target.closest('[data-pi-inspect-evidence]');
    if (inspectEvidence) {
      event.preventDefault();
      event.stopPropagation();
      const observationId = inspectEvidence.getAttribute('data-pi-observation-id');
      const family = inspectEvidence.getAttribute('data-pi-family');
      openEvidenceInspectorForObservation(observationId, family);
      return;
    }

    const inspectReceipt = target.closest('[data-pi-inspect-receipt]');
    if (inspectReceipt) {
      event.preventDefault();
      event.stopPropagation();
      const family = inspectReceipt.getAttribute('data-pi-family');
      const receiptId = inspectReceipt.getAttribute('data-pi-receipt-id');
      openReceiptInspectorForFamily(family, receiptId || null);
      return;
    }

    const back = target.closest('[data-pi-inspector-back], [data-pi-inspector-action="back-lif"]');
    if (back) {
      event.preventDefault();
      closeInspectorPanel();
      return;
    }

    const action = target.closest('[data-pi-inspector-action]');
    if (action) {
      event.preventDefault();
      const id = action.getAttribute('data-pi-inspector-action');
      const state = getPointIntelligenceInspectorState();
      if (id === 'open-receipt' && state.observationId) {
        const receipt = resolveReceiptForObservation(lastResponse, state.observationId);
        if (receipt?.informationFamily) {
          openReceiptInspectorForFamily(receipt.informationFamily, receipt.queryReceiptId);
        }
        return;
      }
      if (id === 'focus-map' && state.observationId) {
        const evidence = buildSafeEvidenceInspectorModel(lastResponse, state.observationId);
        if (evidence?.hasGeometry) {
          await focusObservationFromPanel(state.observationId, null, evidence.informationFamily);
        }
        return;
      }
    }

    const copyBtn = target.closest('[data-pi-copy]');
    if (copyBtn) {
      event.preventDefault();
      await copyText(copyBtn.getAttribute('data-pi-copy'));
    }
  });

  subscribePointIntelligenceInspectorState(() => renderInspector());
}

export function getPointIntelligenceInspectorInteractionState() {
  const inspector = getPointIntelligenceInspectorState();
  return {
    inspector,
    response: lastResponse,
    evidenceModel: inspector.observationId
      ? buildSafeEvidenceInspectorModel(lastResponse, inspector.observationId)
      : null,
    receiptModel: inspector.family
      ? buildSafeQueryReceiptInspectorModel(lastResponse, inspector.family, inspector.queryReceiptId)
      : null,
    focus: getPointIntelligenceFocusInteractionState()
  };
}

export {
  buildSafeEvidenceInspectorModel,
  buildSafeQueryReceiptInspectorModel,
  buildProviderIssueReceiptFixture
} from './point-intelligence-inspector-model.js';

export { assertNoSecretsExposed, toSafeRawJson } from './point-intelligence-inspector-safe.js';
