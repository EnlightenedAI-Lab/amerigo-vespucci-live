/**
 * Spatial V2 Ground Controller.
 * Mutates webmap.basemap in session only. Never saves the Portal WebMap.
 */

import { importArc } from '../map/arcgis-sdk.js';
import {
  getMapView,
  getRuntimePlane,
  getWebMap
} from '../map/map-foundation.js';
import {
  DATE_KIND,
  ENABLED_GROUND_MODES,
  GROUND_APPLY_STATE,
  GROUND_MODE,
  GROUND_MODE_LABEL,
  IMAGERY_PLANE_ID,
  IMAGERY_PLANE_TITLE
} from './imagery-contract.js';
import { canvasProvider } from './providers/canvas-provider.js';
import { esriWorldImageryProvider } from './providers/esri-world-imagery-provider.js';
import { legacyGoogleSatelliteDemoProvider } from './providers/legacy-google-satellite-demo-provider.js';
import { nearmapWmsGroundProvider } from './providers/nearmap-wms-ground-provider.js';

const listeners = new Set();
const constructedBasemaps = new Map();

let imageryPlane = null;
let authoredBasemap = null;
let authoredBackgroundJson = null;
let currentMode = GROUND_MODE.AUTHORED_WEBMAP;
let applyState = GROUND_APPLY_STATE.IDLE;
let lastError = null;
let lastReceipt = null;
let generation = 0;
let initPromise = null;

function emit() {
  const snapshot = getGroundSnapshot();
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch (error) {
      console.warn('[IQAI V2] ground controller listener failed', error);
    }
  }
}

function disabledLimitation(modeId) {
  if (modeId === GROUND_MODE.GOOGLE_SATELLITE) {
    return 'Official Google Map Tiles API entitlement is not configured. Use GOOGLE SATELLITE (DEMO) for internal display-only demo.';
  }
  if (modeId === GROUND_MODE.NEARMAP) {
    return 'Nearmap latest WMS is not configured on the server.';
  }
  if (modeId === GROUND_MODE.LOCAL_HIGHRES) {
    return 'No verified local WMS/WMTS is configured in this product.';
  }
  return 'This ground mode is not enabled.';
}

function observationForMode(modeId) {
  if (modeId === GROUND_MODE.PURE_BLACK || modeId === GROUND_MODE.PURE_WHITE) {
    return canvasProvider.observationFor(modeId);
  }
  if (modeId === GROUND_MODE.ESRI_WORLD_IMAGERY) return esriWorldImageryProvider.observationFor();
  if (modeId === GROUND_MODE.NEARMAP) return nearmapWmsGroundProvider.observationFor();
  if (modeId === GROUND_MODE.LEGACY_GOOGLE_SATELLITE_DEMO) {
    return legacyGoogleSatelliteDemoProvider.observationFor();
  }
  return {
    id: 'authored-webmap',
    providerId: 'authored-webmap',
    productName: 'Authored WebMap basemap',
    requestedDate: null,
    acquisitionDate: null,
    surveyInterval: null,
    releaseDate: null,
    firstPublicDate: null,
    serviceUpdateDate: null,
    vintageYear: null,
    vintageLabel: null,
    season: null,
    dateKindUsed: DATE_KIND.NONE,
    gsdMeters: null,
    footprint: null,
    sourceIdentity: { kind: 'webmap-basemap' },
    rights: {
      display: 'permitted',
      export: 'unknown',
      cache: 'unknown',
      analysis: 'unknown',
      attributionRequired: true
    },
    limitation: 'Restores the authored WebMap basemap. Not a dated imagery observation.',
    establishes: 'Authored portal cartographic canvas.',
    doesNotEstablish: 'Capture date or Time Machine observation.',
    accessState: null,
    assets: []
  };
}

function buildReceipt(modeId, extra = {}) {
  const observation = observationForMode(modeId);
  return {
    retrievedAt: new Date().toISOString(),
    modeId,
    label: GROUND_MODE_LABEL[modeId] || modeId,
    applyState,
    error: lastError,
    observation,
    ...extra
  };
}

