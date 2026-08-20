/**
 * Spatial V2 Ground Controller.
 * Mutates webmap.basemap in session only. Never saves the Portal WebMap.
 */

import { importArc } from '../map/arcgis-sdk.js';
import {
  getIqaiGroundSurface,
  getMapView,
  getRuntimePlane,
  getWebMap,
  setIqaiGroundSurface
} from '../map/map-foundation.js';
import {
  DATE_KIND,
  ENABLED_GROUND_MODES,
  GROUND_APPLY_STATE,
  GROUND_MODE,
  GROUND_MODE_LABEL,
  DISPLAY_STATE,
  IMAGERY_PLANE_ID,
  PROVIDER_READINESS_STATE,
  TIME_ENGINE_LAYER_ID
} from './imagery-contract.js';
import { ensureImageryObservationSlot } from './imagery-plane.js';
import { canvasProvider } from './providers/canvas-provider.js';
import { esriWorldImageryProvider } from './providers/esri-world-imagery-provider.js';
import { googleMapTilesProvider } from './providers/google-map-tiles-provider.js';
import { legacyGoogleSatelliteDemoProvider } from './providers/legacy-google-satellite-demo-provider.js';
import {
  applyAuthoredNearmapGround,
  findNearmapGroundLayer,
  nearmapWmsGroundProvider,
  restoreAuthoredNearmapGround
} from './providers/nearmap-wms-ground-provider.js';

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
let readinessPromise = null;
let providerReadiness = {
  [GROUND_MODE.GOOGLE_SATELLITE]: {
    readinessState: PROVIDER_READINESS_STATE.NOT_CONFIGURED,
    limitation: 'Official Google Map Tiles API readiness has not been probed.'
  },
  [GROUND_MODE.NEARMAP]: {
    readinessState: PROVIDER_READINESS_STATE.NOT_CONFIGURED,
    limitation: 'Nearmap latest WMS readiness has not been probed.'
  },
  [GROUND_MODE.LOCAL_HIGHRES]: {
    readinessState: PROVIDER_READINESS_STATE.NOT_CONFIGURED,
    limitation: 'No verified local WMS/WMTS is configured in this product.'
  },
  [GROUND_MODE.LEGACY_GOOGLE_SATELLITE_DEMO]: {
    readinessState: PROVIDER_READINESS_STATE.UNAVAILABLE,
    limitation: 'Disabled by strategic authority. Google ground must use the official Google Map Tiles API.'
  }
};

function readinessForMode(modeId) {
  if (ENABLED_GROUND_MODES.includes(modeId)) {
    return {
      readinessState: PROVIDER_READINESS_STATE.READY,
      limitation: null
    };
  }
  return providerReadiness[modeId] || {
    readinessState: PROVIDER_READINESS_STATE.UNAVAILABLE,
    limitation: 'This ground mode is unavailable.'
  };
}

function modeEnabled(modeId) {
  if (ENABLED_GROUND_MODES.includes(modeId)) return true;
  const readiness = readinessForMode(modeId);
  if (readiness.readinessState !== PROVIDER_READINESS_STATE.READY) return false;
  if (modeId === GROUND_MODE.NEARMAP) return true;
  return modeId === GROUND_MODE.GOOGLE_SATELLITE
    && readiness.runtimeIntegrated === true;
}

async function refreshProviderReadiness() {
  if (readinessPromise) return readinessPromise;
  readinessPromise = Promise.race([
    Promise.all([
      googleMapTilesProvider.probeReadiness(),
      nearmapWmsGroundProvider.probeReadiness()
    ]),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Provider readiness probe timed out')), 8000);
    })
  ]).then(([google, nearmap]) => {
    providerReadiness = {
      ...providerReadiness,
      [GROUND_MODE.GOOGLE_SATELLITE]: google,
      [GROUND_MODE.NEARMAP]: nearmap
    };
    return providerReadiness;
  }).finally(() => {
    readinessPromise = null;
  });
  return readinessPromise;
}

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
  return readinessForMode(modeId).limitation || 'This ground mode is not enabled.';
}

