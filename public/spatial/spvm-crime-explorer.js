/**
 * SPVM crime operational explorer — orchestration and single filter state.
 */

import { getMapView } from './spatial-arcgis-runtime.js';
import {
  createDefaultSpvmFilterState,
  cloneSpvmFilterState,
  computeSpvmAnalytics,
  buildSpvmDefinitionExpression
} from './spvm-crime-filter.js';
import {
  SPVM_ALL_CATEGORIES,
  SPVM_ALL_SHIFTS,
  SPVM_SHIFT_UI,
  SPVM_CATEGORY_DEFS,
  englishLabelForCategory,
  categoryDefForFrench
} from './spvm-crime-taxonomy.js';
import { SPVM_LOCAL_STATUS_URL } from './spvm-recent-crime-config.js';
import {
  applySpvmLayerPresentation,
  buildSpvmIncidentsRenderer,
  buildSpvmClusterReduction
} from './spvm-crime-render.js';
import { buildSpvmCrimeTableModel } from './spvm-crime-results.js';
import { getSpvmLayer, isSpvmDesiredVisible } from './spvm-recent-crime.js';
import { setOperationalLegendContent } from './spatial-arcgis-runtime.js';

/** @type {ReturnType<typeof createDefaultSpvmFilterState> | null} */
let filterState = null;
/** @type {Array<{ attributes?: object, geometry?: object }>} */
let allGraphics = [];
/** @type {object | null} */
let statusSnapshot = null;
/** @type {Set<(payload: object) => void>} */
const listeners = new Set();
let graphicsLoaded = false;
let active = false;
/** @type {'LOADING'|'READY_WITH_DATA'|'READY_ZERO_RESULTS'|'ERROR'|'IDLE'} */
let dataStatus = 'IDLE';
/** @type {string|null} */
let dataError = null;

function resolveDataStatus() {
  if (!graphicsLoaded) return dataStatus === 'LOADING' ? 'LOADING' : 'IDLE';
  if (dataStatus === 'ERROR') return 'ERROR';
  return allGraphics.length > 0 ? 'READY_WITH_DATA' : 'READY_ZERO_RESULTS';
}

function emit() {
  const analytics = getAnalytics();
  const payload = {
    state: cloneSpvmFilterState(filterState || createDefaultSpvmFilterState()),
    analytics,
    tableModel: buildSpvmCrimeTableModel(analytics.filteredGraphics),
    status: statusSnapshot,
    active,
    dataStatus: resolveDataStatus(),
    dataError,
    sourceFeatureCount: allGraphics.length
  };
  for (const listener of listeners) listener(payload);
}

export function subscribeSpvmExplorer(listener) {
  listeners.add(listener);
  listener({
    state: cloneSpvmFilterState(filterState || createDefaultSpvmFilterState()),
    analytics: getAnalytics(),
    tableModel: buildSpvmCrimeTableModel(getAnalytics().filteredGraphics),
    status: statusSnapshot,
    active,
    dataStatus: resolveDataStatus(),
    dataError,
    sourceFeatureCount: allGraphics.length
  });
  return () => listeners.delete(listener);
}

export function getSpvmFilterState() {
  return cloneSpvmFilterState(filterState || createDefaultSpvmFilterState());
}

export function isSpvmExplorerActive() {
  return active;
}

export function getAnalytics() {
  const state = filterState || createDefaultSpvmFilterState();
  return computeSpvmAnalytics(allGraphics, state);
}

async function loadAllGraphics(layer) {
  if (!layer) return [];
  await layer.load();
  const savedExpression = layer.definitionExpression;
  layer.definitionExpression = null;
  try {
    const query = layer.createQuery();
    query.where = '1=1';
    query.outFields = ['*'];
    query.returnGeometry = true;
    const result = await layer.queryFeatures(query);
    return result.features || [];
  } finally {
    if (!savedExpression) {
      layer.definitionExpression = null;
    }
  }
}

/**
 * Load authoritative SPVM records from the registered GeoJSONLayer once.
 * @returns {Promise<boolean>}
 */
export async function ensureSpvmExplorerData() {
  const layer = getSpvmLayer();
  if (!layer) return false;
  if (graphicsLoaded) return true;

  dataStatus = 'LOADING';
  dataError = null;
  emit();

  try {
    allGraphics = await loadAllGraphics(layer);
    graphicsLoaded = true;
    statusSnapshot = await fetchStatus();
    dataStatus = allGraphics.length > 0 ? 'READY_WITH_DATA' : 'READY_ZERO_RESULTS';
    dataError = null;
    return true;
  } catch (error) {
    dataStatus = 'ERROR';
    dataError = error?.message || String(error);
    console.warn('[IQAI] SPVM explorer data load failed', dataError);
    emit();
    return false;
  }
}

