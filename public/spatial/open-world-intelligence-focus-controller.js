/**
 * Open-world intelligence panel ↔ map linking.
 */
import { subscribeOpenWorldMapState, getOpenWorldMapState } from './open-world-intelligence-map-state.js';
import {
  emphasizeOpenWorldMapResult,
  hitTestOpenWorldIntelligenceFeature
} from './open-world-intelligence-layer.js';
import { focusOpenWorldMapFeature } from './open-world-intelligence-map-layer.js';
import { openOpenWorldInspector } from './open-world-intelligence-inspector-controller.js';

let panelContainer = null;
let getResultById = null;

export function mountOpenWorldIntelligenceFocus(panelEl, options = {}) {
  panelContainer = panelEl;
  getResultById = options.getResultById || null;
  return subscribeOpenWorldMapState((state) => {
    applyOpenWorldPanelSelection(state.focusedResultId);
  });
}

export function applyOpenWorldPanelSelection(resultId) {
  if (!panelContainer) return;
  panelContainer.querySelectorAll('[data-owi-result-id]').forEach((card) => {
    const id = card.getAttribute('data-owi-result-id');
    card.classList.toggle('owi-result--selected', Boolean(resultId && id === resultId));
  });
  if (!resultId) return;
  const selected = panelContainer.querySelector(`[data-owi-result-id="${CSS.escape(resultId)}"]`);
  selected?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
}

export async function selectOpenWorldIntelligenceResult(resultId, options = {}) {
  if (!resultId) return null;
  focusOpenWorldMapFeature(resultId);
  applyOpenWorldPanelSelection(resultId);
  await emphasizeOpenWorldMapResult(resultId);
  const result = getResultById?.(resultId) || null;
  if (options.openInspector && result) {
    openOpenWorldInspector(result);
    panelContainer?.querySelector('#owi-inspector-host')?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }
  return result;
}

export async function focusOpenWorldResultFromMap(mapEvent) {
  const hit = await hitTestOpenWorldIntelligenceFeature(mapEvent);
  if (!hit?.resultId) return null;
  return selectOpenWorldIntelligenceResult(hit.resultId, { openInspector: false });
}

export { hitTestOpenWorldIntelligenceFeature };