async function ensureImageryPlane(webmap) {
  if (imageryPlane && !imageryPlane.destroyed) return imageryPlane;
  const existing = webmap.allLayers?.find?.((layer) => layer.id === IMAGERY_PLANE_ID)
    || webmap.layers?.find?.((layer) => layer.id === IMAGERY_PLANE_ID);
  if (existing) {
    imageryPlane = existing;
    return imageryPlane;
  }
  const GroupLayer = await importArc('@arcgis/core/layers/GroupLayer.js');
  imageryPlane = new GroupLayer({
    id: IMAGERY_PLANE_ID,
    title: IMAGERY_PLANE_TITLE,
    listMode: 'hide',
    visibilityMode: 'independent',
    layers: [],
    popupEnabled: false
  });
  imageryPlane.legendEnabled = false;
  webmap.layers.add(imageryPlane, 0);
  const runtime = getRuntimePlane();
  if (runtime && webmap.layers?.findIndex) {
    const idx = webmap.layers.findIndex((layer) => layer === runtime || layer?.id === runtime.id);
    if (idx >= 0) webmap.layers.reorder(runtime, webmap.layers.length - 1);
  }
  return imageryPlane;
}

async function waitViewIdle(view, timeoutMs = 14000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const idle = view.stationary !== false && view.updating === false;
    if (idle) {
      await new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      });
      if (view.stationary !== false && view.updating === false) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error('Map view settlement timed out');
}

async function settleBasemap(view, basemap) {
  const layers = [];
  const bases = basemap?.baseLayers;
  const list = bases?.toArray ? bases.toArray() : (bases ? [...bases] : []);
  for (const layer of list) {
    if (!layer) continue;
    try {
      if (typeof layer.load === 'function') await layer.load();
    } catch {
      // load failure is handled by LayerView wait / timeout
    }
    if (layer.visible !== false) layers.push(layer);
  }
  for (const layer of layers) {
    try {
      await Promise.race([
        view.whenLayerView(layer),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Basemap LayerView timed out')), 8000);
        })
      ]);
    } catch {
      // canvas / empty basemap has no LayerView; WMS may still paint after attach
    }
  }
  await waitViewIdle(view).catch(() => {});
}

async function applyBackground(webmap, view, color) {
  const ColorBackground = await importArc('@arcgis/core/webmap/background/ColorBackground.js');
  webmap.background = new ColorBackground({ color });
  view.background = new ColorBackground({ color });
}

async function restoreAuthoredBackground(webmap, view) {
  if (!authoredBackgroundJson) return;
  const ColorBackground = await importArc('@arcgis/core/webmap/background/ColorBackground.js');
  const restored = ColorBackground.fromJSON
    ? ColorBackground.fromJSON(authoredBackgroundJson)
    : new ColorBackground(authoredBackgroundJson);
  webmap.background = restored;
  view.background = ColorBackground.fromJSON
    ? ColorBackground.fromJSON(authoredBackgroundJson)
    : new ColorBackground(authoredBackgroundJson);
}

async function canvasBasemap(modeId) {
  const cached = constructedBasemaps.get(modeId);
  if (cached && !cached.destroyed) return cached;
  const Basemap = await importArc('@arcgis/core/Basemap.js');
  const basemap = new Basemap({
    id: modeId === GROUND_MODE.PURE_WHITE ? 'iqai-ground-pure-white' : 'iqai-ground-pure-black',
    title: modeId === GROUND_MODE.PURE_WHITE ? 'Pure White' : 'Pure Black',
    baseLayers: []
  });
  constructedBasemaps.set(modeId, basemap);
  return basemap;
}

async function constructedBasemapFor(modeId) {
  const cached = constructedBasemaps.get(modeId);
  if (cached && !cached.destroyed) return cached;
  let created = null;
  if (modeId === GROUND_MODE.ESRI_WORLD_IMAGERY) {
    created = await esriWorldImageryProvider.createBasemap();
  } else if (modeId === GROUND_MODE.NEARMAP) {
    created = await nearmapWmsGroundProvider.createBasemap();
  } else if (modeId === GROUND_MODE.LEGACY_GOOGLE_SATELLITE_DEMO) {
    created = await legacyGoogleSatelliteDemoProvider.createBasemap();
  } else if (modeId === GROUND_MODE.PURE_BLACK || modeId === GROUND_MODE.PURE_WHITE) {
    created = await canvasBasemap(modeId);
  }
  if (created) constructedBasemaps.set(modeId, created);
  return created;
}

