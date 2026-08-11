/**
 * Development observability — reports deterministic renderer display state only.
 * Does not modify symbology.
 */

import { guardRendererWrite, getActiveCommandId, markCommandStage } from './deterministic-command-transaction.js';

/** @type {Record<string, unknown>} */
let state = {
  commandId: null,
  rendererMode: 'IDLE',
  displayLayerId: null,
  displayLayerTitle: null,
  usesLayerViewFilter: false,
  usesObjectIdFilter: false,
  runtimeFallbackActive: false,
  authoritativeWebMapLayerActive: false,
  iqaiDeterministicResultsActive: false,
  fallbackReason: null,
  authNativeShortReason: null,
  baseResultObjectIdCount: null,
  activeObjectIdCount: null,
  activeCategory: null,
  sourceLayerVisible: null,
  layerViewSuspended: null
};

let reportTimer = null;

function scheduleServerReport() {
  if (reportTimer) return;
  reportTimer = setTimeout(async () => {
    reportTimer = null;
    try {
      await fetch('/api/spatial/runtime-info/client-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state),
        cache: 'no-store'
      });
    } catch {
      // preview endpoint may be unavailable
    }
  }, 120);
}

/**
 * @param {Partial<typeof state>} partial
 */
export function publishRendererDisplayState(partial) {
  const commandId = partial.commandId ?? getActiveCommandId();
  if (!guardRendererWrite(commandId, 'renderer_telemetry')) return state;
  state = { ...state, ...partial, commandId };
  if (typeof window !== 'undefined') {
    window.__IQAI_RENDERER_TELEMETRY__ = { ...state, at: new Date().toISOString() };
  }
  markCommandStage(commandId, 'renderer_settled', {
    rendererMode: state.rendererMode,
    activeObjectIdCount: state.activeObjectIdCount
  });
  scheduleServerReport();
  return state;
}

export function resetRendererDisplayState(commandId = null) {
  const activeId = commandId ?? getActiveCommandId();
  if (activeId && !guardRendererWrite(activeId, 'renderer_reset')) return;
  publishRendererDisplayState({
    commandId: activeId,
    rendererMode: 'IDLE',
    displayLayerId: null,
    displayLayerTitle: null,
    usesLayerViewFilter: false,
    usesObjectIdFilter: false,
    runtimeFallbackActive: false,
    authoritativeWebMapLayerActive: false,
    iqaiDeterministicResultsActive: false,
    fallbackReason: null,
    authNativeShortReason: null,
    baseResultObjectIdCount: null,
    activeObjectIdCount: null,
    activeCategory: null,
    sourceLayerVisible: null,
    layerViewSuspended: null
  });
}

/**
 * Map internal renderer resolution to visible badge label.
 * @param {string | null | undefined} mode
 * @param {{ success?: boolean, reason?: string } | null | undefined} scopedAttempt
 */
export function resolveRendererBadgeMode(mode, scopedAttempt = null) {
  if (mode === 'auth_native' || mode === 'authoritative_webmap') return 'AUTH-NATIVE';
  if (scopedAttempt?.success === false && scopedAttempt?.reason === 'layer_view_filter_failed') {
    return 'ERROR';
  }
  if (!mode) return 'IDLE';
  return 'RUNTIME-FALLBACK';
}

export function getRendererDisplayState() {
  return { ...state };
}
