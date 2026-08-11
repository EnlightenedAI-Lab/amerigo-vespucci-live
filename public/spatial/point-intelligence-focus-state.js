/**
 * Point Intelligence focus / map-presentation state (Phase 2).
 * Presentation only — does not duplicate canonical bundle evidence.
 */

export const PI_MAP_MODE = Object.freeze({
  REPRESENTATIVE: 'REPRESENTATIVE',
  FOCUSED_FAMILY: 'FOCUSED_FAMILY',
  FOCUSED_OBSERVATION: 'FOCUSED_OBSERVATION',
  ALL_RELEVANT: 'ALL_RELEVANT'
});

/** @typedef {'family' | 'observation' | 'fact'} FocusKind */

let queryGeneration = 0;
/** @type {import('./point-intelligence-map-presentation.js').MapPresentationModel | null} */
let lastMapPresentation = null;

/** @type {{
 *   queryGeneration: number,
 *   mode: string,
 *   focusedFamily: string | null,
 *   focusedObservationId: string | null,
 *   focusedFactIndex: number | null,
 *   nonSpatialMessage: string | null
 * }} */
let focusState = createEmptyFocusState();

/** @type {Set<(state: object) => void>} */
const listeners = new Set();

function createEmptyFocusState(gen = 0) {
  return {
    queryGeneration: gen,
    mode: PI_MAP_MODE.REPRESENTATIVE,
    focusedFamily: null,
    focusedObservationId: null,
    focusedFactIndex: null,
    nonSpatialMessage: null
  };
}

function emit() {
  const snapshot = getPointIntelligenceFocusState();
  for (const listener of listeners) {
    try { listener(snapshot); } catch { /* ignore */ }
  }
}

export function getPointIntelligenceFocusState() {
  return {
    ...focusState,
    mapPresentation: lastMapPresentation
  };
}

export function subscribePointIntelligenceFocusState(listener) {
  listeners.add(listener);
  listener(getPointIntelligenceFocusState());
  return () => listeners.delete(listener);
}

export function resetPointIntelligenceFocusState(generation = queryGeneration) {
  queryGeneration = generation;
  focusState = createEmptyFocusState(generation);
  lastMapPresentation = null;
  emit();
}

export function setPointIntelligenceMapPresentation(model, generation = queryGeneration) {
  queryGeneration = generation;
  lastMapPresentation = model;
  emit();
}

export function focusPointIntelligenceFamily(family, generation = queryGeneration) {
  if (generation !== queryGeneration) return false;
  if (focusState.focusedFamily === family && focusState.mode === PI_MAP_MODE.FOCUSED_FAMILY) {
    focusState = { ...createEmptyFocusState(generation), mode: PI_MAP_MODE.REPRESENTATIVE };
  } else {
    focusState = {
      ...createEmptyFocusState(generation),
      mode: PI_MAP_MODE.FOCUSED_FAMILY,
      focusedFamily: family,
      focusedObservationId: null,
      focusedFactIndex: null,
      nonSpatialMessage: null
    };
  }
  emit();
  return true;
}

/**
 * @param {string} observationId
 * @param {{ hasGeometry?: boolean }} [meta]
 */
export function focusPointIntelligenceObservation(observationId, meta = {}, generation = queryGeneration) {
  if (generation !== queryGeneration) return false;
  if (!meta.hasGeometry) {
    focusState = {
      ...focusState,
      mode: PI_MAP_MODE.FOCUSED_OBSERVATION,
      focusedObservationId: observationId,
      nonSpatialMessage: 'No spatial geometry is available for this observation.'
    };
    emit();
    return true;
  }
  focusState = {
    ...focusState,
    mode: PI_MAP_MODE.FOCUSED_OBSERVATION,
    focusedObservationId: observationId,
    focusedFamily: meta.family || focusState.focusedFamily,
    focusedFactIndex: null,
    nonSpatialMessage: null
  };
  emit();
  return true;
}

export function focusPointIntelligenceFact(factIndex, observationId, family, generation = queryGeneration) {
  if (generation !== queryGeneration) return false;
  if (!observationId) return false;
  focusState = {
    ...createEmptyFocusState(generation),
    mode: PI_MAP_MODE.FOCUSED_OBSERVATION,
    focusedFactIndex: factIndex,
    focusedObservationId: observationId,
    focusedFamily: family || null,
    nonSpatialMessage: null
  };
  emit();
  return true;
}

export function clearPointIntelligenceFocus(generation = queryGeneration) {
  if (generation !== queryGeneration) return;
  focusState = createEmptyFocusState(generation);
  focusState.mode = PI_MAP_MODE.REPRESENTATIVE;
  emit();
}

export function getActiveQueryGeneration() {
  return queryGeneration;
}