async function applyMode(modeId) {
  const webmap = getWebMap();
  const view = getMapView();
  if (!webmap || !view) throw new Error('Map foundation is not ready.');

  if (modeId === GROUND_MODE.AUTHORED_WEBMAP) {
    if (!authoredBasemap) throw new Error('Authored basemap snapshot is missing.');
    webmap.basemap = authoredBasemap;
    await restoreAuthoredBackground(webmap, view);
    await settleBasemap(view, webmap.basemap);
    return;
  }

  if (modeId === GROUND_MODE.PURE_BLACK || modeId === GROUND_MODE.PURE_WHITE) {
    webmap.basemap = await canvasBasemap(modeId);
    await applyBackground(webmap, view, modeId === GROUND_MODE.PURE_WHITE ? [255, 255, 255, 1] : [0, 0, 0, 1]);
    await waitViewIdle(view, 6000).catch(() => {});
    return;
  }

  const next = await constructedBasemapFor(modeId);
  if (!next) throw new Error(`No basemap constructor for ${modeId}`);
  webmap.basemap = next;
  await restoreAuthoredBackground(webmap, view);
  await settleBasemap(view, next);
}

export function subscribeGroundController(listener) {
  listeners.add(listener);
  listener(getGroundSnapshot());
  return () => listeners.delete(listener);
}

export function getGroundSnapshot() {
  return {
    currentMode,
    label: GROUND_MODE_LABEL[currentMode] || currentMode,
    applyState,
    error: lastError,
    receipt: lastReceipt,
    imageryPlaneId: IMAGERY_PLANE_ID,
    hasImageryPlane: Boolean(imageryPlane),
    enabledModes: [...ENABLED_GROUND_MODES]
  };
}

export function getImageryPlane() {
  return imageryPlane;
}

export function getGroundMode() {
  return currentMode;
}

export function listGroundModes() {
  const all = Object.values(GROUND_MODE);
  return all.map((id) => ({
    id,
    label: GROUND_MODE_LABEL[id],
    enabled: ENABLED_GROUND_MODES.includes(id),
    limitation: ENABLED_GROUND_MODES.includes(id) ? null : disabledLimitation(id)
  }));
}

export function getGroundReceipt() {
  return lastReceipt;
}

export async function initGroundController() {
  if (imageryPlane && authoredBasemap) return getGroundSnapshot();
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const webmap = getWebMap();
    const view = getMapView();
    if (!webmap || !view) throw new Error('Map foundation is not ready.');
    authoredBasemap = webmap.basemap;
    authoredBackgroundJson = webmap.background?.toJSON?.() || null;
    await ensureImageryPlane(webmap);
    currentMode = GROUND_MODE.AUTHORED_WEBMAP;
    applyState = GROUND_APPLY_STATE.READY;
    lastReceipt = buildReceipt(currentMode);
    emit();
    return getGroundSnapshot();
  })().catch((error) => {
    initPromise = null;
    applyState = GROUND_APPLY_STATE.ERROR;
    lastError = String(error?.message || error);
    emit();
    throw error;
  });
  return initPromise;
}

export async function setGroundMode(modeId) {
  if (!ENABLED_GROUND_MODES.includes(modeId)) {
    lastError = disabledLimitation(modeId);
    applyState = GROUND_APPLY_STATE.ERROR;
    emit();
    throw new Error(lastError);
  }
  await initGroundController();
  const previous = currentMode;
  const token = ++generation;
  applyState = GROUND_APPLY_STATE.APPLYING;
  lastError = null;
  emit();
  try {
    await applyMode(modeId);
    if (token !== generation) return getGroundSnapshot();
    currentMode = modeId;
    applyState = GROUND_APPLY_STATE.READY;
    lastReceipt = buildReceipt(modeId);
    emit();
    return getGroundSnapshot();
  } catch (error) {
    if (token !== generation) return getGroundSnapshot();
    lastError = String(error?.message || error);
    try {
      await applyMode(previous);
      currentMode = previous;
    } catch {
      // keep previous id even if rollback display failed
    }
    applyState = GROUND_APPLY_STATE.ERROR;
    lastReceipt = buildReceipt(currentMode, { failedModeId: modeId });
    emit();
    throw error;
  }
}

export async function restoreAuthoredBasemap() {
  return setGroundMode(GROUND_MODE.AUTHORED_WEBMAP);
}
