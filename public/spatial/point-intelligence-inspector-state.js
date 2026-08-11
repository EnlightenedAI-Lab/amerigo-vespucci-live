/**
 * Point Intelligence inspector state (Phase 3).
 */

export const PI_INSPECTOR_MODE = Object.freeze({
  CLOSED: 'CLOSED',
  EVIDENCE: 'EVIDENCE',
  RECEIPT: 'RECEIPT'
});

let queryGeneration = 0;

/** @type {{
 *   mode: string,
 *   queryGeneration: number,
 *   observationId: string | null,
 *   family: string | null,
 *   queryReceiptId: string | null
 * }} */
let inspectorState = createClosedState();

/** @type {Set<(state: object) => void>} */
const listeners = new Set();

function createClosedState(gen = queryGeneration) {
  return {
    mode: PI_INSPECTOR_MODE.CLOSED,
    queryGeneration: gen,
    observationId: null,
    family: null,
    queryReceiptId: null
  };
}

function emit() {
  const snapshot = getPointIntelligenceInspectorState();
  for (const listener of listeners) {
    try { listener(snapshot); } catch { /* ignore */ }
  }
}

export function getPointIntelligenceInspectorState() {
  return { ...inspectorState };
}

export function subscribePointIntelligenceInspectorState(listener) {
  listeners.add(listener);
  listener(getPointIntelligenceInspectorState());
  return () => listeners.delete(listener);
}

export function resetPointIntelligenceInspectorState(generation = queryGeneration) {
  queryGeneration = generation;
  inspectorState = createClosedState(generation);
  emit();
}

export function openEvidenceInspector(observationId, family = null, generation = queryGeneration) {
  if (generation !== queryGeneration) return false;
  inspectorState = {
    mode: PI_INSPECTOR_MODE.EVIDENCE,
    queryGeneration,
    observationId,
    family,
    queryReceiptId: null
  };
  emit();
  return true;
}

export function openReceiptInspector(family, receiptId = null, generation = queryGeneration) {
  if (generation !== queryGeneration) return false;
  inspectorState = {
    mode: PI_INSPECTOR_MODE.RECEIPT,
    queryGeneration,
    observationId: null,
    family,
    queryReceiptId: receiptId
  };
  emit();
  return true;
}

export function closePointIntelligenceInspector(generation = queryGeneration) {
  if (generation !== queryGeneration) return;
  inspectorState = createClosedState(generation);
  emit();
}

export function getInspectorQueryGeneration() {
  return queryGeneration;
}
