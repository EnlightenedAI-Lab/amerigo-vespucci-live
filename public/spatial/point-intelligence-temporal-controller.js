/**
 * Temporal mode orchestration — resets incompatible PI state on Time Lens changes.
 */
import {
  getActiveTemporalGeneration,
  getPointIntelligenceTemporalState,
  restorePointIntelligenceTemporalStateFromSession,
  subscribePointIntelligenceTemporalState
} from './point-intelligence-temporal-state.js';
import { isTemporalModeExecutable } from './point-intelligence-temporal-support.js';
import {
  invalidatePointIntelligenceEvidenceForTemporalChange
} from './point-intelligence-service.js';
import {
  clearPointIntelligenceBundleContext
} from './point-intelligence-focus-controller.js';
import { closeInspectorPanel } from './point-intelligence-inspector-controller.js';
import { mountPointIntelligenceTimeLens } from './point-intelligence-time-lens.js';
import { invalidateOpenWorldIntelligenceForTemporalChangeSync } from './open-world-intelligence-service.js';
import { clearOpenWorldMapLayers } from './open-world-intelligence-map-layer.js';

let lastTemporalGeneration = 0;
let panelLens = null;
let mapLens = null;

async function handleTemporalGenerationChange(state) {
  if (state.temporalGeneration === lastTemporalGeneration) return;
  lastTemporalGeneration = state.temporalGeneration;

  invalidateOpenWorldIntelligenceForTemporalChangeSync();
  closeInspectorPanel();
  await clearPointIntelligenceBundleContext({ retainAnchor: true });
  await clearOpenWorldMapLayers();
  if (!isTemporalModeExecutable(state.mode)) {
    await invalidatePointIntelligenceEvidenceForTemporalChange(state);
  }
}

export function initPointIntelligenceTemporalController(options = {}) {
  restorePointIntelligenceTemporalStateFromSession();
  lastTemporalGeneration = getActiveTemporalGeneration();

  if (options.panelHost) {
    panelLens = mountPointIntelligenceTimeLens(options.panelHost);
  }
  if (options.mapHost) {
    mapLens = mountPointIntelligenceTimeLens(options.mapHost, { compact: true });
  }

  return subscribePointIntelligenceTemporalState((state) => {
    void handleTemporalGenerationChange(state);
    options.onTemporalChange?.(getPointIntelligenceTemporalState());
  });
}

export function destroyPointIntelligenceTemporalController() {
  panelLens?.destroy();
  mapLens?.destroy();
  panelLens = null;
  mapLens = null;
}