async function fetchStatus() {
  try {
    const response = await fetch(SPVM_LOCAL_STATUS_URL, { cache: 'no-store' });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function applyLayerFilters() {
  const layer = getSpvmLayer();
  if (!layer || !filterState) return;
  if (!layer.loaded) await layer.load();
  const expression = buildSpvmDefinitionExpression(filterState, undefined, layer);
  layer.definitionExpression = expression;
  await applySpvmLayerPresentation(layer, filterState.viewMode);
  updateOperationalLegend();
}

function updateOperationalLegend() {
  // Category legend lives in workspace CATEGORIES tab — keep map clean.
  if (active) {
    setOperationalLegendContent('');
    return;
  }
  setOperationalLegendContent('');
}

/**
 * @param {Partial<ReturnType<typeof createDefaultSpvmFilterState>>} patch
 */
export async function patchSpvmFilterState(patch = {}) {
  if (!filterState) filterState = createDefaultSpvmFilterState();
  if (patch.windowDays === 7 || patch.windowDays === 30 || patch.windowDays === 90) {
    filterState.windowDays = patch.windowDays;
  }
  if (patch.viewMode === 'INCIDENTS' || patch.viewMode === 'DENSITY') {
    filterState.viewMode = patch.viewMode;
  }
  if (patch.shifts instanceof Set) {
    filterState.shifts = new Set(patch.shifts);
  }
  if (patch.categories instanceof Set) {
    filterState.categories = new Set(patch.categories);
  }
  await applyLayerFilters();
  emit();
}

export async function setSpvmWindowDays(days) {
  await patchSpvmFilterState({ windowDays: days });
}

export async function setSpvmViewMode(mode) {
  await patchSpvmFilterState({ viewMode: mode });
}

export async function setSpvmShiftUi(key) {
  const entry = SPVM_SHIFT_UI.find((item) => item.key === key);
  if (!entry) return;
  await patchSpvmFilterState({ shifts: new Set(entry.shifts) });
}

export async function toggleSpvmCategory(french, selected) {
  if (!filterState) filterState = createDefaultSpvmFilterState();
  const categories = new Set(filterState.categories);
  if (selected) categories.add(french);
  else categories.delete(french);
  await patchSpvmFilterState({ categories });
}

export async function selectAllSpvmCategories() {
  await patchSpvmFilterState({ categories: new Set(SPVM_ALL_CATEGORIES) });
}

export async function clearAllSpvmCategories() {
  await patchSpvmFilterState({ categories: new Set() });
}

/**
 * @param {ReturnType<typeof createDefaultSpvmFilterState>} state
 */
export async function applySpvmExplorerState(state) {
  filterState = cloneSpvmFilterState(state);
  await applyLayerFilters();
  emit();
}

export async function activateSpvmExplorer() {
  const layer = getSpvmLayer();
  if (!layer) {
    dataStatus = 'LOADING';
    dataError = null;
    emit();
    return false;
  }
  try {
    active = true;
    if (!filterState) filterState = createDefaultSpvmFilterState();

    const loaded = await ensureSpvmExplorerData();
    if (!loaded) {
      active = false;
      return false;
    }

    await applyLayerFilters();
    emit();
    return true;
  } catch (error) {
    console.warn('[IQAI] SPVM explorer activation failed', error?.message || error);
    dataStatus = 'ERROR';
    dataError = error?.message || String(error);
    active = false;
    emit();
    return false;
  }
}

export async function deactivateSpvmExplorer() {
  active = false;
  setOperationalLegendContent('');
  emit();
}

/**
 * Initialize explorer when layer is first registered.
 */
export async function initSpvmCrimeExplorer() {
  const layer = getSpvmLayer();
  if (!layer) return;
  await layer.load();
  if (isSpvmDesiredVisible() && !layer.visible) {
    layer.visible = true;
  }
  await applySpvmLayerPresentation(layer, 'INCIDENTS');
  await ensureSpvmExplorerData();
  if (layer.visible || isSpvmDesiredVisible()) {
    await activateSpvmExplorer();
  } else if (graphicsLoaded) {
    emit();
  }
}

/**
 * Refresh workspace after runtime layer registration when UI may already be visible.
 */
export async function refreshSpvmExplorerIfVisible() {
  const layer = getSpvmLayer();
  if (!layer) return false;
  if (isSpvmDesiredVisible() && !layer.visible) {
    layer.visible = true;
  }
  if (!layer.visible) return false;
  return activateSpvmExplorer();
}

/**
 * @param {string} recordId
 */
export async function selectSpvmCrimeFeature(recordId) {
  const layer = getSpvmLayer();
  const view = getMapView();
  if (!layer || !view || !recordId) return { ok: false };

  const graphic = allGraphics.find((entry) => {
    const attrs = entry.attributes || {};
    return String(attrs.id || entry.id || attrs.OBJECTID) === String(recordId);
  });

  if (!graphic?.geometry) return { ok: false };

  try {
    await view.goTo({ center: graphic.geometry }, { duration: 400 });
    try {
      const layerView = await view.whenLayerView(layer);
      if (layerView?.highlight) {
        const objectId = graphic.attributes?.OBJECTID ?? graphic.attributes?.id;
        const handle = objectId != null && objectId !== ''
          ? layerView.highlight(Number(objectId) || objectId)
          : layerView.highlight(graphic);
        void handle;
      }
    } catch {
      // ignore highlight failures
    }
    if (view.popup) {
      view.openPopup({
        features: [graphic],
        location: graphic.geometry
      });
    }
    return { ok: true, graphic, layer };
  } catch {
    return { ok: false };
  }
}

export function getSpvmSourceFeatureCount() {
  return allGraphics.length;
}

export function getSpvmDataStatus() {
  return resolveDataStatus();
}

/**
 * Browser diagnostic hook — run in authenticated devtools:
 * await __IQAI_SPVM_DIAG__()
 */
export async function runSpvmRuntimeDiagnostic() {
  const layer = getSpvmLayer();
  const state = createDefaultSpvmFilterState();
  const out = {
    layerRegistered: Boolean(layer),
    layerVisible: layer?.visible ?? false,
    layerLoaded: layer?.loaded ?? false,
    sourceUrl: layer?.url || null,
    layerFields: (layer?.fields || []).map((f) => ({ name: f.name, type: f.type })),
    sourceFeatureCount: allGraphics.length,
    dataStatus: resolveDataStatus(),
    defaultDefinitionExpression: buildSpvmDefinitionExpression(state, undefined, layer),
    analytics30D: getAnalytics().total,
    queryAllCount: null,
    queryDefExprCount: null,
    bypass1to1Count: null
  };
  if (!layer) return out;
  if (!layer.loaded) await layer.load();
  out.defaultDefinitionExpression = buildSpvmDefinitionExpression(state, undefined, layer);
  out.analytics30D = getAnalytics().total;

  const saved = layer.definitionExpression;
  layer.definitionExpression = null;
  const qAll = layer.createQuery();
  qAll.where = '1=1';
  qAll.returnGeometry = false;
  out.queryAllCount = (await layer.queryFeatures(qAll)).features?.length ?? 0;

  layer.definitionExpression = out.defaultDefinitionExpression;
  const qDef = layer.createQuery();
  qDef.where = '1=1';
  qDef.returnGeometry = false;
  out.queryDefExprCount = (await layer.queryFeatures(qDef)).features?.length ?? 0;

  layer.definitionExpression = '1=1';
  const qBypass = layer.createQuery();
  qBypass.where = '1=1';
  qBypass.returnGeometry = false;
  out.bypass1to1Count = (await layer.queryFeatures(qBypass)).features?.length ?? 0;
  layer.definitionExpression = saved;
  return out;
}

if (typeof globalThis !== 'undefined') {
  globalThis.__IQAI_SPVM_DIAG__ = runSpvmRuntimeDiagnostic;
}

export function getSpvmCategoryDefs() {
  return SPVM_CATEGORY_DEFS;
}

export function getSpvmShiftUi() {
  return SPVM_SHIFT_UI;
}

export function getSpvmAllShifts() {
  return SPVM_ALL_SHIFTS;
}

export function englishCategoryLabel(french) {
  return englishLabelForCategory(french);
}

export function categorySymbolStyle(french) {
  const def = categoryDefForFrench(french);
  if (!def) return null;
  return `rgb(${def.color.slice(0, 3).join(',')})`;
}