function observationForMode(modeId) {
  if (modeId === GROUND_MODE.PURE_BLACK || modeId === GROUND_MODE.PURE_WHITE) {
    return canvasProvider.observationFor(modeId);
  }
  if (modeId === GROUND_MODE.ESRI_WORLD_IMAGERY) return esriWorldImageryProvider.observationFor();
  if (modeId === GROUND_MODE.NEARMAP) return nearmapWmsGroundProvider.observationFor();
  if (modeId === GROUND_MODE.GOOGLE_SATELLITE) {
    return googleMapTilesProvider.observationFor(readinessForMode(modeId));
  }
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
  const slot = await ensureImageryObservationSlot(webmap);
  imageryPlane = slot.imageryPlane;
  if (imageryPlane && !(imageryPlane.layers?.length)) imageryPlane.visible = false;
  const runtime = getRuntimePlane();
  if (runtime && !(runtime.layers?.length)) runtime.visible = false;
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

function summarizeGroundPixels(imageData) {
  const pixels = imageData?.data;
  if (!pixels?.length) {
    return { opaquePixelCount: 0, opaqueShare: 0, contrast: 0, error: 'no screenshot pixels' };
  }
  let sampledPixelCount = 0;
  let opaquePixelCount = 0;
  let min = 255;
  let max = 0;
  for (let i = 0; i < pixels.length; i += 16) {
    sampledPixelCount += 1;
    if (pixels[i + 3] <= 8) continue;
    const lum = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
    min = Math.min(min, lum);
    max = Math.max(max, lum);
    opaquePixelCount += 1;
  }
  return {
    width: imageData.width,
    height: imageData.height,
    sampledPixelCount,
    opaquePixelCount,
    opaqueShare: sampledPixelCount ? opaquePixelCount / sampledPixelCount : 0,
    contrast: opaquePixelCount ? Math.round(max - min) : 0
  };
}

const GROUND_PROOF_SAMPLE_PX = 512;
const GROUND_PROOF_SCREENSHOT_MS = 8000;
const GROUND_PROOF_PAINT_WAIT_MS = 6000;
const GROUND_PROOF_CAPTURE_ATTEMPTS = 2;
const GROUND_PROOF_OUTER_MS = 32000;

function groundProofSampleArea(view) {
  const viewWidth = Math.max(1, Math.floor(Number(view?.width) || view?.container?.clientWidth || 1));
  const viewHeight = Math.max(1, Math.floor(Number(view?.height) || view?.container?.clientHeight || 1));
  const width = Math.min(GROUND_PROOF_SAMPLE_PX, viewWidth);
  const height = Math.min(GROUND_PROOF_SAMPLE_PX, viewHeight);
  return {
    x: Math.max(0, Math.floor((viewWidth - width) / 2)),
    y: Math.max(0, Math.floor((viewHeight - height) / 2)),
    width,
    height,
    viewWidth,
    viewHeight
  };
}

function waitGroundFrames() {
  return Promise.race([
    new Promise((resolve) => {
      if (typeof requestAnimationFrame !== 'function') {
        setTimeout(resolve, 32);
        return;
      }
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }),
    new Promise((resolve) => setTimeout(resolve, 250))
  ]);
}

async function isolatedGroundPixels(view, layer) {
  const sample = groundProofSampleArea(view);
  const captured = await Promise.race([
    view.takeScreenshot({
      format: 'png',
      layers: [layer],
      ignorePadding: true,
      area: { x: sample.x, y: sample.y, width: sample.width, height: sample.height },
      width: sample.width,
      height: sample.height
    }),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Ground layer screenshot timed out')), GROUND_PROOF_SCREENSHOT_MS);
    })
  ]);
  let pixels;
  if (captured?.data?.data) {
    pixels = summarizeGroundPixels(captured.data);
  } else {
    const dataUrl = captured?.dataUrl;
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) {
      return {
        opaquePixelCount: 0,
        opaqueShare: 0,
        contrast: 0,
        sample,
        error: 'no screenshot data'
      };
    }
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('Ground screenshot image failed'));
      image.src = dataUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    pixels = summarizeGroundPixels(context.getImageData(0, 0, canvas.width, canvas.height));
  }
  return { ...pixels, sample };
}

