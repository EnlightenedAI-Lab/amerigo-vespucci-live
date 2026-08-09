/**
 * Generic intelligence-workspace geometry — session state for docked / maximized / collapsed.
 */

export const WORKSPACE_GEOMETRY_MODES = Object.freeze({
  DOCKED: 'DOCKED',
  MAXIMIZED: 'MAXIMIZED',
  COLLAPSED: 'COLLAPSED'
});

export const WORKSPACE_GEOMETRY_DEFAULTS = Object.freeze({
  minDockedPx: 200,
  maxDockedVh: 0.85,
  minMapStripPx: 72,
  defaultDockedPx: 360,
  collapsedPx: 44,
  shellHeaderPx: 44,
  splitterPx: 10
});

/** @type {Map<string, { mode: string, dockedHeight: number }>} */
const sessionByWorkspace = new Map();

/** @type {Set<(state: object) => void>} */
const listeners = new Set();

let activeWorkspaceKey = null;
let currentSnapshot = {
  mode: WORKSPACE_GEOMETRY_MODES.DOCKED,
  dockedHeight: WORKSPACE_GEOMETRY_DEFAULTS.defaultDockedPx,
  workspaceKey: null,
  limits: {
    min: WORKSPACE_GEOMETRY_DEFAULTS.minDockedPx,
    max: 640,
    available: 800,
    collapsed: WORKSPACE_GEOMETRY_DEFAULTS.collapsedPx
  }
};

function createSnapshot(mode, dockedHeight, workspaceKey = activeWorkspaceKey) {
  return {
    mode,
    dockedHeight,
    workspaceKey,
    limits: computeWorkspaceLimits()
  };
}

function emit() {
  const snapshot = { ...currentSnapshot, limits: computeWorkspaceLimits() };
  currentSnapshot = snapshot;
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch (error) {
      console.warn('[IQAI] workspace geometry listener failed', error?.message || error);
    }
  }
}

/**
 * @param {string} workspaceKey
 */
function getSession(workspaceKey) {
  if (!workspaceKey) {
    return {
      mode: WORKSPACE_GEOMETRY_MODES.DOCKED,
      dockedHeight: WORKSPACE_GEOMETRY_DEFAULTS.defaultDockedPx
    };
  }
  if (!sessionByWorkspace.has(workspaceKey)) {
    sessionByWorkspace.set(workspaceKey, {
      mode: WORKSPACE_GEOMETRY_MODES.DOCKED,
      dockedHeight: WORKSPACE_GEOMETRY_DEFAULTS.defaultDockedPx
    });
  }
  return sessionByWorkspace.get(workspaceKey);
}

/**
 * @param {string} workspaceKey
 * @param {{ mode?: string, dockedHeight?: number }} patch
 */
export function saveWorkspaceSession(workspaceKey, patch = {}) {
  if (!workspaceKey) return;
  const session = getSession(workspaceKey);
  if (patch.mode && Object.values(WORKSPACE_GEOMETRY_MODES).includes(patch.mode)) {
    session.mode = patch.mode;
  }
  if (Number.isFinite(patch.dockedHeight)) {
    const limits = computeWorkspaceLimits();
    session.dockedHeight = clamp(patch.dockedHeight, limits.min, limits.max);
  }
  sessionByWorkspace.set(workspaceKey, session);
}

export function computeWorkspaceLimits() {
  const {
    minDockedPx,
    maxDockedVh,
    minMapStripPx,
    shellHeaderPx,
    splitterPx
  } = WORKSPACE_GEOMETRY_DEFAULTS;
  const innerHeight = typeof window !== 'undefined' ? window.innerHeight : 900;
  const available = Math.max(0, innerHeight - shellHeaderPx - splitterPx);
  const min = minDockedPx;
  const max = Math.max(
    min,
    Math.round(available * maxDockedVh) - minMapStripPx
  );
  return { min, max, available, collapsed: WORKSPACE_GEOMETRY_DEFAULTS.collapsedPx };
}

export function getWorkspaceGeometry() {
  return { ...currentSnapshot, limits: computeWorkspaceLimits() };
}

export function subscribeWorkspaceGeometry(listener) {
  listeners.add(listener);
  listener(getWorkspaceGeometry());
  return () => listeners.delete(listener);
}

/**
 * @param {string} workspaceKey
 */
export function activateWorkspaceGeometry(workspaceKey) {
  activeWorkspaceKey = workspaceKey || null;
  const session = getSession(workspaceKey);
  currentSnapshot = createSnapshot(session.mode, session.dockedHeight, workspaceKey);
  emit();
  return currentSnapshot;
}

/**
 * @param {string} workspaceKey
 */
export function deactivateWorkspaceGeometry(workspaceKey) {
  if (workspaceKey && activeWorkspaceKey === workspaceKey) {
    activeWorkspaceKey = null;
  }
}

/**
 * @param {{ mode?: string, dockedHeight?: number, workspaceKey?: string }} patch
 */
export function patchWorkspaceGeometry(patch = {}) {
  const key = patch.workspaceKey || activeWorkspaceKey;
  if (key) {
    saveWorkspaceSession(key, patch);
    if (key === activeWorkspaceKey) {
      const session = getSession(key);
      currentSnapshot = createSnapshot(session.mode, session.dockedHeight, key);
    }
  } else if (patch.mode) {
    currentSnapshot = createSnapshot(patch.mode, currentSnapshot.dockedHeight, null);
  } else if (Number.isFinite(patch.dockedHeight)) {
    const limits = computeWorkspaceLimits();
    currentSnapshot = createSnapshot(
      currentSnapshot.mode,
      clamp(patch.dockedHeight, limits.min, limits.max),
      activeWorkspaceKey
    );
  }
  emit();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

if (typeof globalThis !== 'undefined') {
  globalThis.__IQAI_WORKSPACE_GEOMETRY__ = {
    getWorkspaceGeometry,
    computeWorkspaceLimits,
    WORKSPACE_GEOMETRY_MODES
  };
}
