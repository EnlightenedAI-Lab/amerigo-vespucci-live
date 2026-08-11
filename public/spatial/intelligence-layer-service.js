/**
 * Intelligence research layer orchestration — unified path for panel + natural language.
 */
import { queryIntelligenceLiveSearch } from './intelligence-layer-request.js';
import {
  normalizeIntelligenceSearchResponse,
  formatIntelligenceResultMessage
} from './intelligence-layer-model.js';
import { buildIntelligenceRequestFromIntent } from './intelligence-layer-intent.js';
import {
  registerIntelligenceLayer,
  getIntelligenceLayerEntry,
  listIntelligenceLayers,
  updateIntelligenceLayerEntry,
  unregisterIntelligenceLayer,
  buildIntelligenceLayerIdentity
} from './intelligence-layer-registry.js';
import {
  renderIntelligenceLayer,
  removeIntelligenceLayerFromMap,
  setIntelligenceLayerVisible,
  fitToIntelligenceLayer
} from './intelligence-layer-map.js';
import { EXECUTION_STATE } from './intelligence-layer-config.js';
import { createClientLatencyTrace } from './spatial-latency-trace.js';

/** @type {Set<Function>} */
const listeners = new Set();
let activeResearch = null;

function emit() {
  const snapshot = getIntelligenceLayersState();
  for (const listener of [...listeners]) {
    try { listener(snapshot); } catch { /* ignore */ }
  }
}

export function getIntelligenceLayersState() {
  return {
    layers: listIntelligenceLayers(),
    activeResearch,
    updatedAt: new Date().toISOString()
  };
}

export function subscribeIntelligenceLayersState(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  listener(getIntelligenceLayersState());
  return () => listeners.delete(listener);
}

/**
 * @param {object} input
 * @param {object} [options]
 */
export async function runIntelligenceLayerResearch(input = {}, options = {}) {
  const request = buildIntelligenceRequestFromIntent(input);
  const identity = buildIntelligenceLayerIdentity(request);
  const trace = options.trace || createClientLatencyTrace({
    strategy: request.researchExecution || 'FAST',
    traceId: options.traceId || request.traceId || null
  });
  request.traceId = trace.traceId;
  trace.mark('userRun');

  activeResearch = {
    identity,
    request,
    state: EXECUTION_STATE.RESEARCHING,
    startedAt: new Date().toISOString(),
    traceId: trace.traceId
  };
  emit();

  try {
    const raw = await queryIntelligenceLiveSearch(request, { ...options, trace });
    const normalized = normalizeIntelligenceSearchResponse(raw, request);
    const state = normalized.state === 'degraded'
      ? EXECUTION_STATE.DEGRADED
      : EXECUTION_STATE.COMPLETE;

    const existing = listIntelligenceLayers().find((e) => e.identity === identity);
    if (existing?.layerId) {
      await removeIntelligenceLayerFromMap(existing.layerId);
      unregisterIntelligenceLayer(existing.layerId);
    }

    const registration = registerIntelligenceLayer({
      request,
      normalized,
      raw,
      state,
      lastRefreshedAt: new Date().toISOString()
    });

    let mapResult = { rendered: 0, layer: null };
    const allowUngovernedLiveMap = options.allowUngovernedLiveMap === true;
    if (allowUngovernedLiveMap) {
      mapResult = await renderIntelligenceLayer(registration.layerId, normalized, { trace });
    } else {
      normalized.mappedCount = 0;
      normalized.mappableEvents = [];
      normalized.unresolvedCount = normalized.totalEvents;
      normalized.governanceRequired = true;
    }
    updateIntelligenceLayerEntry(registration.layerId, {
      normalized,
      raw,
      layer: mapResult.layer,
      state,
      lastRefreshedAt: new Date().toISOString()
    });

    activeResearch = null;
    emit();

    return {
      ok: true,
      state,
      layerId: registration.layerId,
      normalized,
      message: formatIntelligenceResultMessage(normalized),
      request,
      raw,
      latencyTrace: trace.finalize({ ok: true, state, normalized, raw })
    };
  } catch (error) {
    activeResearch = {
      identity,
      request,
      state: EXECUTION_STATE.FAILED,
      error: error?.message || String(error),
      finishedAt: new Date().toISOString()
    };
    emit();
    throw error;
  }
}

export async function refreshIntelligenceLayer(layerId) {
  const entry = getIntelligenceLayerEntry(layerId);
  if (!entry?.request) throw new Error('Intelligence layer not found.');
  return runIntelligenceLayerResearch(entry.request);
}

export async function removeIntelligenceLayer(layerId) {
  const view = typeof window !== 'undefined' ? await import('./spatial-arcgis-runtime.js') : null;
  const mapView = view?.getMapView?.();
  if (mapView?.popup?.visible) {
    const feature = mapView.popup.selectedFeature;
    if (feature?.layer?.id === layerId) mapView.closePopup();
  }
  await removeIntelligenceLayerFromMap(layerId);
  unregisterIntelligenceLayer(layerId);
  emit();
  return { removed: true };
}

export async function toggleIntelligenceLayer(layerId, visible) {
  await setIntelligenceLayerVisible(layerId, visible);
  const entry = updateIntelligenceLayerEntry(layerId, { visible });
  emit();
  return entry;
}

export async function zoomToIntelligenceLayer(layerId) {
  await fitToIntelligenceLayer(layerId);
}

export { formatIntelligenceResultMessage };