function nearmapNetworkReceipt(resourceStartTime) {
  const entries = typeof performance !== 'undefined' && performance.getEntriesByType
    ? performance.getEntriesByType('resource')
    : [];
  const matched = entries.filter((entry) => {
    const name = String(entry.name || '');
    if (Number(entry.startTime || 0) < Number(resourceStartTime || 0)) return false;
    return /\/api\/spatial-v2\/imagery\/nearmap\/wms/i.test(name)
      || /\/wms\/v1\/(?:latest\/)?apikey\//i.test(name);
  });
  return {
    resourceTimingEntryCount: matched.length,
    responseStatuses: matched.reduce((statuses, entry) => {
      const status = Number(entry.responseStatus || 0);
      const key = status > 0 ? String(status) : 'unknown';
      statuses[key] = (statuses[key] || 0) + 1;
      return statuses;
    }, {}),
    sampleUrls: matched.slice(0, 3).map((entry) => {
      const url = new URL(entry.name);
      return `${url.origin}${url.pathname}?SERVICE=WMS&REQUEST=GetMap`;
    })
  };
}

async function confirmNearmapGroundDisplay(resourceStartTime) {
  const view = getMapView();
  const webmap = getWebMap();
  const layer = findNearmapGroundLayer(webmap);
  const evidence = {
    method: 'mapview-ground-layer-isolated-screenshot-v1',
    providerId: 'nearmap-wms-latest',
    authoredLayerId: layer?.id || null,
    layerId: layer?.id || null,
    layerView: null,
    network: nearmapNetworkReceipt(resourceStartTime),
    screenshot: { opaquePixelCount: 0, opaqueShare: 0, contrast: 0 },
    attempts: 0,
    confirmed: false,
    error: null
  };
  if (!view || !layer) {
    evidence.error = 'Nearmap ground layer is unavailable.';
    return evidence;
  }
  let layerView = null;
  const layerViewDeadline = Date.now() + 8000;
  while (!layerView && Date.now() < layerViewDeadline) {
    const operational = view.allLayerViews?.toArray ? view.allLayerViews.toArray() : [];
    const basemap = view.basemapView?.baseLayerViews?.toArray
      ? view.basemapView.baseLayerViews.toArray()
      : [];
    const reference = view.basemapView?.referenceLayerViews?.toArray
      ? view.basemapView.referenceLayerViews.toArray()
      : [];
    layerView = [...operational, ...basemap, ...reference]
      .find((item) => item?.layer === layer || item?.layer?.id === layer.id) || null;
    if (!layerView) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!layerView) {
    evidence.error = 'Nearmap ground LayerView timed out';
    return evidence;
  }
  const paintDeadline = Date.now() + GROUND_PROOF_PAINT_WAIT_MS;
  while (Date.now() < paintDeadline) {
    evidence.attempts += 1;
    if (typeof view.requestRender === 'function') view.requestRender();
    await waitGroundFrames();
    evidence.layerView = {
      ready: true,
      suspended: layerView.suspended === true,
      updating: layerView.updating === true,
      visible: layerView.visible !== false,
      visibleAtCurrentScale: layerView.visibleAtCurrentScale !== false
    };
    evidence.network = nearmapNetworkReceipt(resourceStartTime);
    if (evidence.layerView.suspended === false && evidence.layerView.visible) {
      if (evidence.network.resourceTimingEntryCount > 0 || Date.now() + 2500 >= paintDeadline) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const deadline = Date.now() + 14000;
  let screenshotAttempts = 0;
  while (Date.now() < deadline && screenshotAttempts < GROUND_PROOF_CAPTURE_ATTEMPTS) {
    evidence.attempts += 1;
    if (typeof view.requestRender === 'function') view.requestRender();
    await waitGroundFrames();
    evidence.layerView = {
      ready: true,
      suspended: layerView.suspended === true,
      updating: layerView.updating === true,
      visible: layerView.visible !== false,
      visibleAtCurrentScale: layerView.visibleAtCurrentScale !== false
    };
    evidence.network = nearmapNetworkReceipt(resourceStartTime);
    if (evidence.layerView.suspended === true || evidence.layerView.visible !== true) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      continue;
    }
    screenshotAttempts += 1;
    try {
      evidence.screenshot = await isolatedGroundPixels(view, layer);
      evidence.error = evidence.screenshot.error || null;
    } catch (error) {
      evidence.error = String(error?.message || error);
    }
    evidence.confirmed = Boolean(
      evidence.screenshot.opaquePixelCount >= 256
      && evidence.screenshot.opaqueShare >= 0.05
      && evidence.screenshot.contrast >= 16
    );
    if (evidence.confirmed) {
      evidence.error = null;
      evidence.capturedAt = new Date().toISOString();
      return evidence;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  evidence.error = evidence.error || 'Nearmap ground pixels were not confirmed before timeout.';
  return evidence;
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
  try {
    const ColorBackground = await importArc('@arcgis/core/webmap/background/ColorBackground.js');
    const restored = ColorBackground.fromJSON
      ? ColorBackground.fromJSON(authoredBackgroundJson)
      : new ColorBackground(authoredBackgroundJson);
    webmap.background = restored;
    view.background = ColorBackground.fromJSON
      ? ColorBackground.fromJSON(authoredBackgroundJson)
      : new ColorBackground(authoredBackgroundJson);
  } catch {
    // authored background restore must not roll back a public aerial/map swap
  }
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
  } else if (modeId === GROUND_MODE.GOOGLE_SATELLITE) {
    created = await googleMapTilesProvider.createBasemap();
  } else if (modeId === GROUND_MODE.LEGACY_GOOGLE_SATELLITE_DEMO) {
    created = await legacyGoogleSatelliteDemoProvider.createBasemap();
  } else if (modeId === GROUND_MODE.PURE_BLACK || modeId === GROUND_MODE.PURE_WHITE) {
    created = await canvasBasemap(modeId);
  }
  if (created) constructedBasemaps.set(modeId, created);
  return created;
}

function hideTimeObservationForGround() {
  const webmap = getWebMap();
  const observation = webmap?.allLayers?.find?.((layer) => layer?.id === TIME_ENGINE_LAYER_ID) || null;
  if (observation) observation.visible = false;
  if (imageryPlane && !(imageryPlane.layers?.length)) imageryPlane.visible = false;
}

async function applyMode(modeId) {
  const webmap = getWebMap();
  const view = getMapView();
  if (!webmap || !view) throw new Error('Map foundation is not ready.');

  if (modeId !== GROUND_MODE.NEARMAP) restoreAuthoredNearmapGround();

  if (modeId === GROUND_MODE.NEARMAP) {
    hideTimeObservationForGround();
    await setIqaiGroundSurface('aerial');
    await applyAuthoredNearmapGround(webmap).catch(() => {});
    if (typeof view.requestRender === 'function') view.requestRender();
    return;
  }

  if (modeId === GROUND_MODE.AUTHORED_WEBMAP) {
    if (!authoredBasemap) throw new Error('Authored basemap snapshot is missing.');
    await setIqaiGroundSurface('map');
    webmap.basemap = authoredBasemap;
    await restoreAuthoredBackground(webmap, view);
    await settleBasemap(view, webmap.basemap);
    return;
  }

  if (modeId === GROUND_MODE.PURE_BLACK || modeId === GROUND_MODE.PURE_WHITE) {
    await setIqaiGroundSurface('map');
    webmap.basemap = await canvasBasemap(modeId);
    await applyBackground(webmap, view, modeId === GROUND_MODE.PURE_WHITE ? [255, 255, 255, 1] : [0, 0, 0, 1]);
    await waitViewIdle(view, 6000).catch(() => {});
    return;
  }

  if (modeId === GROUND_MODE.ESRI_WORLD_IMAGERY) {
    await setIqaiGroundSurface('aerial');
    await restoreAuthoredBackground(webmap, view);
    await waitViewIdle(view, 700).catch(() => {});
    if (getIqaiGroundSurface() !== 'aerial') {
      throw new Error('Aerial WebTileLayer did not become visible.');
    }
    return;
  }

  await setIqaiGroundSurface('map');
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
    enabledModes: Object.values(GROUND_MODE).filter(modeEnabled),
    displayConfirmed: lastReceipt?.displayEvidence?.confirmed === true,
    displayState: lastReceipt?.displayEvidence?.confirmed === true
      ? DISPLAY_STATE.DISPLAY_CONFIRMED
      : (currentMode === GROUND_MODE.NEARMAP
        ? DISPLAY_STATE.DISPLAY_NOT_CONFIRMED
        : DISPLAY_STATE.NONE),
    providerReadiness: Object.fromEntries(
      Object.entries(providerReadiness).map(([modeId, status]) => [modeId, { ...status }])
    )
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
    enabled: modeEnabled(id),
    readinessState: readinessForMode(id).readinessState,
    limitation: modeEnabled(id) ? null : disabledLimitation(id)
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
    await refreshProviderReadiness();
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
  if (modeId === GROUND_MODE.GOOGLE_SATELLITE || modeId === GROUND_MODE.NEARMAP) {
    await refreshProviderReadiness();
  }
  if (!modeEnabled(modeId)) {
    lastError = disabledLimitation(modeId);
    applyState = GROUND_APPLY_STATE.ERROR;
    emit();
    throw new Error(lastError);
  }
  await initGroundController();
  const previous = currentMode;
  const token = ++generation;
  const resourceStartTime = typeof performance !== 'undefined' && Number.isFinite(performance.now?.())
    ? performance.now()
    : 0;
  let displayEvidence = null;
  applyState = GROUND_APPLY_STATE.APPLYING;
  lastError = null;
  emit();
  try {
    await applyMode(modeId);
    if (modeId === GROUND_MODE.NEARMAP) {
      displayEvidence = await Promise.race([
        confirmNearmapGroundDisplay(resourceStartTime),
        new Promise((resolve) => {
          setTimeout(() => resolve({
            method: 'mapview-ground-layer-isolated-screenshot-v1',
            confirmed: false,
            error: 'Nearmap ground display proof timed out.'
          }), GROUND_PROOF_OUTER_MS);
        })
      ]);
      if (!displayEvidence.confirmed) {
        providerReadiness = {
          ...providerReadiness,
          [GROUND_MODE.NEARMAP]: {
            ...providerReadiness[GROUND_MODE.NEARMAP],
            readinessState: PROVIDER_READINESS_STATE.UNAVAILABLE,
            serviceReachable: true,
            displayConfirmed: false,
            limitation: displayEvidence.error || 'Nearmap ground pixels were not confirmed.'
          }
        };
        throw new Error(displayEvidence.error || 'Nearmap ground pixels were not confirmed.');
      }
      providerReadiness = {
        ...providerReadiness,
        [GROUND_MODE.NEARMAP]: {
          ...providerReadiness[GROUND_MODE.NEARMAP],
          readinessState: PROVIDER_READINESS_STATE.READY,
          serviceReachable: true,
          displayConfirmed: true,
          limitation: 'Nearmap latest WMS is display-confirmed current ground; it exposes no dated observations.'
        }
      };
    }
    if (token !== generation) return getGroundSnapshot();
    currentMode = modeId;
    applyState = GROUND_APPLY_STATE.READY;
    lastReceipt = buildReceipt(modeId, { displayEvidence });
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
    lastReceipt = buildReceipt(currentMode, {
      failedModeId: modeId,
      failedDisplayEvidence: displayEvidence
    });
    emit();
    throw error;
  }
}

export async function restoreAuthoredBasemap() {
  return setGroundMode(GROUND_MODE.AUTHORED_WEBMAP);
}
