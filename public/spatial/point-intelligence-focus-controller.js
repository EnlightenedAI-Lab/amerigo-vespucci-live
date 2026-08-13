/**
 * Point Intelligence Phase 2 focus orchestration — panel ↔ map linking.
 */
import {
  focusPointIntelligenceFamily,
  focusPointIntelligenceObservation,
  focusPointIntelligenceFact,
  clearPointIntelligenceFocus,
  getPointIntelligenceFocusState,
  subscribePointIntelligenceFocusState,
  setPointIntelligenceMapPresentation,
  getActiveQueryGeneration,
  resetPointIntelligenceFocusState
} from './point-intelligence-focus-state.js';
import {
  replacePointIntelligencePresentation,
  renderPointIntelligenceMapPresentation,
  ensureObservationVisible,
  getCurrentMapPresentation,
  clearPointIntelligenceLayers
} from './point-intelligence-layer.js';
import {
  observationHasSpatialGeometry,
  resolveFactObservationTarget,
  indexSpatialEvidence,
  getObservationId
} from './point-intelligence-map-presentation.js';
import { buildLocationIntelligenceFocusModel } from './point-intelligence-lif-model.js';
import { setPointIntelligenceInspectorBundleContext, openEvidenceInspectorForObservation } from './point-intelligence-inspector-controller.js';

let lastPoint = null;
let lastResults = [];
let lastResponse = null;
let panelContainer = null;

/** @type {Set<(payload: object) => void>} */
const uiListeners = new Set();

function emitUi() {
  const payload = {
    focus: getPointIntelligenceFocusState(),
    mapPresentation: getCurrentMapPresentation(),
    response: lastResponse,
    point: lastPoint
  };
  for (const listener of uiListeners) {
    try { listener(payload); } catch { /* ignore */ }
  }
}

export function subscribePointIntelligenceFocusUi(listener) {
  uiListeners.add(listener);
  listener({
    focus: getPointIntelligenceFocusState(),
    mapPresentation: getCurrentMapPresentation(),
    response: lastResponse,
    point: lastPoint
  });
  return () => uiListeners.delete(listener);
}

export async function setPointIntelligenceBundleContext(point, response) {
  lastPoint = point;
  lastResponse = response;
  lastResults = Array.isArray(response?.results) ? response.results : [];
  const generation = response?.queryGroupId ?? getActiveQueryGeneration();
  resetPointIntelligenceFocusState(generation);
  const presentation = await replacePointIntelligencePresentation(point, lastResults, {
    mode: 'REPRESENTATIVE',
    queryGeneration: generation
  });
  setPointIntelligenceMapPresentation(presentation, generation);
  setPointIntelligenceInspectorBundleContext(response);
  emitUi();
  return presentation;
}

async function refreshMapFromFocus() {
  if (!lastPoint) return;
  const presentation = await renderPointIntelligenceMapPresentation(
    lastResults,
    getPointIntelligenceFocusState()
  );
  setPointIntelligenceMapPresentation(presentation, getActiveQueryGeneration());
  const focus = getPointIntelligenceFocusState();
  if (focus.focusedObservationId && focus.nonSpatialMessage == null) {
    await ensureObservationVisible(focus.focusedObservationId);
  }
  emitUi();
}

export async function focusFamilyFromPanel(family) {
  const generation = getActiveQueryGeneration();
  focusPointIntelligenceFamily(family, generation);
  await refreshMapFromFocus();
  applyPanelFocusClasses();
}

export async function focusObservationFromPanel(observationId, result, family) {
  const generation = getActiveQueryGeneration();
  const entry = result || lastResults.find((r) => getObservationId(r) === observationId);
  focusPointIntelligenceObservation(observationId, {
    hasGeometry: observationHasSpatialGeometry(entry),
    family: family || entry?.category
  }, generation);
  await refreshMapFromFocus();
  applyPanelFocusClasses();
}

export async function focusFactFromPanel(factIndex, response, point) {
  const model = buildLocationIntelligenceFocusModel(response || lastResponse, point || lastPoint);
  const factEntry = model.facts[factIndex];
  if (!factEntry?.focusable || !factEntry.familyKey) return;
  const index = indexSpatialEvidence((response || lastResponse)?.results || lastResults);
  const familyLabelToKey = Object.fromEntries(
    model.coverage.rows.map((row) => [row.label, row.informationFamily])
  );
  const targetId = resolveFactObservationTarget({
    kind: factEntry.kind,
    familyKey: factEntry.familyKey,
    label: factEntry.label
  }, index, familyLabelToKey);
  if (!targetId) return;
  const generation = getActiveQueryGeneration();
  focusPointIntelligenceFact(factIndex, targetId, factEntry.familyKey, generation);
  await refreshMapFromFocus();
  scrollObservationIntoView(targetId);
  applyPanelFocusClasses();
}

export async function focusEvidenceFromMap(hit) {
  if (!hit?.observationId) return null;
  const generation = getActiveQueryGeneration();
  focusPointIntelligenceObservation(hit.observationId, {
    hasGeometry: true,
    family: hit.family
  }, generation);
  await refreshMapFromFocus();
  applyPanelFocusClasses();
  scrollObservationIntoView(hit.observationId);
  openEvidenceInspectorForObservation(hit.observationId, hit.family);
  return {
    observationId: hit.observationId,
    family: hit.family
  };
}

