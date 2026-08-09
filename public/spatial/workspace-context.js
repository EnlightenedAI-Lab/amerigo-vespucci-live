/**
 * Generic active-workspace coordinator — tells the UI what the operator is working on.
 */

export const WORKSPACES = Object.freeze({
  NONE: 'NONE',
  SPVM_CRIME: 'SPVM_CRIME',
  AMENITY_XRAY: 'AMENITY_XRAY',
  SCOPED_QUERY: 'SCOPED_QUERY',
  LIVE_FEED: 'LIVE_FEED'
});

export const SELECTION_TYPES = Object.freeze({
  NONE: 'NONE',
  MAP_FEATURE: 'MAP_FEATURE',
  TABLE_ROW: 'TABLE_ROW'
});

const LIVE_FEED_IDS = Object.freeze({
  stm: 'stm-live-buses',
  aircraft: 'live-aircraft',
  vessels: 'live-vessels',
  hydro: 'hydro-quebec-current-outages'
});

/** @type {{ activeWorkspace: string, activeSelection: object, workspaceMeta: object }} */
let state = {
  activeWorkspace: WORKSPACES.NONE,
  activeSelection: { type: SELECTION_TYPES.NONE },
  workspaceMeta: {}
};

/** @type {Set<(ctx: object) => void>} */
const listeners = new Set();

function cloneState() {
  return {
    activeWorkspace: state.activeWorkspace,
    activeSelection: { ...state.activeSelection },
    workspaceMeta: { ...state.workspaceMeta }
  };
}

function emit() {
  const snapshot = cloneState();
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch (error) {
      console.warn('[IQAI] workspace listener failed', error?.message || error);
    }
  }
}

export function getWorkspaceContext() {
  return cloneState();
}

export function subscribeWorkspaceContext(listener) {
  listeners.add(listener);
  listener(cloneState());
  return () => listeners.delete(listener);
}

/**
 * @param {string} workspace
 * @param {object} [meta]
 */
export function setActiveWorkspace(workspace, meta = {}) {
  const next = workspace && Object.values(WORKSPACES).includes(workspace)
    ? workspace
    : WORKSPACES.NONE;
  state.activeWorkspace = next;
  state.workspaceMeta = { ...state.workspaceMeta, ...meta };
  if (next === WORKSPACES.NONE) {
    state.activeSelection = { type: SELECTION_TYPES.NONE };
  }
  emit();
}

/**
 * @param {object} patch
 */
export function patchWorkspaceMeta(patch = {}) {
  state.workspaceMeta = { ...state.workspaceMeta, ...patch };
  emit();
}

/**
 * @param {{ type: string, layerId?: string, recordId?: string, attributes?: object }} selection
 */
export function setActiveSelection(selection = { type: SELECTION_TYPES.NONE }) {
  state.activeSelection = {
    type: selection.type || SELECTION_TYPES.NONE,
    layerId: selection.layerId || null,
    recordId: selection.recordId || null,
    attributes: selection.attributes || null
  };
  emit();
}

export function clearActiveSelection() {
  state.activeSelection = { type: SELECTION_TYPES.NONE };
  emit();
}

/**
 * @param {string} [workspace]
 */
export function workspaceOwnsIqaiControl(workspace = state.activeWorkspace) {
  return workspace === WORKSPACES.SPVM_CRIME
    || workspace === WORKSPACES.AMENITY_XRAY
    || workspace === WORKSPACES.SCOPED_QUERY
    || workspace === WORKSPACES.LIVE_FEED;
}

/**
 * @param {'stm'|'aircraft'|'vessels'|'hydro'} feedKey
 * @param {object} [ctx]
 */
export function shouldShowLiveFeedSection(feedKey, ctx = state) {
  const layerId = LIVE_FEED_IDS[feedKey];
  const visibleLayers = ctx.workspaceMeta?.visibleLayerIds || [];
  const layerVisible = visibleLayers.includes(layerId);
  const feedWorkspace = ctx.activeWorkspace === WORKSPACES.LIVE_FEED
    && ctx.workspaceMeta?.liveFeedId === feedKey;
  if (ctx.activeWorkspace === WORKSPACES.SPVM_CRIME) {
    return layerVisible;
  }
  return layerVisible || feedWorkspace;
}

export function getLiveFeedLayerId(feedKey) {
  return LIVE_FEED_IDS[feedKey] || null;
}

if (typeof globalThis !== 'undefined') {
  globalThis.__IQAI_WORKSPACE__ = {
    getWorkspaceContext,
    WORKSPACES,
    SELECTION_TYPES
  };
}
