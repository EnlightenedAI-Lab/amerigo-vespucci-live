/**
 * Selection hub for IQAI fidelity strip — intelligence vs reference vs clear.
 */

export const FIDELITY_SELECTION_MODES = Object.freeze({
  NONE: 'NONE',
  INTELLIGENCE_EVENT: 'INTELLIGENCE_EVENT',
  OPEN_WORLD: 'OPEN_WORLD',
  REFERENCE_GIS: 'REFERENCE_GIS',
  RUN_LAYER: 'RUN_LAYER'
});

/** @type {object} */
let selection = { mode: FIDELITY_SELECTION_MODES.NONE };

/** @type {Set<(state: object) => void>} */
const listeners = new Set();

function emit() {
  for (const listener of [...listeners]) {
    try { listener({ ...selection }); } catch { /* ignore */ }
  }
}

/**
 * @param {object} next
 */
export function publishFidelitySelection(next = {}) {
  selection = { ...next, updatedAt: new Date().toISOString() };
  if (typeof window !== 'undefined') {
    window.__IQAI_FIDELITY_SELECTION__ = { ...selection };
  }
  emit();
}

export function clearFidelitySelection() {
  publishFidelitySelection({ mode: FIDELITY_SELECTION_MODES.NONE });
}

export function getFidelitySelection() {
  return { ...selection };
}

/**
 * @param {(state: object) => void} listener
 */
export function subscribeFidelitySelection(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  listener({ ...selection });
  return () => listeners.delete(listener);
}

/**
 * @param {object} attributes
 * @param {object} [graphic]
 */
export function classifyMapFeatureSelection(attributes = {}, graphic = null) {
  if (attributes?.eventId || attributes?.iqaiFidelityPlane === 'INTELLIGENCE') {
    return {
      mode: FIDELITY_SELECTION_MODES.INTELLIGENCE_EVENT,
      eventId: attributes.eventId,
      attributes,
      graphic
    };
  }
  if (attributes?.datasetId || attributes?.iqaiType || attributes?.amenity) {
    return {
      mode: FIDELITY_SELECTION_MODES.REFERENCE_GIS,
      attributes,
      graphic,
      datasetId: attributes.datasetId || null
    };
  }
  return {
    mode: FIDELITY_SELECTION_MODES.REFERENCE_GIS,
    attributes,
    graphic
  };
}