export async function clearFocusFromPanel() {
  clearPointIntelligenceFocus(getActiveQueryGeneration());
  await refreshMapFromFocus();
  applyPanelFocusClasses();
}

/**
 * Clear bundle presentation context without losing map anchor when requested.
 * @param {{ retainAnchor?: boolean }} [options]
 */
export async function clearPointIntelligenceBundleContext(options = {}) {
  if (!options.retainAnchor) lastPoint = null;
  lastResponse = null;
  lastResults = [];
  resetPointIntelligenceFocusState(getActiveQueryGeneration() + 1);
  setPointIntelligenceInspectorBundleContext(null);
  await clearPointIntelligenceLayers();
  emitUi();
}

export function mountPointIntelligenceFocusInteraction(container) {
  if (!container) return;
  panelContainer = container;

  if (container.dataset.piFocusMounted === '1') return;
  container.dataset.piFocusMounted = '1';

  container.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const clearBtn = target.closest('[data-pi-clear-focus]');
    if (clearBtn) {
      event.preventDefault();
      await clearFocusFromPanel();
      return;
    }

    const factBtn = target.closest('[data-pi-fact-index]');
    if (factBtn && lastResponse) {
      event.preventDefault();
      const index = Number(factBtn.getAttribute('data-pi-fact-index'));
      await focusFactFromPanel(index, lastResponse, lastPoint);
      return;
    }

    const obsBtn = target.closest('[data-pi-observation-id]');
    if (obsBtn) {
      event.preventDefault();
      const observationId = obsBtn.getAttribute('data-pi-observation-id');
      const family = obsBtn.getAttribute('data-pi-family');
      await focusObservationFromPanel(observationId, null, family);
      scrollObservationIntoView(observationId);
      return;
    }

    const familySummary = target.closest('.lif-family__summary');
    if (familySummary) {
      const family = familySummary.closest('[data-pi-family]')?.getAttribute('data-pi-family');
      if (family) await focusFamilyFromPanel(family);
    }
  });

  container.addEventListener('keydown', async (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (!target.closest('[data-pi-observation-id], [data-pi-fact-index], [data-pi-clear-focus]')) return;
    event.preventDefault();
    target.click();
  });

  subscribePointIntelligenceFocusState(() => {
    applyPanelFocusClasses();
    updateMapAccountingIndicator();
  });
}

export function scrollObservationIntoView(observationId) {
  if (!panelContainer || !observationId) return;
  const el = panelContainer.querySelector(`[data-pi-observation-id="${CSS.escape(observationId)}"]`);
  if (!el) return;
  const details = el.closest('details.lif-family');
  if (details) details.open = true;
  const domain = el.closest('.lif-domain');
  if (domain) {
    const domainSection = domain.querySelector('.lif-domain__title');
    domainSection?.scrollIntoView?.({ block: 'nearest' });
  }
  el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

export function applyPanelFocusClasses() {
  if (!panelContainer) return;
  const focus = getPointIntelligenceFocusState();
  panelContainer.querySelectorAll('.lif-family').forEach((el) => {
    const family = el.getAttribute('data-pi-family');
    el.classList.toggle('lif-family--focused', Boolean(
      focus.focusedFamily && focus.focusedFamily === family
    ));
  });
  panelContainer.querySelectorAll('[data-pi-observation-id]').forEach((el) => {
    el.classList.toggle(
      'lif-observation--focused',
      el.getAttribute('data-pi-observation-id') === focus.focusedObservationId
    );
  });
  panelContainer.querySelectorAll('[data-pi-fact-index]').forEach((el) => {
    const index = Number(el.getAttribute('data-pi-fact-index'));
    el.classList.toggle('lif-fact--focused', focus.focusedFactIndex === index);
  });
  const nonSpatial = panelContainer.querySelector('[data-pi-non-spatial-message]');
  if (nonSpatial) {
    nonSpatial.hidden = !focus.nonSpatialMessage;
    nonSpatial.textContent = focus.nonSpatialMessage || '';
  }
  const clearBtn = panelContainer.querySelector('[data-pi-clear-focus]');
  if (clearBtn) {
    const hasFocus = Boolean(
      focus.focusedFamily || focus.focusedObservationId || focus.focusedFactIndex != null
    );
    clearBtn.hidden = !hasFocus;
  }
  updateMapAccountingIndicator();
}

export function updateMapAccountingIndicator() {
  if (!panelContainer) return;
  const presentation = getCurrentMapPresentation()
    || getPointIntelligenceFocusState().mapPresentation;
  const accounting = presentation?.accounting;
  const el = panelContainer.querySelector('[data-pi-map-accounting]');
  if (!el || !accounting) return;
  if (!accounting.thinned) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.textContent = `${accounting.spatialObservations} observations · ${accounting.renderedMapLocations} map locations shown`;
}

export function getPointIntelligenceFocusInteractionState() {
  return {
    point: lastPoint,
    response: lastResponse,
    focus: getPointIntelligenceFocusState(),
    mapPresentation: getCurrentMapPresentation()
  };
}
