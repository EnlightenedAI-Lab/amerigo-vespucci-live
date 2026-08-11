/**
 * Agent 2 open-world map presentation state — separate from Agent 5 PI focus.
 */
let queryGeneration = 0;
let focusedResultId = null;
let lastPresentation = null;

/** @type {Set<(state: object) => void>} */
const listeners = new Set();

function emit() {
  const snapshot = getOpenWorldMapState();
  for (const listener of listeners) {
    try { listener(snapshot); } catch { /* ignore */ }
  }
}

export function getOpenWorldMapState() {
  return {
    queryGeneration,
    focusedResultId,
    presentation: lastPresentation,
    nonSpatialCount: lastPresentation?.summary?.nonSpatialResults || 0
  };
}

export function subscribeOpenWorldMapState(listener) {
  listeners.add(listener);
  listener(getOpenWorldMapState());
  return () => listeners.delete(listener);
}

export function resetOpenWorldFocusState(generation = queryGeneration) {
  queryGeneration = generation;
  focusedResultId = null;
  emit();
}

export function setOpenWorldMapPresentation(presentation, generation = queryGeneration) {
  queryGeneration = generation;
  lastPresentation = presentation;
  emit();
}

export function focusOpenWorldResult(resultId, generation = queryGeneration) {
  if (generation !== queryGeneration) return false;
  focusedResultId = resultId;
  emit();
  return true;
}

export function clearOpenWorldFocus(generation = queryGeneration) {
  if (generation !== queryGeneration) return;
  focusedResultId = null;
  emit();
}
