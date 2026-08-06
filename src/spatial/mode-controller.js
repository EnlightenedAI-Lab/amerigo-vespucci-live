import { getLayersForMode, LAYER_CATALOG } from './layer-catalog.js';

const TRACKER_LAYER_IDS = new Set([
  'vespucci-operational',
  'open-meteo-conditions'
]);

/**
 * Atomic mode presets with analytical exclusivity.
 */
export class ModeController {
  constructor(costPolicy) {
    this.costPolicy = costPolicy;
    this.mode = 'navigation';
    this.activeAnalyticalByGroup = new Map();
    this.pendingAbort = null;
    this.listeners = new Set();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit(state) {
    for (const fn of this.listeners) fn(state);
  }

  cancelPending() {
    if (this.pendingAbort) {
      this.pendingAbort.abort();
      this.pendingAbort = null;
    }
  }

  /**
   * Layers that should be visible after mode transition.
   * Tracker graphics always remain enabled.
   */
  resolveLayers(mode = this.mode) {
    this.cancelPending();
    this.pendingAbort = new AbortController();
    const contextual = [];
    const blocked = [];
    const tracker = [];

    for (const layer of LAYER_CATALOG) {
      if (TRACKER_LAYER_IDS.has(layer.id) || layer.trackerLayer) {
        tracker.push(layer);
        continue;
      }
      if (!layer.modes.includes(mode)) continue;
      const decision = this.costPolicy.evaluate(layer);
      if (!decision.allowed) {
        blocked.push({ layer, decision });
        continue;
      }
      contextual.push(layer);
    }

    const exclusiveWinners = this._resolveExclusive(contextual, mode);
    return {
      mode,
      signal: this.pendingAbort.signal,
      tracker,
      contextual: exclusiveWinners,
      blocked,
      allVisibleIds: [...tracker.map((l) => l.id), ...exclusiveWinners.map((l) => l.id)]
    };
  }

  _resolveExclusive(layers, mode) {
    const groups = new Map();
    const ungrouped = [];
    for (const layer of layers) {
      if (!layer.exclusiveGroup) {
        ungrouped.push(layer);
        continue;
      }
      if (!groups.has(layer.exclusiveGroup)) groups.set(layer.exclusiveGroup, []);
      groups.get(layer.exclusiveGroup).push(layer);
    }

    const winners = [...ungrouped];
    for (const [group, members] of groups) {
      const preferred = this._defaultForGroup(group, mode);
      const pick = members.find((m) => m.id === preferred)
        || members.find((m) => m.id === this.activeAnalyticalByGroup.get(group))
        || members[0];
      if (pick) {
        this.activeAnalyticalByGroup.set(group, pick.id);
        winners.push(pick);
      }
    }
    return winners;
  }

  _defaultForGroup(group, mode) {
    if (group === 'ocean-analytical' && mode === 'ocean') return 'copernicus-current';
    if (group === 'satellite-analytical') return 'gibs-viirs-truecolor';
    if (group === 'intelligence-analytical') return 'ship-density-historical';
    return null;
  }

  setMode(mode) {
    if (!['navigation', 'ocean', 'weather', 'satellite', 'intelligence'].includes(mode)) {
      throw new Error(`Unknown mode: ${mode}`);
    }
    this.mode = mode;
    const state = this.resolveLayers(mode);
    this._emit(state);
    return state;
  }

  setExclusiveLayer(group, layerId) {
    this.activeAnalyticalByGroup.set(group, layerId);
    const state = this.resolveLayers(this.mode);
    this._emit(state);
    return state;
  }
}
